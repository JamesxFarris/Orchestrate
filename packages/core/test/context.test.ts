import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunState, TaskState } from '@orchestrate/shared';
import { recentRunMemory } from '../src/context/memory.ts';
import { adrDigest, loadAgentDoc } from '../src/context/projectContext.ts';
import { Orchestrator } from '../src/orchestrator.ts';
import { buildTaskBrief } from '../src/pipeline/brief.ts';
import { FakeRunner } from '../src/runner/fakeRunner.ts';
import { Store } from '../src/store/store.ts';
import { codeTask, fixtureOrg, makeFixtureRepo, planOf, sh, sumImpl, sumTest } from './helpers.ts';

let roots: string[] = [];
afterEach(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
  roots = [];
});
const repo = () => {
  const fx = makeFixtureRepo();
  roots.push(fx.root);
  return fx;
};
const commit = (dir: string, files: Record<string, string>) => {
  for (const [f, c] of Object.entries(files)) writeFileSync(path.join(dir, f), c);
  sh(dir, 'add', '-A');
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'docs');
};

describe('project context, read from a commit', () => {
  it('finds AGENTS.md, else CLAUDE.md, as committed; "" turns it off; long guides are clipped', async () => {
    const fx = repo();
    expect(await loadAgentDoc(fx.repo, 'main', undefined, 6000)).toBeUndefined();
    commit(fx.repo, { 'CLAUDE.md': '# Conventions\nUse tabs.\n' });
    expect(await loadAgentDoc(fx.repo, 'main', undefined, 6000)).toMatchObject({ path: 'CLAUDE.md', text: expect.stringContaining('Use tabs') });
    writeFileSync(path.join(fx.repo, 'AGENTS.md'), 'uncommitted, so never read'); // the working copy is not the project
    expect((await loadAgentDoc(fx.repo, 'main', undefined, 6000))?.path).toBe('CLAUDE.md');
    expect(await loadAgentDoc(fx.repo, 'main', '', 6000)).toBeUndefined();
    expect((await loadAgentDoc(fx.repo, 'main', 'CLAUDE.md', 10))?.text).toMatch(/^# Convent[\s\S]*truncated/);
  });

  it('lists ADRs newest first and names the next free number', async () => {
    const fx = repo();
    expect(await adrDigest(fx.repo, 'main', 'docs/adr')).toEqual({ next: '0001', lines: [] });
    sh(fx.repo, 'checkout', '-q', '-b', 'adrs');
    mkdirSync(path.join(fx.repo, 'docs', 'adr'), { recursive: true });
    commit(fx.repo, { 'docs/adr/0001-event-bus.md': '# 1', 'docs/adr/0002-save-format.md': '# 2', 'docs/adr/README.md': 'index' });
    expect(await adrDigest(fx.repo, 'adrs', 'docs/adr')).toEqual({ next: '0003', lines: ['- docs/adr/0002-save-format.md', '- docs/adr/0001-event-bus.md'] });
  });

  it('never lets a ref reach git as an option (git show --output=<file> would write anywhere)', async () => {
    const fx = repo();
    commit(fx.repo, { 'AGENTS.md': 'guide' });
    const target = path.join(fx.root, 'pwned');
    expect(await loadAgentDoc(fx.repo, `--output=${target}`, undefined, 6000)).toBeUndefined();
    expect(await adrDigest(fx.repo, '--all', 'docs/adr')).toEqual({ next: '0001', lines: [] });
    expect(readdirSync(fx.root).filter((f) => f.startsWith('pwned'))).toEqual([]);
    expect((await loadAgentDoc(fx.repo, 'HEAD~0', undefined, 6000))?.text).toBe('guide');
  });
});

const run = (over: Partial<RunState>): RunState => ({ id: 'r', prompt: 'p', status: 'completed', createdAt: 0, tasks: [], costUsd: 0, repo: '/game', ...over });

describe('recentRunMemory', () => {
  it('remembers recent finished runs on the same project, newest first, with their follow-ups', () => {
    const runs = [
      run({ id: 'a', prompt: 'Add waves', createdAt: 1, summary: 'Waves spawn.\nmore', followUps: ['tune spawn rate'] }),
      run({ id: 'b', prompt: 'Add bosses', createdAt: 3, status: 'failed' }),
      run({ id: 'c', prompt: 'Other project', createdAt: 4, repo: '/elsewhere' }),
      run({ id: 'd', prompt: 'Still going', createdAt: 5, status: 'executing' }),
    ];
    const memory = recentRunMemory(runs, run({ id: 'now', createdAt: 9 }));
    expect(memory.split('\n')).toHaveLength(2);
    expect(memory.split('\n')[0]).toContain('"Add bosses" (failed');
    expect(memory).toContain('Waves spawn.; follow-ups: tune spawn rate');
    expect(memory).not.toContain('Other project');
  });
});

describe('buildTaskBrief', () => {
  const t = (id: string, over: Partial<TaskState> = {}, kind: 'code' | 'research' = 'code'): TaskState => ({
    contract: codeTask({ id, kind, ...(kind === 'research' ? { testFiles: [], writeScope: ['docs/design/x.md', 'docs/adr/0001-x.md'] } : {}) }),
    status: 'merged',
    attempts: 1,
    ...over,
  });
  it('tells a task what its dependencies delivered, which design to follow, and where Grep may look', () => {
    const spec = t('spec', { result: { files: ['docs/design/x.md', 'docs/adr/0001-x.md'], summary: 'Defined the Wave type' } }, 'research');
    const types = t('types', { result: { files: ['src/types.js'], summary: 'Added Wave' } });
    const me = t('me', { status: 'pending', contract: { ...codeTask({ id: 'me' }), dependsOn: ['spec', 'types'] } });
    const brief = buildTaskBrief(run({ tasks: [spec, types, me] }), me, ['src/**', 'docs/design/x.md']);
    expect(brief).toContain('UPSTREAM');
    expect(brief).toContain('types "Task types" (core): Added Wave; changed src/types.js');
    expect(brief).toContain('DESIGN TO FOLLOW');
    expect(brief).toContain('- docs/design/x.md');
    expect(brief).toMatch(/WHERE TO LOOK[\s\S]*- src$/m);
  });
  it('says nothing about dependencies that have not merged', () => {
    const dep = t('dep', { status: 'failed' });
    const me = t('me', { status: 'pending', contract: { ...codeTask({ id: 'me' }), dependsOn: ['dep'] } });
    expect(buildTaskBrief(run({ tasks: [dep, me] }), me, [])).toBe('');
  });
});

describe('what agents are told during a run (FakeRunner, real git)', () => {
  it('gives every agent the project guide, the planner the decision log and memory, and dependents the upstream work', async () => {
    const fx = repo();
    commit(fx.repo, { 'AGENTS.md': 'Always write JSDoc.\n' });
    const plan = planOf(codeTask({ id: 'sum' }), codeTask({ id: 'use', dependsOn: ['sum'] }));
    const runner = new FakeRunner((ctx) => {
      const s = ctx.inv.systemPrompt;
      if (s.includes('Tech Circle')) return { structured: { verdict: 'approve', concerns: [], requiredChanges: [] } };
      if (s.includes('You review your squad')) return { structured: { verdict: 'approve', notes: 'LGTM', issues: [] } };
      if (s.includes('A run you planned has finished')) return { structured: { summary: 'Delivered sum().', followUps: ['add a product()'] } };
      if (s.includes('You lead engineering')) return { structured: plan };
      const task = ctx.inv.taskId!;
      if (s.includes('write acceptance tests BEFORE')) {
        // both tasks test a sum() exported from their own module
        ctx.write(`test/${task}.test.js`, sumTest.replace('../src/sum.js', `../src/${task}.js`));
        ctx.submit('tests');
        return;
      }
      ctx.write(`src/${task}.js`, sumImpl);
      ctx.submit(`implemented ${task}`);
    });
    const store = new Store(':memory:');
    const orch = new Orchestrator({ org: fixtureOrg(), runner, repoRoot: fx.repo, workDir: fx.work, store });
    const first = await orch.wait(orch.submit('add sum').id);
    expect(first.tasks.map((t) => t.status)).toEqual(['merged', 'merged']);
    expect(first.tasks[0]!.result).toMatchObject({ summary: 'implemented sum', reviewNotes: 'LGTM', files: ['src/sum.js', 'test/sum.test.js'] });
    expect(first.followUps).toEqual(['add a product()']);

    const calls = runner.calls;
    const summaryCall = calls.find((c) => c.systemPrompt.includes('A run you planned has finished'))!;
    for (const c of calls.filter((x) => x !== summaryCall)) expect(c.systemPrompt, c.agentId).toContain('PROJECT GUIDE (from AGENTS.md');
    expect(summaryCall.systemPrompt).not.toContain('PROJECT GUIDE');
    expect(calls.find((c) => c.agentId === 'boss')!.systemPrompt).toContain('Next free ADR number: 0001');
    const useDev = calls.find((c) => c.agentId === 'core-dev' && c.taskId === 'use')!;
    expect(useDev.systemPrompt).toContain('sum "Task sum" (core): implemented sum; changed src/sum.js, test/sum.test.js');

    // a second run remembers the first
    calls.length = 0;
    await orch.wait(orch.submit('add product').id);
    expect(calls.find((c) => c.agentId === 'boss')!.systemPrompt).toMatch(/RECENT RUNS ON THIS PROJECT[\s\S]*"add sum" \(completed, 2\/2 tasks merged\)[\s\S]*add a product\(\)/);
    store.close();
  }, 60_000);
});
