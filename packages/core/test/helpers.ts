import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Plan, TaskContract, TeamConfigInput } from '@orchestrate/shared';
import { Org } from '../src/org/org.ts';

export function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' }).trim();
}

/** A tiny ESM project with node:test, committed on main. */
export function makeFixtureRepo(): { root: string; repo: string; work: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'orch-'));
  const repo = path.join(root, 'game');
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  mkdirSync(path.join(repo, 'test'), { recursive: true });
  writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'game', type: 'module' }, null, 2));
  writeFileSync(path.join(repo, 'src', 'core.js'), 'export const VERSION = 1;\n');
  writeFileSync(path.join(repo, 'test', 'core.test.js'), "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { VERSION } from '../src/core.js';\ntest('version', () => assert.equal(VERSION, 1));\n");
  sh(repo, 'init', '-q', '-b', 'main');
  sh(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
  sh(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  return { root, repo, work: path.join(root, 'work') };
}

export function fixtureOrg(overrides: Partial<TeamConfigInput> = {}): Org {
  return Org.fromConfig({
    version: 1,
    project: { name: 'Fixture', language: 'JavaScript', testGlobs: ['**/*.test.js'] },
    defaults: { model: 'fake', maxTurns: 5, maxBudgetUsd: 1, timeoutMs: 60_000 },
    gates: { test: 'node --test', testFiles: 'node --test {files}', full: 'node --test', timeoutMs: 60_000 },
    policy: { maxRetries: 2, maxChangedLines: 200, circleRevisionRounds: 1, requireHumanApproval: false, maxParallel: 2 },
    squads: [
      { id: 'core', name: 'Core', mission: 'core logic', owns: ['src/**'], testDirs: ['test/**'] },
      { id: 'docs', name: 'Docs', mission: 'specs', owns: ['docs/**'] },
    ],
    roles: [
      { id: 'boss', title: 'Head of Engineering', kind: 'master', tier: 'exec' },
      { id: 'arch', title: 'Architect', kind: 'architect', tier: 'principal' },
      { id: 'core-lead', title: 'Core Lead', kind: 'lead', tier: 'lead', squad: 'core' },
      { id: 'core-dev', title: 'Core Dev', kind: 'dev', tier: 'senior', squad: 'core' },
      { id: 'core-qa', title: 'Core QA', kind: 'qa', tier: 'ic', squad: 'core' },
      { id: 'docs-analyst', title: 'Analyst', kind: 'analyst', tier: 'senior', squad: 'docs' },
    ],
    techCircle: ['boss', 'arch', 'core-lead'],
    ...overrides,
  });
}

export function codeTask(over: Partial<TaskContract> & { id: string }): TaskContract {
  return {
    title: `Task ${over.id}`,
    squad: 'core',
    kind: 'code',
    objective: 'implement it',
    acceptanceCriteria: ['it works'],
    nonGoals: ['anything else'],
    writeScope: [`src/${over.id}.js`],
    readScope: [],
    testFiles: [`test/${over.id}.test.js`],
    dependsOn: [],
    testPlan: 'unit test',
    ...over,
  };
}

export const planOf = (...tasks: TaskContract[]): Plan => ({ summary: 'plan', tasks, risks: [] });

export const sumTest = `import { test } from 'node:test';
import assert from 'node:assert';
import { sum } from '../src/sum.js';
test('sum adds', () => assert.equal(sum(2, 3), 5));
`;
export const sumImpl = 'export const sum = (a, b) => a + b;\n';
