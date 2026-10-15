import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrchestrateEvent, Plan } from '@orchestrate/shared';
import type { CommandResult } from '../src/gates/gates.ts';
import { Orchestrator } from '../src/orchestrator.ts';
import { redRejection } from '../src/pipeline/taskPipeline.ts';
import { FakeRunner, type FakeAgentContext, type FakeReply } from '../src/runner/fakeRunner.ts';
import { Store } from '../src/store/store.ts';
import { codeTask, fixtureOrg, makeFixtureRepo, planOf, sh, sumImpl, sumTest } from './helpers.ts';

type Phase = 'plan' | 'summary' | 'circle' | 'review' | 'escalation' | 'qa' | 'implement';

function phaseOf(ctx: FakeAgentContext): Phase {
  const s = ctx.inv.systemPrompt;
  if (s.includes('Tech Circle')) return 'circle';
  if (s.includes('You review your squad')) return 'review';
  if (s.includes('escalated instead of finishing')) return 'escalation';
  if (s.includes('write acceptance tests BEFORE')) return 'qa';
  if (s.includes('A run you planned has finished')) return 'summary';
  if (s.includes('You lead engineering')) return 'plan';
  return 'implement';
}

type Script = Partial<Record<Phase, (ctx: FakeAgentContext) => Promise<FakeReply | void> | FakeReply | void>>;

/** Well-behaved team for the "sum" feature; individual phases can be overridden per test. */
function team(plan: Plan | ((ctx: FakeAgentContext) => Plan), script: Script = {}) {
  return new FakeRunner((ctx) => {
    const phase = phaseOf(ctx);
    const override = script[phase];
    if (override) return override(ctx);
    switch (phase) {
      case 'plan':
        return { structured: typeof plan === 'function' ? plan(ctx) : plan, costUsd: 0.01 };
      case 'circle':
        return { structured: { verdict: 'approve', concerns: [], requiredChanges: [] } };
      case 'review':
        return { structured: { verdict: 'approve', notes: 'LGTM', issues: [] } };
      case 'summary':
        return { structured: { summary: 'Delivered sum().', followUps: [] } };
      case 'qa':
        ctx.write('test/sum.test.js', sumTest);
        ctx.submit('tests written');
        return;
      case 'implement':
        ctx.progress('writing sum');
        ctx.write('src/sum.js', sumImpl);
        ctx.submit('implemented sum');
        return;
      case 'escalation':
        return { structured: { decision: 'deny', addWriteScope: [], guidance: 'stay in scope' } };
    }
  });
}

const sumPlan = planOf(codeTask({ id: 'sum' }));

let cleanup: string[] = [];
afterEach(() => {
  for (const d of cleanup) rmSync(d, { recursive: true, force: true });
  cleanup = [];
});

function setup(runner: FakeRunner, orgOverrides = {}) {
  const fx = makeFixtureRepo();
  cleanup.push(fx.root);
  const store = new Store(':memory:');
  const orch = new Orchestrator({ org: fixtureOrg(orgOverrides), runner, repoRoot: fx.repo, workDir: fx.work, store });
  const events: OrchestrateEvent[] = [];
  orch.bus.on((e) => events.push(e));
  const mainBefore = sh(fx.repo, 'rev-parse', 'main');
  return { ...fx, orch, events, store, mainBefore };
}

const showOnBranch = (repo: string, branch: string, file: string) => {
  try {
    return sh(repo, 'show', `${branch}:${file}`);
  } catch {
    return undefined;
  }
};

