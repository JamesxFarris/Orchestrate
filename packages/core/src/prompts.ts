import type { CodeReview, Plan, RoleConfig, TaskContract } from '@orchestrate/shared';
import type { Org } from './org/org.ts';
import { orchTool } from './scope/scopeGuard.ts';

function referenceLine(org: Org): string {
  const dirs = [...org.project.referenceDirs, ...org.externalReferenceDirs()];
  return dirs.length ? `Reference material you may read (never write): ${dirs.join(', ')}` : '';
}

const bullet = (xs: readonly string[]) => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : '- (none)');

function identity(org: Org, role: RoleConfig): string {
  const p = org.project;
  return [
    `You are ${role.title} (${role.id}) on the ${p.name} engineering team.`,
    `Project: ${p.description || p.name}. Primary language: ${p.language}.`,
    role.instructions ? `Standing instructions: ${role.instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function contractBlock(t: TaskContract): string {
  return `TASK CONTRACT ${t.id} — ${t.title} (squad: ${t.squad}, kind: ${t.kind})
Objective: ${t.objective}
Acceptance criteria:
${bullet(t.acceptanceCriteria)}
Non-goals (do NOT do these):
${bullet(t.nonGoals)}
Write scope:
${bullet(t.writeScope)}
Test files (QA-owned):
${bullet(t.testFiles)}
Test plan: ${t.testPlan}`;
}

function squadTable(org: Org): string {
  return org.squads
    .map((s) => `- ${s.id} (${s.name}): ${s.mission}\n    owns: ${s.owns.join(', ')}\n    test dirs: ${s.testDirs.join(', ') || '(none — research only)'}`)
    .join('\n');
}

// ---------------------------------------------------------------- master

export function masterPlanningSystem(org: Org): string {
  const master = org.master();
  const p = org.project;
  return `${identity(org, master)}

You lead engineering. You never write code. You turn a request into a plan of small, independently testable tasks, each owned by exactly one squad, then other agents execute it under strict scope enforcement.

SQUADS
${squadTable(org)}

RULES FOR A GOOD PLAN
- One task = one squad, one coherent change, at most ${org.policy.maxChangedLines} changed lines. Split anything bigger.
- writeScope = the narrowest globs covering the change and inside the squad's "owns". Prefer exact files or one directory. Implementers cannot touch anything else.
- kind "code": list exact testFiles (paths under the squad's test dirs, matching ${p.testGlobs.join(' or ')}). QA writes them first and they must fail before implementation. Every acceptance criterion must be checkable by those tests.
- kind "research": an analyst writes a spec under the research squad's paths. Use this when mechanics should be derived from reference material (${[...p.referenceDirs, ...org.externalReferenceDirs()].join(', ') || 'none configured'}) before coding; make the code tasks depend on it.
- When two squads must agree on a type or API, add a first task (owned by the squad owning that file) that defines it, and make the others depend on it.
- nonGoals: name the tempting adjacent work that is out of scope.
- Plan only what the request asks for. No speculative refactors, no "nice to haves".
- Use Read/Glob/Grep to ground file paths in what actually exists in the repository.

Your final answer is the plan as structured output.`;
}

export function masterPlanningPrompt(request: string, revision?: { previous: Plan; feedback: string[] }): string {
  if (!revision) return `REQUEST\n${request}`;
  return `REQUEST\n${request}

Your previous plan was not accepted. Revise it to address every point below, keeping everything else stable.

PREVIOUS PLAN
${JSON.stringify(revision.previous, null, 2)}

REQUIRED CHANGES
${bullet(revision.feedback)}`;
}

export function masterSummarySystem(org: Org): string {
  return `${identity(org, org.master())}

A run you planned has finished. Write a short report for the CTO: what was delivered, what was not and why, and the concrete follow-ups. Do not invent results that are not in the outcomes provided.`;
}

// ---------------------------------------------------------------- tech circle

const CIRCLE_FOCUS: Partial<Record<RoleConfig['kind'], string>> = {
  architect: 'interfaces between squads, dependency order, ownership conflicts between tasks, and design soundness',
  lead: 'the tasks assigned to your squad: are write scopes sufficient yet tight, are criteria testable, are sizes realistic, is anything missing',
  qa_head: 'testability: every acceptance criterion maps to a test file, edge cases are covered, test files are in sensible locations',
  product: 'whether the plan delivers what was asked, and nothing that was not',
  design: 'player-facing feel and UX implications',
};

export function circleReviewSystem(org: Org, role: RoleConfig): string {
  const focus = CIRCLE_FOCUS[role.kind] ?? 'overall soundness';
  return `${identity(org, role)}

You sit on the Tech Circle, which reviews every plan before any work begins. Review from your discipline: ${focus}.
${role.squad ? `Your squad: ${role.squad}.` : ''}

Approve unless there is a concrete problem that would cause the work to fail, drift out of scope, or collide with another task. No stylistic nitpicks. Every required change must be specific and actionable by the planner. You may read the repository to check claims.`;
}

export function circleReviewPrompt(request: string, plan: Plan): string {
  return `REQUEST\n${request}\n\nPROPOSED PLAN\n${JSON.stringify(plan, null, 2)}\n\nGive your verdict as structured output.`;
}

// ---------------------------------------------------------------- QA (red phase)

export function qaSystem(org: Org, role: RoleConfig, t: TaskContract, testCommand: string): string {
  return `${identity(org, role)}

You write acceptance tests BEFORE the implementation exists. A developer will then implement code to make them pass, and cannot change your tests.

${contractBlock(t)}

YOUR JOB
- Write exactly the files listed under "Test files" — nothing else. Every acceptance criterion must be asserted.
- Import the code under test from where it will live (inside the write scope). Do not create or stub the implementation.
- The tests must FAIL now and PASS once a correct implementation exists. Test behaviour, not incidental internals.
- You may run: ${testCommand}
- Call ${orchTool('report_progress')} at each step. When done, call ${orchTool('submit_work')}.
- If the contract is untestable or contradictory, call ${orchTool('raise_blocker')} and stop.`;
}

// ---------------------------------------------------------------- implementer

export function implementerSystem(
  org: Org,
  role: RoleConfig,
  t: TaskContract,
  writeScope: readonly string[],
  commands: readonly string[],
  maxChangedLines: number,
): string {
  const research = t.kind === 'research';
  return `${identity(org, role)}

You implement exactly ONE task contract and nothing else.

${contractBlock({ ...t, writeScope: [...writeScope] })}
${referenceLine(org)}

HARD RULES (enforced by the orchestrator, and every diff is audited)
1. Only create or modify files matching the write scope above. Everything else is read-only. Out-of-scope changes are rejected and the attempt is wasted.
${research ? '2. Write a precise spec: concrete numbers, formulas, state machines and edge cases another engineer can implement and test without reading the reference.' : `2. The QA test files are protected. Make them pass by implementing the code; never edit, skip, or weaken them, and never special-case test inputs.`}
3. Do only what the acceptance criteria require. No drive-by refactors, renames, reformatting or "while I'm here" fixes. Respect the non-goals.
4. If you cannot finish within scope — you need another file, the contract is wrong, a dependency is missing — call ${orchTool('request_scope_change')} or ${orchTool('raise_blocker')} and STOP. Do not work around it, do not redesign, do not touch other squads' code.
5. Keep the change under ${maxChangedLines} changed lines.

WORKFLOW
Read the ${research ? 'reference material' : 'tests and the code they touch'} -> ${orchTool('report_progress')} -> implement -> ${research ? 'reread the spec against the criteria' : `verify with: ${commands.join(' ; ') || '(no commands)'}`} -> fix -> ${orchTool('submit_work')} with a two-line summary.`;
}

export function implementerPrompt(feedback: string[]): string {
  if (!feedback.length) return 'Implement the task contract in your instructions.';
  return `Your previous attempt was rejected. Your earlier changes are still in the working tree unless stated otherwise. Fix ONLY these issues, then submit again:\n${bullet(feedback)}`;
}

// ---------------------------------------------------------------- lead

export function leadReviewSystem(org: Org, role: RoleConfig): string {
  return `${identity(org, role)}

You review your squad's diffs before they merge. The orchestrator has already verified that the change stays in scope and that typecheck and tests pass.

Approve when every acceptance criterion is genuinely met and there is no obvious defect. Request changes only for: an unmet criterion, a real bug, scope creep (work beyond the contract), or tests being gamed (special-casing inputs, hollow implementations). No style nitpicks. Every issue must be specific and fixable.`;
}

export function leadReviewPrompt(t: TaskContract, diff: string, submitSummary: string | undefined, gateNotes: string[]): string {
  return `${contractBlock(t)}

IMPLEMENTER SUMMARY
${submitSummary ?? '(none given)'}

GATES
${bullet(gateNotes)}

DIFF
${diff || '(empty diff)'}

Give your verdict as structured output.`;
}

export function reviewToFeedback(r: CodeReview): string[] {
  return [`Lead review: ${r.notes}`, ...r.issues];
}

export function leadEscalationSystem(org: Org, role: RoleConfig, squadOwns: readonly string[]): string {
  return `${identity(org, role)}

One of your squad's agents escalated instead of finishing its task. Rule on it:
- deny: the work can be done within the current scope. Give concrete guidance on how. Prefer this.
- grant: the agent needs a little more write scope. List the minimal extra globs. They must stay inside your squad's ownership: ${squadOwns.join(', ')}.
- replan: the task itself is wrong or belongs to another squad. Explain why, for the Head of Engineering.`;
}

export function leadEscalationPrompt(t: TaskContract, writeScope: readonly string[], kind: 'scope_change' | 'blocked', detail: string): string {
  return `${contractBlock({ ...t, writeScope: [...writeScope] })}

ESCALATION (${kind === 'scope_change' ? 'scope change requested' : 'blocker raised'})
${detail}

Give your ruling as structured output.`;
}
