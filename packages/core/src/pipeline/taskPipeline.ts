import path from 'node:path';
import { CodeReview, EscalationDecision, type RoleConfig, type TaskState } from '@orchestrate/shared';
import { auditChanges, runCommand, testFilesCommand, type CommandResult } from '../gates/gates.ts';
import * as g from '../git/git.ts';
import {
  implementerPrompt,
  implementerSystem,
  leadEscalationPrompt,
  leadEscalationSystem,
  leadReviewPrompt,
  leadReviewSystem,
  qaSystem,
  reviewToFeedback,
} from '../prompts.ts';
import { globWithin } from '../scope/paths.ts';
import { commandPattern, GIT_READONLY } from '../scope/scopeGuard.ts';
import { outputSchema, parseStructured } from '../runner/structured.ts';
import { BUILD_TOOLS, READ_TOOLS } from '../runner/types.ts';
import type { RunContext } from './context.ts';

export type TaskOutcome = 'merged' | 'escalated' | 'failed';

const CONFIG_READS = ['package.json', 'tsconfig*.json', '*.config.*', 'README*', 'docs/**'];
const MAX_ESCALATIONS = 2;

/** The full lifecycle of one task contract, from failing tests to a verified merge. */
export async function executeTask(ctx: RunContext, task: TaskState): Promise<TaskOutcome> {
  const { org } = ctx;
  const c = task.contract;
  const integration = ctx.integration!;
  const squad = org.squad(c.squad);
  const lead = org.lead(c.squad);
  const implementer = org.implementer(c.squad, c.kind)!;
  const links = org.project.linkDirs;
  const gates = org.gates;
  const maxLines = c.maxChangedLines ?? org.policy.maxChangedLines;

  const base = await integration.head();
  const wt = await g.addWorktree(ctx.repoRoot, path.join(ctx.workDir, ctx.run.id, c.id), `orch/${ctx.run.id}/${c.id}`, base, links);
  task.branch = wt.branch;
  ctx.persist();

  const escalate = (detail: string): TaskOutcome => {
    ctx.bus.emit({ type: 'escalation', runId: ctx.run.id, taskId: c.id, from: lead.id, to: org.master().id, reason: detail });
    ctx.setTaskStatus(task, 'escalated', detail);
    return 'escalated';
  };

  try {
    if (gates.setup) {
      const r = await runCommand(gates.setup, wt.dir, gates.timeoutMs, ctx.signal);
      ctx.gate(task, 'setup', r.ok, r.output);
      if (!r.ok) {
        ctx.setTaskStatus(task, 'failed', 'worktree setup failed');
        return 'failed';
      }
    }

    // ---------------------------------------------------------------- RED: QA writes failing tests
    let testSha = base;
    if (c.kind === 'code') {
      const qa = org.squadRole(c.squad, 'qa')!;
      const red = await redPhase(ctx, task, qa, wt.dir, base);
      if (!red.ok) return escalate(red.detail);
      testSha = red.sha;
      ctx.handoff(task, qa.id, implementer.id, 'acceptance tests are red');
    }

    // ---------------------------------------------------------------- GREEN: implement until gates + lead pass
    const writeScope = [...c.writeScope];
    // what the implementer may run to check its own work before submitting: its tests, typecheck, lint
    const commands = c.kind === 'code' ? [testFilesCommand(gates, c.testFiles), gates.typecheck, gates.lint].filter((x): x is string => !!x) : [];
    let feedback: string[] = [];
    let escalations = 0;
    let approved = false;

    for (let attempt = 0; attempt <= org.policy.maxRetries && !approved; attempt++) {
      ctx.setTaskStatus(task, 'in_progress', attempt ? `attempt ${attempt + 1}` : undefined);
      task.attempts++;

      const res = await ctx.callAgent({
        role: implementer,
        activity: 'working',
        task,
        cwd: wt.dir,
        system: implementerSystem(org, implementer, c, writeScope, commands, maxLines),
        prompt: implementerPrompt(feedback),
        tools: BUILD_TOOLS,
        requireSubmit: true,
        guard: {
          write: writeScope,
          read: [...c.readScope, ...writeScope, ...c.testFiles, ...org.project.referenceDirs, ...squad.owns, ...CONFIG_READS],
          protected: c.testFiles,
          bash: [...commands.map(commandPattern), ...GIT_READONLY],
        },
        headline: attempt ? `Retry ${attempt}: ${c.title}` : `Implementing: ${c.title}`,
      });

      if (res.outcome === 'scope_change' || res.outcome === 'blocked') {
        if (++escalations > MAX_ESCALATIONS) return escalate(`escalated ${escalations} times; last: ${res.blocker ?? res.scopeRequest?.reason}`);
        const detail = res.outcome === 'blocked' ? res.blocker! : `Paths: ${res.scopeRequest!.paths.join(', ')}\nReason: ${res.scopeRequest!.reason}`;
        ctx.bus.emit({ type: 'escalation', runId: ctx.run.id, taskId: c.id, from: implementer.id, to: lead.id, reason: detail });
        ctx.handoff(task, implementer.id, lead.id, 'escalation');
        const ruling = await ctx.callAgent({
          role: lead,
          activity: 'reviewing',
          task,
          cwd: wt.dir,
          system: leadEscalationSystem(org, lead, squad.owns),
          prompt: leadEscalationPrompt(c, writeScope, res.outcome, detail),
          tools: READ_TOOLS,
          guard: { write: [], read: ['**'], protected: [], bash: [] },
          schema: outputSchema(EscalationDecision),
          headline: `Ruling on escalation: ${c.title}`,
        });
        const decision = parseStructured(EscalationDecision, ruling);
        if (!decision.ok) return escalate(`lead could not rule on escalation (${decision.error}): ${detail}`);
        const d = decision.value;
        ctx.bus.emit({ type: 'escalation', runId: ctx.run.id, taskId: c.id, from: lead.id, to: implementer.id, reason: d.guidance, decision: d });
        if (d.decision === 'replan') return escalate(`lead requested a replan: ${d.guidance}`);
        if (d.decision === 'grant') {
          const granted = d.addWriteScope.filter((x) => globWithin(x, squad.owns));
          const refused = d.addWriteScope.filter((x) => !granted.includes(x));
          writeScope.push(...granted);
          feedback = [
            `Lead granted extra write scope: ${granted.join(', ') || '(none valid)'}`,
            ...(refused.length ? [`Refused (outside squad ownership): ${refused.join(', ')}`] : []),
            `Guidance: ${d.guidance}`,
          ];
        } else {
          feedback = [`Lead ruling — stay within your scope. Guidance: ${d.guidance}`];
        }
        // a ruling is not a failed attempt (for the retry budget or the first-try bonus); MAX_ESCALATIONS bounds this loop
        attempt--;
        task.attempts--;
        continue;
      }

      if (res.outcome === 'completed') {
        // ended without submit_work even after the reminder: unfinished by its own account. The
        // changes stay in the worktree for the next attempt to check and submit.
        feedback = ['You ended your session without calling submit_work, so the work was not checked. Your changes are still in place: verify them with the allowed commands, then call submit_work (or raise_blocker if you are stuck).'];
        continue;
      }

      if (res.outcome === 'budget' || res.outcome === 'error') {
        feedback = [`Your previous session ended early (${res.error ?? res.outcome}). Be more direct: implement, verify once, submit.`];
        continue;
      }

      await g.commitAll(wt.dir, `${c.kind === 'code' ? 'feat' : 'docs'}(${c.id}): ${c.title} [attempt ${attempt + 1}]`, links);

      // -------------------------------------------------------------- audit what actually changed
      const changed = await g.changedFiles(wt.dir, testSha);
      if (changed.length === 0) {
        feedback = ['You made no changes. Implement the contract.'];
        ctx.gate(task, 'audit', false, 'no changes');
        continue;
      }
      const lines = await g.changedLines(wt.dir, testSha);
      const problems = auditChanges({ changed, allowed: writeScope, forbidden: c.testFiles, changedLines: lines, maxChangedLines: maxLines });
      ctx.gate(task, 'audit', problems.length === 0, problems.join('\n') || `${changed.length} files, ${lines} lines, all in scope`);
      if (problems.length) {
        await g.resetHard(wt.dir, testSha);
        feedback = [...problems.map((p) => `REJECTED: ${p}.`), 'All your changes were reverted. Redo the work strictly inside your write scope.'];
        continue;
      }

      // -------------------------------------------------------------- gates
      ctx.setTaskStatus(task, 'verifying');
      ctx.activity(implementer.id, 'testing', task, `Running gates: ${c.title}`);
      const failures: string[] = [];
      const gateNotes: string[] = [`audit: ${changed.length} files, ${lines} lines, in scope`];
      const steps: [name: 'typecheck' | 'lint' | 'test', cmd: string | undefined][] =
        c.kind === 'code'
          ? [['typecheck', gates.typecheck], ['lint', gates.lint], ['test', testFilesCommand(gates, c.testFiles)]]
          : [];
      for (const [name, cmd] of steps) {
        if (!cmd) continue;
        const r = await runCommand(cmd, wt.dir, gates.timeoutMs, ctx.signal);
        ctx.throwIfCancelled();
        ctx.gate(task, name, r.ok, r.output);
        gateNotes.push(`${name}: ${r.ok ? 'pass' : 'FAIL'}`);
        if (!r.ok) failures.push(`${name} failed (\`${cmd}\`):\n${r.output.slice(-3000)}`);
      }
      ctx.activity(implementer.id, 'idle');
      if (failures.length) {
        feedback = failures;
        continue;
      }

      // -------------------------------------------------------------- lead review
      ctx.setTaskStatus(task, 'review');
      ctx.handoff(task, implementer.id, lead.id, 'code review');
      const reviewPrompt = leadReviewPrompt(c, await g.diffText(wt.dir, base), res.submitSummary, gateNotes);
      const askLead = async (unreadable?: string) =>
        parseStructured(
          CodeReview,
          await ctx.callAgent({
            role: lead,
            activity: 'reviewing',
            task,
            cwd: wt.dir,
            system: leadReviewSystem(org, lead),
            prompt: unreadable ? `${reviewPrompt}\n\nYour previous reply could not be read as a review (${unreadable}). Review the same diff and reply with only the structured verdict.` : reviewPrompt,
            tools: READ_TOOLS,
            guard: { write: [], read: ['**'], protected: [], bash: [] },
            schema: outputSchema(CodeReview),
            headline: unreadable ? `Re-reviewing: ${c.title}` : `Reviewing: ${c.title}`,
          }),
        );
      // A review nobody can read is not an approval: ask once more, then hand it to a person.
      let review = await askLead();
      if (!review.ok) {
        ctx.bus.emit({ type: 'agent.log', runId: ctx.run.id, agentId: lead.id, taskId: c.id, kind: 'error', text: `review unreadable (${review.error}); asking again` });
        review = await askLead(review.error);
      }
      if (!review.ok) return escalate(`the lead's review could not be read twice (${review.error}). Gates passed, but nobody has reviewed this change.`);
      ctx.bus.emit({ type: 'code.review', runId: ctx.run.id, taskId: c.id, roleId: lead.id, review: review.value });
      if (review.value.verdict === 'approve') {
        approved = true;
        break;
      }
      ctx.handoff(task, lead.id, implementer.id, 'changes requested');
      feedback = reviewToFeedback(review.value);
    }

    if (!approved) return escalate(`not accepted after ${org.policy.maxRetries + 1} attempts. Last feedback:\n${feedback.join('\n')}`);

    // ---------------------------------------------------------------- merge + regression suite
    ctx.setTaskStatus(task, 'verifying', 'merging');
    const full = gates.full ?? gates.test;
    const merged = await integration.mergeVerified(
      wt.branch,
      `merge ${c.id}: ${c.title}`,
      c.kind === 'code' ? (dir) => runCommand(full, dir, gates.timeoutMs, ctx.signal) : undefined,
    );
    // a cancel kills the suite, which then "fails": that is a cancellation, not a regression (the merge was rolled back)
    ctx.throwIfCancelled();
    ctx.gate(task, 'full', merged.ok, merged.ok ? 'merged; full suite green' : `${merged.reason}: ${merged.output}`);
    if (!merged.ok) {
      ctx.setTaskStatus(task, 'failed', merged.reason === 'conflict' ? 'merge conflict with integration branch' : 'merge broke the full suite; reverted');
      return 'failed';
    }
    ctx.handoff(task, lead.id, org.master().id, 'merged');
    ctx.setTaskStatus(task, 'merged');
    return 'merged';
  } finally {
    await g.removeWorktree(ctx.repoRoot, wt, links).catch(() => undefined);
  }
}