describe('pipeline (FakeRunner, real git + real test gates)', () => {
  it('happy path: plan → circle → red → green → review → merge, main untouched', async () => {
    const env = setup(team(sumPlan));
    const run = await env.orch.wait(env.orch.submit('add a sum function').id);

    expect(run.status).toBe('completed');
    expect(run.tasks.map((t) => t.status)).toEqual(['merged']);
    expect(showOnBranch(env.repo, run.integrationBranch!, 'src/sum.js')).toContain('a + b');
    expect(showOnBranch(env.repo, run.integrationBranch!, 'test/sum.test.js')).toContain('sum adds');
    // the human merges; orchestrate never touches main
    expect(sh(env.repo, 'rev-parse', 'main')).toBe(env.mainBefore);
    expect(existsSync(path.join(env.repo, 'src', 'sum.js'))).toBe(false);

    const gates = env.events.filter((e) => e.type === 'gate.result').map((e) => `${e.gate}:${e.ok}`);
    expect(gates).toEqual(['audit:true', 'red:true', 'audit:true', 'test:true', 'full:true']);
    const types = new Set(env.events.map((e) => e.type));
    for (const t of ['circle.convened', 'circle.review', 'circle.adjourned', 'code.review', 'run.summary', 'agent.progress']) expect(types).toContain(t);
    expect(run.summary).toBe('Delivered sum().');
    expect(run.costUsd).toBeCloseTo(0.01);
    // all lights off at the end
    expect(env.orch.bus.agentSnapshots().every((a) => a.activity === 'idle')).toBe(true);
    // persisted for replay
    expect(env.store.getRun(run.id)?.status).toBe('completed');
    expect(env.store.events(run.id).length).toBeGreaterThan(10);
  });

  it('drift: guard denies out-of-scope writes, audit reverts a guard escape, dev retries in scope', async () => {
    const env = setup(
      team(sumPlan, {
        implement: (ctx) => {
          if (ctx.attempt === 1) {
            expect(ctx.write('src/core.js', 'export const VERSION = 2;\n')).toBe(false); // guard says no
            ctx.rogueWrite('src/core.js', 'export const VERSION = 2;\n'); // ...so it sneaks past
          }
          ctx.write('src/sum.js', sumImpl);
          ctx.submit('done');
        },
      }),
    );
    const run = await env.orch.wait(env.orch.submit('add sum').id);

    expect(run.tasks[0]!.status).toBe('merged');
    expect(run.tasks[0]!.attempts).toBe(2);
    const audits = env.events.filter((e) => e.type === 'gate.result' && e.gate === 'audit');
    expect(audits.some((e) => e.type === 'gate.result' && !e.ok && e.output.includes('src/core.js'))).toBe(true);
    expect(env.events.some((e) => e.type === 'agent.log' && e.kind === 'denied')).toBe(true);
    expect(showOnBranch(env.repo, run.integrationBranch!, 'src/core.js')).toContain('VERSION = 1');
  });

  it('dev may not weaken QA tests: edits to protected test files are rejected', async () => {
    const env = setup(
      team(sumPlan, {
        implement: (ctx) => {
          if (ctx.attempt === 1) ctx.rogueWrite('test/sum.test.js', "import { test } from 'node:test';\ntest('noop', () => {});\n");
          else ctx.write('src/sum.js', sumImpl);
          ctx.submit('done');
        },
      }),
    );
    const run = await env.orch.wait(env.orch.submit('add sum').id);
    expect(run.tasks[0]!.status).toBe('merged');
    expect(env.events.some((e) => e.type === 'gate.result' && e.gate === 'audit' && e.output.includes('protected file test/sum.test.js'))).toBe(true);
    expect(showOnBranch(env.repo, run.integrationBranch!, 'test/sum.test.js')).toContain('sum adds');
  });

  it('failing gates feed back to the dev; exhausting retries escalates and skips dependents', async () => {
    const plan = planOf(codeTask({ id: 'sum' }), codeTask({ id: 'later', dependsOn: ['sum'] }));
    const env = setup(
      team(plan, {
        implement: (ctx) => {
          ctx.write('src/sum.js', 'export const sum = (a, b) => a - b;\n'); // always wrong
          ctx.submit('done?');
        },
      }),
    );
    const run = await env.orch.wait(env.orch.submit('add sum').id);
    const [sum, later] = run.tasks;
    expect(sum!.status).toBe('escalated');
    expect(sum!.attempts).toBe(3);
    expect(later!.status).toBe('skipped');
    expect(run.status).toBe('failed');
    const failedTests = env.events.filter((e) => e.type === 'gate.result' && e.gate === 'test' && !e.ok);
    expect(failedTests).toHaveLength(3);
    // feedback reached the dev's next prompt
    const devCalls = (env.orch as unknown as { runner: FakeRunner }).runner.calls.filter((c) => c.agentId === 'core-dev');
    expect(devCalls[1]!.prompt).toContain('test failed');
  });

  it('QA tests that already pass are rejected as not red', async () => {
    const env = setup(
      team(sumPlan, {
        qa: (ctx) => {
          if (ctx.attempt === 1) ctx.write('test/sum.test.js', "import { test } from 'node:test';\ntest('trivial', () => {});\n");
          else ctx.write('test/sum.test.js', sumTest);
          ctx.submit('tests');
        },
      }),
    );
    const run = await env.orch.wait(env.orch.submit('add sum').id);
    expect(run.tasks[0]!.status).toBe('merged');
    const reds = env.events.filter((e) => e.type === 'gate.result' && e.gate === 'red').map((e) => e.type === 'gate.result' && e.ok);
    expect(reds).toEqual([false, true]);
  });

  it('escalation: lead grants extra scope inside squad ownership, refuses the rest', async () => {
    const env = setup(
      team(sumPlan, {
        implement: (ctx) => {
          if (ctx.attempt === 1) {
            ctx.requestScope(['src/util/math.js'], 'need a helper module');
            return;
          }
          expect(ctx.write('src/util/math.js', 'export const add = (a, b) => a + b;\n')).toBe(true);
          ctx.write('src/sum.js', "import { add } from './util/math.js';\nexport const sum = add;\n");
          ctx.submit('done');
        },
        escalation: () => ({ structured: { decision: 'grant', addWriteScope: ['src/util/**', 'docs/**'], guidance: 'keep it tiny' } }),
      }),
    );
    const run = await env.orch.wait(env.orch.submit('add sum').id);
    expect(run.tasks[0]!.status).toBe('merged');
    expect(run.tasks[0]!.attempts).toBe(2);
    const devCalls = (env.orch as unknown as { runner: FakeRunner }).runner.calls.filter((c) => c.agentId === 'core-dev');
    expect(devCalls[1]!.guard.write).toEqual(['src/sum.js', 'src/util/**']); // docs/** refused: not core's
    expect(devCalls[1]!.prompt).toContain('Refused (outside squad ownership): docs/**');
  });

  it('escalation: lead calls for a replan → task escalated to the Head of Engineering', async () => {
    const env = setup(
      team(sumPlan, {
        implement: (ctx) => ctx.block('sum needs a numeric library we do not have'),
        escalation: () => ({ structured: { decision: 'replan', addWriteScope: [], guidance: 'belongs to another squad' } }),
      }),
    );
    const run = await env.orch.wait(env.orch.submit('add sum').id);
    expect(run.tasks[0]!.status).toBe('escalated');
    expect(run.tasks[0]!.detail).toContain('replan');
    expect(env.events.some((e) => e.type === 'escalation' && e.to === 'boss')).toBe(true);
  });

  it('master revises when deterministic validation rejects the plan', async () => {
    const bad = planOf(codeTask({ id: 'sum', writeScope: ['docs/**'] })); // core cannot own docs
    const env = setup(team((ctx) => (ctx.attempt === 1 ? bad : sumPlan)));
    const run = await env.orch.wait(env.orch.submit('add sum').id);
    expect(run.status).toBe('completed');
    const proposals = env.events.filter((e) => e.type === 'plan.proposed');
    expect(proposals).toHaveLength(2);
    expect(proposals[0]!.type === 'plan.proposed' && proposals[0]!.problems[0]).toMatch(/outside squad "core" ownership/);
  });

  it('tech circle can force a revision', async () => {
    const env = setup(
      team(sumPlan, {
        circle: (ctx) =>
          ctx.inv.agentId === 'arch' && ctx.attempt === 1
            ? { structured: { verdict: 'revise', concerns: ['naming'], requiredChanges: ['rename the task'] } }
            : { structured: { verdict: 'approve', concerns: [], requiredChanges: [] } },
      }),
    );
    const run = await env.orch.wait(env.orch.submit('add sum').id);
    expect(run.status).toBe('completed');
    const planCalls = (env.orch as unknown as { runner: FakeRunner }).runner.calls.filter((c) => c.agentId === 'boss' && c.prompt.includes('REQUIRED CHANGES'));
    expect(planCalls[0]!.prompt).toContain('[Architect] rename the task');
  });

  it('discards tests from a QA session that ran out of budget, and asks again', async () => {
    const env = setup(
      team(sumPlan, {
        qa: (ctx) => {
          if (ctx.attempt === 1) {
            ctx.write('test/sum.test.js', "import { test } from 'node:test';\n// TODO"); // half-written
            return { ended: 'budget' };
          }
          ctx.write('test/sum.test.js', sumTest);
          ctx.submit('tests written');
        },
      }),
    );
    const run = await env.orch.wait(env.orch.submit('add sum').id);
    expect(run.tasks[0]!.status).toBe('merged');
    const runner = (env.orch as unknown as { runner: FakeRunner }).runner;
    expect(runner.calls.find((c) => c.prompt.includes('ended before you finished'))).toBeDefined();
  });

  it('does not count a test file that fails to parse as "failing first"', async () => {
    const env = setup(
      team(sumPlan, {
        qa: (ctx) => {
          ctx.write('test/sum.test.js', ctx.attempt === 1 ? 'import { test } from "node:test";\ntest("sum", () => {' : sumTest);
          ctx.submit('tests written');
        },
      }),
    );
    const run = await env.orch.wait(env.orch.submit('add sum').id);
    expect(run.tasks[0]!.status).toBe('merged');
    const red = env.events.filter((e) => e.type === 'gate.result' && e.gate === 'red');
    expect(red.map((e) => e.type === 'gate.result' && e.ok)).toEqual([false, true]);
  });

  it('never approves a change because the lead review was unreadable: asks again, then escalates', async () => {
    const env = setup(team(sumPlan, { review: () => ({ text: 'looks fine I guess' }) }));
    const run = await env.orch.wait(env.orch.submit('add sum').id);
    expect(run.tasks[0]!.status).toBe('escalated');
    expect(run.tasks[0]!.detail).toMatch(/could not be read twice/);
    const runner = (env.orch as unknown as { runner: FakeRunner }).runner;
    expect(runner.calls.filter((c) => c.prompt.includes('could not be read as a review'))).toHaveLength(1);
    expect(showOnBranch(env.repo, `orch/run-${run.id}`, 'src/sum.js')).toBeUndefined();
  });

  it('accepts a lead review that comes back readable the second time', async () => {
    const env = setup(team(sumPlan, { review: (ctx) => (ctx.attempt === 1 ? { text: 'oops' } : { structured: { verdict: 'approve', notes: 'LGTM', issues: [] } }) }));
    const run = await env.orch.wait(env.orch.submit('add sum').id);
    expect(run.tasks[0]!.status).toBe('merged');
  });

  it('stops for a person when a Tech Circle verdict is unreadable, even with auto-approve', async () => {
    const env = setup(team(sumPlan, { circle: (ctx) => (ctx.inv.agentId === 'arch' ? { text: 'hmm' } : { structured: { verdict: 'approve', concerns: [], requiredChanges: [] } }) }));
    const a = env.orch.submit('add sum', { autoApprove: true });
    await waitFor(() => env.orch.get(a.id)?.status === 'awaiting_approval');
    expect(env.orch.get(a.id)!.detail).toMatch(/Unreviewed: .*Architect/);
    expect(env.orch.approve(a.id)).toBe(true);
    expect((await env.orch.wait(a.id)).status).toBe('completed');
  });

  it('stops for a person, concerns visible, when the circle still wants changes after the last round', async () => {
    const env = setup(team(sumPlan, { circle: () => ({ structured: { verdict: 'revise', concerns: ['naming'], requiredChanges: ['rename the task'] } }) }));
    const a = env.orch.submit('add sum');
    await waitFor(() => env.orch.get(a.id)?.status === 'awaiting_approval');
    expect(env.orch.get(a.id)!.detail).toMatch(/still had concerns.*rename the task/);
    env.orch.cancel(a.id);
    expect((await env.orch.wait(a.id)).status).toBe('cancelled');
  });

  it('after a restart, marks runs that were going as failed and removes their worktrees', async () => {
    let release!: () => void;
    const stuck = new Promise<void>((r) => (release = r));
    let implementing = false;
    const env = setup(
      team(sumPlan, {
        implement: async (ctx) => {
          implementing = true;
          await stuck; // the daemon "dies" while the implementer works
          ctx.submit('late');
        },
      }),
    );
    const a = env.orch.submit('add sum');
    await waitFor(() => implementing);
    const worktrees = () => sh(env.repo, 'worktree', 'list').split('\n').filter((l) => l.includes(a.id)).length;
    expect(worktrees()).toBe(2); // the integration worktree and the task's

    // a new daemon on the same database
    const restarted = new Orchestrator({ org: fixtureOrg(), runner: team(sumPlan), repoRoot: env.repo, workDir: env.work, store: env.store });
    expect(await restarted.recoverInterrupted()).toEqual([a.id]);
    const run = restarted.get(a.id)!;
    expect(run.status).toBe('failed');
    expect(run.detail).toMatch(/daemon stopped while this run was executing/);
    expect(run.tasks.every((t) => t.status === 'skipped')).toBe(true);
    expect(worktrees()).toBe(0);
    expect(sh(env.repo, 'branch', '--list', `orch/${a.id}/*`)).toBe('');
    expect(sh(env.repo, 'branch', '--list', `orch/run-${a.id}`)).not.toBe(''); // kept: it may hold merged work
    expect(await restarted.recoverInterrupted()).toEqual([]); // only once

    env.orch.cancel(a.id);
    release();
    await env.orch.wait(a.id);
  });

  it('shutdown cancels active runs and waits for them to finish cleaning up', async () => {
    const env = setup(team(sumPlan), { policy: { requireHumanApproval: true, maxRetries: 1, maxChangedLines: 200, circleRevisionRounds: 0, maxParallel: 1 } });
    const a = env.orch.submit('add sum');
    await waitFor(() => env.orch.get(a.id)?.status === 'awaiting_approval');
    await env.orch.shutdown();
    expect(env.store.getRun(a.id)!.status).toBe('cancelled');
  });

  it('waits at the human gate until approved, and can be cancelled there', async () => {
    const env = setup(team(sumPlan), { policy: { requireHumanApproval: true, maxRetries: 1, maxChangedLines: 200, circleRevisionRounds: 0, maxParallel: 1 } });
    const a = env.orch.submit('add sum');
    await waitFor(() => env.orch.get(a.id)?.status === 'awaiting_approval');
    expect(env.orch.approve(a.id)).toBe(true);
    expect((await env.orch.wait(a.id)).status).toBe('completed');

    const b = env.orch.submit('add sum again');
    await waitFor(() => env.orch.get(b.id)?.status === 'awaiting_approval');
    env.orch.cancel(b.id);
    expect((await env.orch.wait(b.id)).status).toBe('cancelled');
  });
});

