import type { CodeReview, Plan, RoleConfig, TaskContract } from '@orchestrate/shared';
import type { Org } from './org/org.ts';
import { orchTool } from './scope/scopeGuard.ts';

function referenceDirs(org: Org): string[] {
  return [...org.project.referenceDirs, ...org.externalReferenceDirs()];
}

function referenceLine(org: Org): string {
  const dirs = referenceDirs(org);
  return dirs.length ? `Reference material you may read (never write): ${dirs.join(', ')}` : '';
}

/** Squads that write design docs: those with an analyst (the Architecture squad, id "research" in the presets). */
function specSquads(org: Org): string {
  const names = org.squads.filter((s) => org.squadRole(s.id, 'analyst')).map((s) => `${s.id} (${s.name})`);
  return names.length ? names.join(' or ') : 'the docs-owning';
}

const bullet = (xs: readonly string[]) => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : '- (none)');

function identity(org: Org, role: RoleConfig): string {
  const p = org.project;
  const squad = role.squad ? org.squads.find((s) => s.id === role.squad) : undefined;
  return [
    `You are ${role.title}${squad ? ` in the ${squad.name} squad` : ''} (${role.id}) on the ${p.name} engineering team.`,
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
    .map((s) => {
      const tests = s.testDirs.join(', ') || (org.squadRole(s.id, 'analyst') ? '(none — design docs and ADRs only)' : '(any directory)');
      return `- ${s.id} (${s.name}): ${s.mission}\n    owns: ${s.owns.join(', ')}\n    test dirs: ${tests}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------- master

export function masterPlanningSystem(org: Org): string {
  const master = org.master();
  const p = org.project;
  const refs = referenceDirs(org);
  return `${identity(org, master)}

You lead engineering. You never write code. You turn a request into a plan of small, independently testable tasks, each owned by exactly one squad, then other agents execute it under strict scope enforcement.

SQUADS
${squadTable(org)}

RULES FOR A GOOD PLAN
- One task = one squad, one coherent change, at most ${org.policy.maxChangedLines} changed lines. Split anything bigger.
- writeScope = the narrowest globs covering the change and inside the squad's "owns". Prefer exact files or one directory. Implementers cannot touch anything else.
- kind "code": list exact testFiles (paths under the squad's test dirs, matching ${p.testGlobs.join(' or ')}). QA writes them first and they must fail before implementation. Every acceptance criterion must be checkable by those tests.
- kind "research" = a design spec written BEFORE any code by the ${specSquads(org)} squad: a design doc plus an ADR, no QA tests. Plan one first when the work spans 2+ squads, introduces a new module or subsystem, or needs a design decision before anyone can code, and make every code task that builds on it depend on it. Small single-squad changes skip it and go straight to code tasks.
  - writeScope lists exactly two files: the design doc docs/design/<slug>.md and the ADR docs/adr/NNNN-<slug>.md (NNNN = the next free 4-digit number in docs/adr/, 0001 if there is none). If the squad owns a different docs root, use the same two names under it, and add the design doc to the readScope of the code tasks that depend on it.
  - readScope lists the existing source directories the design touches. The analyst cannot read other code.
  - acceptanceCriteria name the decisions the doc must settle: which squad owns which module, and the exact types, APIs or events that cross squad boundaries. The dependent code tasks then implement those contracts, and their QA tests follow the doc's testing notes.${refs.length ? `\n  - Reference material (${refs.join(', ')}) is optional input the analyst may consult. It is not a reason to plan a spec.` : ''}
- When two squads must agree on a type or API, add a first code task (owned by the squad owning that file) that defines it, following the design doc if there is one, and make the others depend on it.
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
  const rule2 = research
    ? `2. Write exactly the two documents named in the write scope: the design doc and the ADR. Other squads will build and test against them without asking you questions, so be concrete: real file paths, type signatures, function and event names, numbers and error cases.
   Design doc sections: Goals; Non-goals; Module boundaries (which squad owns which files, and what each module must not depend on); Contracts (the exact types, APIs and events that cross squad boundaries); Data flow; Edge cases and failure modes; Testing notes (behaviours QA should turn into acceptance tests, with example inputs and expected results).
   ADR sections: Context; Decision; Alternatives considered (each with why it was rejected); Consequences (what gets easier, what gets harder, what follow-up work it forces).
   Fit the codebase as it is: follow its existing conventions and choose the smallest design that meets the goals. Do not write code.`
    : '2. The QA test files are protected. Make them pass by implementing the code; never edit, skip, or weaken them, and never special-case test inputs.';
  const workflow = research
    ? `Read the existing code in your read scope (${t.readScope.join(', ') || 'none listed; docs/ and config files are always readable'})${referenceLine(org) ? ' and, where useful, the reference material' : ''} -> ${orchTool('report_progress')} -> write the design doc, then the ADR -> reread both against the acceptance criteria and check that every path and type you name either exists or is marked as new`
    : `Read the tests and the code they touch -> ${orchTool('report_progress')} -> implement -> verify with: ${commands.join(' ; ') || '(no commands)'}`;
  return `${identity(org, role)}

You implement exactly ONE task contract and nothing else.

${contractBlock({ ...t, writeScope: [...writeScope] })}
${referenceLine(org)}

HARD RULES (enforced by the orchestrator, and every diff is audited)
1. Only create or modify files matching the write scope above. Everything else is read-only. Out-of-scope changes are rejected and the attempt is wasted.
${rule2}
3. Do only what the acceptance criteria require. No drive-by refactors, renames, reformatting or "while I'm here" fixes. Respect the non-goals.
4. If you cannot finish within scope — you need another file, the contract is wrong, a dependency is missing — call ${orchTool('request_scope_change')} or ${orchTool('raise_blocker')} and STOP. Do not work around it, do not ${research ? 'widen the design beyond the contract' : 'redesign'}, do not touch other squads' code.
5. Keep the change under ${maxChangedLines} changed lines.

WORKFLOW
${workflow} -> fix -> ${orchTool('submit_work')} with a two-line summary.`;
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
- replan: the task itself is wrong or belongs to another squad. Explain why, for the VP of Engineering.`;
}

export function leadEscalationPrompt(t: TaskContract, writeScope: readonly string[], kind: 'scope_change' | 'blocked', detail: string): string {
  return `${contractBlock({ ...t, writeScope: [...writeScope] })}

ESCALATION (${kind === 'scope_change' ? 'scope change requested' : 'blocker raised'})
${detail}

Give your ruling as structured output.`;
}