/** QA writes the contract's test files; the orchestrator proves they fail before any implementation. */
async function redPhase(
  ctx: RunContext,
  task: TaskState,
  qa: RoleConfig,
  dir: string,
  base: string,
): Promise<{ ok: true; sha: string } | { ok: false; detail: string }> {
  const { org } = ctx;
  const c = task.contract;
  const cmd = testFilesCommand(org.gates, c.testFiles);
  let feedback: string[] = [];

  for (let attempt = 0; attempt <= org.policy.maxRetries; attempt++) {
    ctx.setTaskStatus(task, 'red', attempt ? `QA attempt ${attempt + 1}` : undefined);
    const res = await ctx.callAgent({
      role: qa,
      activity: 'testing',
      task,
      cwd: dir,
      system: qaSystem(org, qa, c, cmd),
      prompt: feedback.length ? `Your previous tests were rejected. Fix:\n- ${feedback.join('\n- ')}` : 'Write the failing acceptance tests for this contract.',
      tools: BUILD_TOOLS,
      requireSubmit: true,
      guard: { write: c.testFiles, read: ['**'], protected: [], bash: [commandPattern(cmd), ...GIT_READONLY] },
      headline: `Writing acceptance tests: ${c.title}`,
    });
    if (res.outcome === 'blocked' || res.outcome === 'scope_change') {
      return { ok: false, detail: `QA could not write tests: ${res.blocker ?? res.scopeRequest?.reason}` };
    }
    if (res.outcome === 'completed') {
      // ended without submit_work even after the reminder; the files stay for the next attempt
      ctx.gate(task, 'audit', false, 'QA ended without submit_work');
      feedback = ['You ended your session without calling submit_work. Finish the tests, run them once to see them fail, then call submit_work.'];
      continue;
    }
    // A session cut short leaves half-written tests, which would fail for the wrong reason and pass as red.
    if (res.outcome === 'budget' || res.outcome === 'error') {
      ctx.gate(task, 'audit', false, `QA session ended early (${res.outcome}); discarding its tests`);
      await g.resetHard(dir, base);
      feedback = [`Your previous session ended before you finished (${res.outcome === 'budget' ? 'it ran out of turns or budget' : 'it stopped with an error'}). Write complete tests, run them once, and call submit_work.`];
      continue;
    }

    await g.commitAll(dir, `test(${c.id}): acceptance tests [attempt ${attempt + 1}]`, org.project.linkDirs);
    const changed = await g.changedFiles(dir, base);
    const problems = auditChanges({ changed, allowed: c.testFiles });
    const missing = c.testFiles.filter((f) => !changed.includes(f));
    if (missing.length) problems.push(`test files not written: ${missing.join(', ')}`);
    ctx.gate(task, 'audit', problems.length === 0, problems.join('\n') || 'tests written in scope');
    if (problems.length) {
      await g.resetHard(dir, base);
      feedback = problems;
      continue;
    }

    const r = await runCommand(cmd, dir, org.gates.timeoutMs, ctx.signal);
    ctx.throwIfCancelled();
    // Red means the new tests fail before implementation. Passing tests prove nothing, and neither
    // do tests that never ran: a hang, or a syntax error in the test file itself. ("Cannot find
    // module" is the normal red for a module that doesn't exist yet, so it counts.)
    const why = redRejection(r, c.testFiles);
    ctx.gate(task, 'red', !why, why ?? r.output);
    if (why) {
      await g.resetHard(dir, base);
      feedback = [why];
      continue;
    }
    return { ok: true, sha: await g.head(dir) };
  }
  return { ok: false, detail: `QA failed to produce valid failing tests after ${org.policy.maxRetries + 1} attempts: ${feedback.join('; ')}` };
}

/** Why a test run does not count as "red" (failing first), or undefined when it does. */
export function redRejection(r: CommandResult, testFiles: readonly string[]): string | undefined {
  if (r.ok) return 'Your tests pass before anything is implemented, so they do not exercise the new behaviour. Assert the acceptance criteria against the code that will be written.';
  if (r.timedOut) return 'The test command timed out, so the tests never reported a result. Make them finish quickly (no waiting on servers, timers or input) and assert the acceptance criteria.';
  const own = testFiles.map((f) => f.split('/').pop()!);
  if (/SyntaxError/.test(r.output) && own.some((name) => r.output.includes(name))) {
    return `Your test file does not parse (SyntaxError), so it failed without testing anything. Fix the syntax; it should fail only because the feature is missing.\n${r.output.slice(-800)}`;
  }
  return undefined;
}