async function waitFor(cond: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('shipping and progression (real git)', () => {
  const district = (env: ReturnType<typeof setup>, squad: string) => env.orch.progress().districts.find((d) => d.squad === squad)!;

  it('ships a run where only some tasks finished only when asked to ship it partially', async () => {
    // the scripted QA only ever writes the sum test, so the "extra" task never gets past QA
    const env = setup(team(planOf(codeTask({ id: 'sum' }), codeTask({ id: 'extra' }))));
    const run = await env.orch.wait(env.orch.submit('add sum and extra').id);
    expect(run.status).toBe('completed');
    expect(run.tasks.map((t) => t.status).sort()).toEqual(['escalated', 'merged']);

    const refused = await env.orch.ship(run.id);
    expect(refused).toMatchObject({ ok: false, reason: 'incomplete', message: expect.stringMatching(/Only 1 of 2 tasks finished \(not: Task extra\)/) });
    expect(sh(env.repo, 'rev-parse', 'main')).toBe(env.mainBefore);

    expect(await env.orch.ship(run.id, { partial: true })).toMatchObject({ ok: true });
    expect(existsSync(path.join(env.repo, 'src', 'sum.js'))).toBe(true);
  });

  it('re-tests a moved main with the test command when no separate full suite is configured', async () => {
    const env = setup(team(sumPlan), { gates: { test: 'node --test', testFiles: 'node --test {files}', timeoutMs: 60_000 } });
    const run = await env.orch.wait(env.orch.submit('add a sum function').id);
    sh(env.repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'meanwhile on main');
    const res = await env.orch.ship(run.id);
    expect(res).toMatchObject({ ok: true, tested: true });
  });

  it('Ship it lands a completed run on main as a merge commit and banks its growth', async () => {
    const env = setup(team(sumPlan));
    const run = await env.orch.wait(env.orch.submit('add a sum function').id);
    const squad = run.tasks[0]!.contract.squad;
    expect(run.integrationHead).toBe(sh(env.repo, 'rev-parse', run.integrationBranch!));
    expect(district(env, squad)).toMatchObject({ growth: 0, pending: 200 });

    const res = await env.orch.ship(run.id);

    expect(res).toMatchObject({ ok: true, alreadyShipped: false, tested: false });
    expect(sh(env.repo, 'rev-parse', 'main')).toBe(res.ok ? res.sha : '');
    expect(existsSync(path.join(env.repo, 'src', 'sum.js'))).toBe(true);
    expect(district(env, squad)).toMatchObject({ growth: 200, pending: 0, ships: 1, streak: 1 });
    expect(env.events.filter((e) => e.type === 'run.shipped')).toEqual([expect.objectContaining({ runId: run.id, method: 'merged' })]);
    expect(env.store.ships()).toHaveLength(1);
    // shipping twice is harmless
    expect(await env.orch.ship(run.id)).toMatchObject({ ok: true, alreadyShipped: true });
    expect(env.events.filter((e) => e.type === 'run.shipped')).toHaveLength(1);
  });

  it('detects a run you merged yourself, once', async () => {
    const env = setup(team(sumPlan));
    const run = await env.orch.wait(env.orch.submit('add a sum function').id);
    expect(await env.orch.checkShipped()).toEqual([]);

    sh(env.repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'merge', '-q', '--no-ff', '-m', 'by hand', run.integrationBranch!);

    expect(await env.orch.checkShipped()).toEqual([run.id]);
    expect(await env.orch.checkShipped()).toEqual([]);
    expect(env.events.filter((e) => e.type === 'run.shipped')).toEqual([expect.objectContaining({ runId: run.id, method: 'detected' })]);
  });

  it('can be marked as shipped by hand (after a squash merge), once', async () => {
    const env = setup(team(sumPlan));
    const run = await env.orch.wait(env.orch.submit('add a sum function').id);

    expect(await env.orch.markShipped(run.id)).toBe(true);
    expect(await env.orch.markShipped(run.id)).toBe(false);
    expect(district(env, run.tasks[0]!.contract.squad)).toMatchObject({ growth: 200, ships: 1 });
  });

  it('refuses to ship a run that has not completed', async () => {
    const env = setup(team(sumPlan));
    expect(await env.orch.ship('no-such-run')).toMatchObject({ ok: false, reason: 'not-ready' });
  });
});

describe('redRejection: what counts as tests failing first', () => {
  const run = (over: Partial<CommandResult>): CommandResult => ({ ok: false, code: 1, output: '', timedOut: false, ...over });
  const files = ['test/sum.test.js'];
  it('accepts tests that fail because the feature is missing', () => {
    expect(redRejection(run({ output: 'AssertionError: expected 3, got undefined' }), files)).toBeUndefined();
    expect(redRejection(run({ output: "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '../src/sum.js'" }), files)).toBeUndefined();
    // a syntax error somewhere else is the code's problem, not the test's
    expect(redRejection(run({ output: 'SyntaxError: Unexpected token in src/legacy.js' }), files)).toBeUndefined();
  });
  it('rejects passing tests, a timeout, and a test file that does not parse', () => {
    expect(redRejection(run({ ok: true, code: 0 }), files)).toMatch(/pass before anything is implemented/);
    expect(redRejection(run({ timedOut: true, code: null }), files)).toMatch(/timed out/);
    expect(redRejection(run({ output: 'test/sum.test.js:3\nSyntaxError: Unexpected end of input' }), files)).toMatch(/does not parse/);
  });
});
