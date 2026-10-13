import { z } from 'zod';

/**
 * The unit of work handed to exactly one squad. Everything an agent is allowed to do is derived
 * from this contract; nothing outside it is in scope.
 */
export const TaskContract = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'task ids are lowercase-kebab, e.g. "wave-spawner"'),
  title: z.string().min(3).max(80),
  squad: z.string(),
  kind: z
    .enum(['code', 'research'])
    .describe('code = QA writes failing tests, dev implements. research = analyst writes a spec document, no tests.'),
  objective: z.string().describe('One paragraph: what must be true when this task is done.'),
  acceptanceCriteria: z
    .array(z.string())
    .min(1)
    .describe('Each criterion must be verifiable by an automated test (or, for research, by reading the spec).'),
  nonGoals: z.array(z.string()).describe('Tempting adjacent work that is explicitly out of scope.'),
  writeScope: z
    .array(z.string())
    .min(1)
    .describe('Repo-relative globs the implementer may create/modify. Keep as narrow as possible.'),
  readScope: z
    .array(z.string())
    .describe('Extra repo-relative globs to read beyond the write scope. Use ["**"] only if genuinely needed.'),
  testFiles: z
    .array(z.string())
    .describe('Exact repo-relative paths of test files QA will write for this task. Empty for research tasks.'),
  dependsOn: z.array(z.string()).describe('Task ids that must merge before this one starts.'),
  testPlan: z.string().describe('How the acceptance criteria map onto the test files.'),
  maxChangedLines: z.number().int().positive().optional(),
});
export type TaskContract = z.infer<typeof TaskContract>;

export const Plan = z.object({
  summary: z.string().describe('Two or three sentences: the approach, for the human approver.'),
  tasks: z.array(TaskContract).min(1),
  risks: z.array(z.string()),
});
export type Plan = z.infer<typeof Plan>;

/** A Tech Circle member's verdict on a proposed plan. */
export const CircleReview = z.object({
  verdict: z.enum(['approve', 'revise']),
  concerns: z.array(z.string()),
  requiredChanges: z
    .array(z.string())
    .describe('Concrete edits the master must make. Empty when approving.'),
});
export type CircleReview = z.infer<typeof CircleReview>;

/** A squad lead's verdict on an implementer's diff. */
export const CodeReview = z.object({
  verdict: z.enum(['approve', 'changes_requested']),
  notes: z.string(),
  issues: z.array(z.string()).describe('Each issue tied to an acceptance criterion or a scope violation.'),
});
export type CodeReview = z.infer<typeof CodeReview>;

/** A squad lead's ruling when an implementer escalates (scope change or blocker). */
export const EscalationDecision = z.object({
  decision: z
    .enum(['grant', 'deny', 'replan'])
    .describe('grant = widen write scope; deny = stay in scope, follow guidance; replan = the task itself is wrong'),
  addWriteScope: z.array(z.string()).describe('Globs to add when granting. Must stay inside the squad\'s owned paths.'),
  guidance: z.string().describe('Instructions for the implementer\'s next attempt, or the reason for replanning.'),
});
export type EscalationDecision = z.infer<typeof EscalationDecision>;

export const RunSummary = z.object({
  summary: z.string(),
  followUps: z.array(z.string()),
});
export type RunSummary = z.infer<typeof RunSummary>;
