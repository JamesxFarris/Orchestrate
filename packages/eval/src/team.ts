import type { TeamConfigInput } from '@orchestrate/shared';

/**
 * The team every scenario runs with: two squads (core and api) over a tiny JavaScript project
 * whose tests use node:test. Kept fixed so results compare across harness changes; only the
 * model is a knob.
 */
export function evalTeam(model: string): TeamConfigInput {
  return {
    version: 1,
    project: {
      name: 'Eval',
      language: 'JavaScript',
      description: 'A tiny JavaScript (ES modules) project. Tests use node:test and node:assert/strict; run them with node --test.',
      testGlobs: ['**/*.test.js'],
    },
    defaults: { model, effort: 'medium', maxTurns: 30, maxBudgetUsd: 1.5, timeoutMs: 600_000 },
    gates: { test: 'node --test', testFiles: 'node --test {files}', full: 'node --test', timeoutMs: 120_000 },
    policy: { maxRetries: 2, maxChangedLines: 200, circleRevisionRounds: 1, requireHumanApproval: false, maxParallel: 2 },
    squads: [
      { id: 'core', name: 'Core', mission: 'domain logic', owns: ['src/core/**'], testDirs: ['test/core/**'], color: '#1985a1' },
      { id: 'api', name: 'API', mission: 'the request router', owns: ['src/api/**'], testDirs: ['test/api/**'], color: '#f2a541' },
    ],
    roles: [
      { id: 'vp', title: 'VP of Engineering', kind: 'master', tier: 'exec' },
      { id: 'architect', title: 'Principal Architect', kind: 'architect', tier: 'principal' },
      { id: 'core-lead', title: 'Tech Lead', kind: 'lead', tier: 'lead', squad: 'core' },
      { id: 'core-dev', title: 'Software Engineer', kind: 'dev', tier: 'senior', squad: 'core' },
      { id: 'core-qa', title: 'QA Engineer', kind: 'qa', tier: 'ic', squad: 'core' },
      { id: 'api-lead', title: 'Tech Lead', kind: 'lead', tier: 'lead', squad: 'api' },
      { id: 'api-dev', title: 'Software Engineer', kind: 'dev', tier: 'senior', squad: 'api' },
      { id: 'api-qa', title: 'QA Engineer', kind: 'qa', tier: 'ic', squad: 'api' },
    ],
    techCircle: ['vp', 'architect', 'core-lead', 'api-lead'],
  };
}
