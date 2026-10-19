import type { TeamConfigInput } from '@orchestrate/shared';

type SquadInput = TeamConfigInput['squads'][number];

/**
 * A scenario's own team shape, from its scenario.json: squads laid out like the project it
 * imitates (the game scenario mirrors CorpseGrinder's engine and gameplay squads), and a bigger
 * usage cap for work too large for the budget team's default.
 */
export interface ScenarioTeam {
  squads?: SquadInput[];
  maxRunUsd?: number;
}

const DEFAULT_SQUADS: SquadInput[] = [
  { id: 'core', name: 'Core', mission: 'domain logic', owns: ['src/core/**'], testDirs: ['test/core/**'], color: '#1985a1' },
  { id: 'api', name: 'API', mission: 'the request router', owns: ['src/api/**'], testDirs: ['test/api/**'], color: '#f2a541' },
];

/**
 * The team every scenario runs with: by default two squads (core and api) over a tiny JavaScript
 * project whose tests use node:test, each squad with a lead, a developer and QA. Kept fixed so
 * results compare across harness changes; only the model is a knob, and a scenario may bring its
 * own squads.
 */
export function evalTeam(model: string, budget = false, team: ScenarioTeam = {}): TeamConfigInput {
  const squads = team.squads ?? DEFAULT_SQUADS;
  const leads = squads.map((sq) => `${sq.id}-lead`);
  return {
    version: 1,
    project: {
      name: 'Eval',
      language: 'JavaScript',
      description: 'A tiny JavaScript (ES modules) project. Tests use node:test and node:assert/strict; run them with node --test.',
      testGlobs: ['**/*.test.js'],
    },
    defaults: { model, effort: 'medium', maxTurns: 30, maxBudgetUsd: 1.5, timeoutMs: 600_000 },
    // --budget: the levers of presets/budget.team.yaml, so a live check costs as little as a real budget run
    ...(budget ? { jobs: BUDGET_JOBS } : {}),
    gates: { test: 'node --test', testFiles: 'node --test {files}', full: 'node --test', timeoutMs: 120_000 },
    policy: {
      maxRetries: budget ? 1 : 2,
      maxChangedLines: 200,
      circleRevisionRounds: 1,
      requireHumanApproval: false,
      maxParallel: 2,
      ...(budget ? { summary: 'plain' as const, maxRunUsd: team.maxRunUsd ?? 2 } : team.maxRunUsd ? { maxRunUsd: team.maxRunUsd } : {}),
    },
    squads,
    roles: [
      { id: 'vp', title: 'VP of Engineering', kind: 'master', tier: 'exec' },
      { id: 'architect', title: 'Principal Architect', kind: 'architect', tier: 'principal' },
      ...squads.flatMap((sq) => [
        { id: `${sq.id}-lead`, title: 'Tech Lead', kind: 'lead' as const, tier: 'lead' as const, squad: sq.id },
        { id: `${sq.id}-dev`, title: 'Software Engineer', kind: 'dev' as const, tier: 'senior' as const, squad: sq.id },
        { id: `${sq.id}-qa`, title: 'QA Engineer', kind: 'qa' as const, tier: 'ic' as const, squad: sq.id },
      ]),
    ],
    techCircle: budget ? ['vp', 'architect'] : ['vp', 'architect', ...leads],
  };
}

/**
 * The model the Claude alone baseline uses: the one the team writes code with. With --budget that's
 * the budget implement model, so the comparison is like for like, not Opus against Sonnet.
 */
export function soloModel(model: string, budget = false): string {
  return (budget && BUDGET_JOBS?.implement?.model) || model;
}

const BUDGET_JOBS: TeamConfigInput['jobs'] = {
  plan: { model: 'claude-sonnet-5-5', effort: 'high' },
  implement: { model: 'claude-sonnet-5-5', effort: 'medium' },
  qa: { model: 'claude-sonnet-5-5', effort: 'low', maxTurns: 15 },
  circle: { model: 'claude-haiku-5-5', effort: 'low', maxTurns: 8, maxBudgetUsd: 0.3 },
  review: { model: 'claude-haiku-5-5', effort: 'low', maxTurns: 10, maxBudgetUsd: 0.3 },
  ruling: { model: 'claude-haiku-5-5', effort: 'low', maxTurns: 6, maxBudgetUsd: 0.2 },
};
