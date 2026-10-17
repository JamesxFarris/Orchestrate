import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FakeRunner, type FakeAgentContext } from '@orchestrate/core';
import { filesIn, type Scenario } from './scenario.ts';

/** Which role a session plays, from its system prompt (the same markers the pipeline tests use). */
function phaseOf(ctx: FakeAgentContext) {
  const s = ctx.inv.systemPrompt;
  if (s.includes('Tech Circle')) return 'circle';
  if (s.includes('You review your squad')) return 'review';
  if (s.includes('escalated instead of finishing')) return 'escalation';
  if (s.includes('write acceptance tests BEFORE')) return 'qa';
  if (s.includes('A run you planned has finished')) return 'summary';
  if (s.includes('You lead engineering')) return 'plan';
  return 'implement';
}

/**
 * A team that does everything right, for free: the VP proposes the reference plan, QA writes the
 * hidden judge tests as its acceptance tests, implementers write the reference solution (only the
 * files in their own write scope), and every review approves. A run with this team must score
 * perfectly, which checks the scenario and the scoring before any real agent is paid to try.
 */
export function scriptedTeam(scenario: Scenario): FakeRunner {
  const solutionDir = path.join(scenario.dir, 'solution');
  const solution = filesIn(solutionDir);
  return new FakeRunner((ctx) => {
    switch (phaseOf(ctx)) {
      case 'plan':
        return { structured: scenario.plan, costUsd: 0 };
      case 'circle':
        return { structured: { verdict: 'approve', concerns: [], requiredChanges: [] } };
      case 'review':
        return { structured: { verdict: 'approve', notes: 'Meets the contract.', issues: [] } };
      case 'escalation':
        return { structured: { decision: 'deny', addWriteScope: [], guidance: 'Stay in scope.' } };
      case 'summary':
        return { structured: { summary: `Delivered: ${scenario.title}.`, followUps: [] } };
      case 'qa': {
        const task = scenario.plan.tasks.find((t) => t.id === ctx.inv.taskId)!;
        for (const file of task.testFiles) ctx.write(file, readFileSync(path.join(scenario.dir, 'hidden', scenario.reference[file]!), 'utf8'));
        ctx.submit('acceptance tests written');
        return;
      }
      case 'implement': {
        const task = scenario.plan.tasks.find((t) => t.id === ctx.inv.taskId)!;
        for (const file of solution.filter((f) => task.writeScope.includes(f))) ctx.write(file, readFileSync(path.join(solutionDir, file), 'utf8'));
        ctx.submit(`implemented ${task.title}`);
        return;
      }
    }
  });
}
