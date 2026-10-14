import { z } from 'zod';

/** What an agent does in the org. Drives prompts, tools and which pipeline phase it serves. */
export const RoleKind = z.enum([
  'master', // VP of Engineering: intake, planning, final summary
  'architect', // Principal Architect: contracts, cross-squad interfaces
  'lead', // Tech Lead (manages a squad): plan review, code review, escalations
  'dev', // Software Engineer: implements one task
  'qa', // QA Engineer: writes failing acceptance tests first
  'qa_head', // QA Manager: test strategy, sits on the tech circle
  'analyst', // Systems Analyst (Architecture squad): writes the design doc + ADR for "research" tasks; no code, no tests
  'product', // optional: Product Manager
  'design', // optional: Product Designer
]);
export type RoleKind = z.infer<typeof RoleKind>;

/** Seniority tier. The city uses it for building height. */
export const Tier = z.enum(['exec', 'principal', 'lead', 'senior', 'ic']);
export type Tier = z.infer<typeof Tier>;

export const Effort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export type Effort = z.infer<typeof Effort>;

export const AgentRuntime = z.object({
  model: z.string().default('claude-opus-5-5'),
  effort: Effort.default('high'),
  maxTurns: z.number().int().positive().default(40),
  maxBudgetUsd: z.number().positive().default(5),
  timeoutMs: z.number().int().positive().default(20 * 60_000),
});
export type AgentRuntime = z.infer<typeof AgentRuntime>;

export const RoleConfig = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'role ids are lowercase-kebab'),
  title: z.string(),
  kind: RoleKind,
  tier: Tier,
  /** Squad this role belongs to. Omitted = HQ (master, architect, heads of chapters). */
  squad: z.string().optional(),
  reportsTo: z.string().optional(),
  enabled: z.boolean().default(true),
  /** Extra standing instructions appended to the role prompt. */
  instructions: z.string().optional(),
  runtime: AgentRuntime.partial().optional(),
});
export type RoleConfig = z.infer<typeof RoleConfig>;

export const SquadConfig = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  /** Accent colour for the squad's district in the city. */
  color: z.string().default('#f59e0b'),
  mission: z.string(),
  /** Globs (repo-relative) this squad may ever write. Task write scopes must sit inside these. */
  owns: z.array(z.string()).min(1),
  /** Globs where this squad's QA may place test files. */
  testDirs: z.array(z.string()).default([]),
});
export type SquadConfig = z.infer<typeof SquadConfig>;

export const GateConfig = z.object({
  /** Run once after creating a worktree, e.g. "npm ci". Prefer project.linkDirs for speed. */
  setup: z.string().optional(),
  typecheck: z.string().optional(),
  lint: z.string().optional(),
  /** Whole unit suite. */
  test: z.string(),
  /** Command for specific files. `{files}` is replaced with space-separated paths. */
  testFiles: z.string().optional(),
  /** Suite run on the integration branch after every merge. Defaults to `test`. */
  full: z.string().optional(),
  timeoutMs: z.number().int().positive().default(10 * 60_000),
});
export type GateConfig = z.infer<typeof GateConfig>;

export const Policy = z.object({
  /** Dev attempts after the first before a task escalates to its lead. */
  maxRetries: z.number().int().min(0).default(2),
  /** Default cap on added+removed lines per task; the master must split anything larger. */
  maxChangedLines: z.number().int().positive().default(400),
  circleRevisionRounds: z.number().int().min(0).default(2),
  requireHumanApproval: z.boolean().default(true),
  maxParallel: z.number().int().positive().default(3),
});
export type Policy = z.infer<typeof Policy>;

export const ProjectConfig = z.object({
  name: z.string(),
  language: z.string(),
  repoPath: z.string().optional(),
  defaultBranch: z.string().default('main'),
  /** Read-only reference material all agents may read (e.g. decompiled sources). */
  referenceDirs: z.array(z.string()).default([]),
  /**
   * Absolute directories OUTSIDE the repo that every agent may read (never write), e.g. an
   * AssetRipper export of a decompiled game. Relative paths resolve against the team file.
   */
  externalReferenceDirs: z.array(z.string()).default([]),
  /** Globs identifying test files anywhere in the repo. Devs may not touch QA's test files. */
  testGlobs: z.array(z.string()).default(['**/*.test.*', '**/*.spec.*']),
  /** Directories junctioned from the main checkout into each worktree (e.g. node_modules). */
  linkDirs: z.array(z.string()).default([]),
  /** Short description injected into every prompt. */
  description: z.string().default(''),
});
export type ProjectConfig = z.infer<typeof ProjectConfig>;

export const TeamConfig = z.object({
  version: z.literal(1),
  project: ProjectConfig,
  defaults: AgentRuntime.default(AgentRuntime.parse({})),
  gates: GateConfig,
  policy: Policy.default(Policy.parse({})),
  squads: z.array(SquadConfig).min(1),
  roles: z.array(RoleConfig).min(1),
  /** Role ids sitting on the Tech Circle. */
  techCircle: z.array(z.string()).default([]),
});
export type TeamConfig = z.infer<typeof TeamConfig>;
export type TeamConfigInput = z.input<typeof TeamConfig>;

/**
 * A role's name for display. Titles follow industry standards and repeat across squads (every squad
 * has a "Tech Lead"), so the squad always travels with the title: "Tech Lead · Render & UI".
 */
export function roleName(role: { title: string; squad?: string }, squads: readonly { id: string; name: string }[]): string {
  const squad = role.squad ? squads.find((s) => s.id === role.squad) : undefined;
  return squad ? `${role.title} · ${squad.name}` : role.title;
}
