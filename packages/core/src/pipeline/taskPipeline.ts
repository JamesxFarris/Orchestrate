import path from 'node:path';
import { CodeReview, EscalationDecision, type RoleConfig, type TaskState } from '@orchestrate/shared';
import { auditChanges, runCommand, testFilesCommand } from '../gates/gates.ts';
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
    const commands = c.kind === 'code' ? [testFilesCommand(gates, c.testFiles), gates.typecheck].filter((x): x is string => !!x) : [];
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
        attempt--; // a ruling is not a failed attempt; MAX_ESCALATIONS bounds this loop
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
      guard: { write: c.testFiles, read: ['**'], protected: [], bash: [commandPattern(cmd), ...GIT_READONLY] },
      headline: `Writing acceptance tests: ${c.title}`,
    });
    if (res.outcome === 'blocked' || res.outcome === 'scope_change') {
      return { ok: false, detail: `QA could not write tests: ${res.blocker ?? res.scopeRequest?.reason}` };
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
    // Red means the new tests fail before implementation. Passing tests prove nothing.
    ctx.gate(task, 'red', !r.ok, r.ok ? 'tests PASS without implementation — they do not test the new behaviour' : r.output);
    if (r.ok) {
      await g.resetHard(dir, base);
      feedback = ['Your tests pass before anything is implemented, so they do not exercise the new behaviour. Assert the acceptance criteria against the code that will be written.'];
      continue;
    }
    return { ok: true, sha: await g.head(dir) };
  }
  return { ok: false, detail: `QA failed to produce valid failing tests after ${org.policy.maxRetries + 1} attempts: ${feedback.join('; ')}` };
}
