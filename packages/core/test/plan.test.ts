import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Plan, TaskContract, TaskStatus } from '@orchestrate/shared';
import { Org, TeamConfigError } from '../src/org/org.ts';
import { schedule, topoOrder } from '../src/plan/dag.ts';
import { validatePlan } from '../src/plan/validatePlan.ts';

const preset = path.resolve(import.meta.dirname, '../../../presets/corpsegrinder.team.yaml');
const org = Org.load(preset);

function task(over: Partial<TaskContract> & { id: string }): TaskContract {
  return {
    title: `Task ${over.id}`,
    squad: 'gameplay',
    kind: 'code',
    objective: 'do it',
    acceptanceCriteria: ['works'],
    nonGoals: [],
    writeScope: ['src/sim/waves/**'],
    readScope: [],
    testFiles: ['tests/spawner.test.ts'],
    dependsOn: [],
    testPlan: 'unit tests',
    ...over,
  };
}

const plan = (...tasks: TaskContract[]): Plan => ({ summary: 's', tasks, risks: [] });

describe('Org (corpsegrinder preset)', () => {
  it('loads and resolves the org chart', () => {
    expect(org.master().id).toBe('head-of-eng');
    expect(org.lead('gameplay').id).toBe('gameplay-lead');
    expect(org.implementer('research', 'research')?.id).toBe('research-analyst');
    expect(org.implementer('gameplay', 'code')?.id).toBe('gameplay-dev');
    expect(org.squadRole('engine', 'qa')?.id).toBe('engine-qa');
    expect(org.circle().map((r) => r.id)).toContain('architect');
    expect(org.roles.some((r) => r.id === 'head-of-product')).toBe(false); // disabled
  });

  it('merges runtime defaults with role overrides', () => {
    const qaHead = org.runtimeFor(org.role('head-of-qa'));
    expect(qaHead.effort).toBe('medium');
    expect(qaHead.model).toBe('claude-opus-5-5');
  });

  it('rejects broken configs with actionable problems', () => {
    const bad = {
      version: 1,
      project: { name: 'x', language: 'ts' },
      gates: { test: 'npm test' },
      squads: [{ id: 'a', name: 'A', mission: 'm', owns: ['src/**'] }],
      roles: [
        { id: 'boss', title: 'Boss', kind: 'master', tier: 'exec' },
        { id: 'dev', title: 'Dev', kind: 'dev', tier: 'ic', squad: 'nope', reportsTo: 'ghost' },
      ],
      techCircle: ['missing'],
    };
    expect(() => Org.fromConfig(bad)).toThrow(TeamConfigError);
    try {
      Org.fromConfig(bad);
    } catch (e) {
      const problems = (e as TeamConfigError).problems.join('\n');
      expect(problems).toMatch(/unknown squad "nope"/);
      expect(problems).toMatch(/unknown role "ghost"/);
      expect(problems).toMatch(/squad "a" has no enabled dev/);
      expect(problems).toMatch(/techCircle member "missing"/);
    }
  });
});

describe('validatePlan', () => {
  it('accepts a well-scoped plan', () => {
    const p = plan(
      task({ id: 'spec', squad: 'research', kind: 'research', writeScope: ['docs/specs/waves.md'], testFiles: [] }),
      task({ id: 'spawner', dependsOn: ['spec'] }),
    );
    expect(validatePlan(p, org)).toEqual([]);
  });

  it.each<[string, TaskContract, RegExp]>([
    ['unknown squad', task({ id: 'a', squad: 'audio' }), /unknown squad "audio"/],
    ['scope outside ownership', task({ id: 'a', writeScope: ['src/core/**'] }), /outside squad "gameplay" ownership/],
    ['unbounded scope', task({ id: 'a', writeScope: ['**'] }), /unbounded/],
    ['code task without tests', task({ id: 'a', testFiles: [] }), /at least one test file/],
    ['glob test file', task({ id: 'a', testFiles: ['tests/**/*.test.ts'] }), /exact path/],
    ['test file outside test dirs', task({ id: 'a', testFiles: ['src/core/x.test.ts'] }), /not a test path/],
    ['research with tests', task({ id: 'a', squad: 'research', kind: 'research', writeScope: ['docs/specs/x.md'] }), /must not have test files/],
    ['oversized', task({ id: 'a', maxChangedLines: 5000 }), /exceeds the policy cap/],
    ['unknown dependency', task({ id: 'a', dependsOn: ['ghost'] }), /unknown task "ghost"/],
    ['absolute path', task({ id: 'a', writeScope: ['C:/game/src/sim/x.ts'] }), /repo-relative/],
  ])('flags %s', (_name, t, re) => {
    expect(validatePlan(plan(t), org).join('\n')).toMatch(re);
  });

  it('flags duplicates and cycles', () => {
    const problems = validatePlan(plan(task({ id: 'a', dependsOn: ['b'] }), task({ id: 'b', dependsOn: ['a'] }), task({ id: 'c' }), task({ id: 'c' })), org).join('\n');
    expect(problems).toMatch(/duplicate task id/);
    expect(problems).toMatch(/dependency cycle/);
  });
});

describe('dag', () => {
  const st = (contract: TaskContract, status: TaskStatus = 'pending') => ({ contract, status });

  it('orders by dependency and reports cycles', () => {
    const r = topoOrder([task({ id: 'b', dependsOn: ['a'] }), task({ id: 'a' })]);
    expect(r).toEqual({ order: ['a', 'b'] });
    expect('cycle' in topoOrder([task({ id: 'a', dependsOn: ['b'] }), task({ id: 'b', dependsOn: ['a'] })])).toBe(true);
  });

  it('runs independent squads in parallel but never overlapping scopes or the same squad twice', () => {
    const tasks = [
      st(task({ id: 'g1', writeScope: ['src/sim/waves/**'], testFiles: ['src/sim/waves/a.test.ts'] })),
      st(task({ id: 'g2', writeScope: ['src/sim/player/**'], testFiles: ['src/sim/player/a.test.ts'] })),
      st(task({ id: 'e1', squad: 'engine', writeScope: ['src/core/loop/**'], testFiles: ['src/core/loop/a.test.ts'] })),
      st(task({ id: 'e2', squad: 'engine', writeScope: ['src/core/loop/x.ts'], testFiles: ['src/core/loop/b.test.ts'] })),
    ];
    expect(schedule(tasks, 3).ready.map((t) => t.id)).toEqual(['g1', 'e1']);
  });

  it('waits for dependencies and skips tasks whose dependency failed', () => {
    const a = task({ id: 'a' });
    const b = task({ id: 'b', squad: 'engine', writeScope: ['src/core/**'], testFiles: ['src/core/b.test.ts'], dependsOn: ['a'] });
    expect(schedule([st(a, 'in_progress'), st(b)], 3).ready).toEqual([]);
    expect(schedule([st(a, 'merged'), st(b)], 3).ready.map((t) => t.id)).toEqual(['b']);
    expect(schedule([st(a, 'escalated'), st(b)], 3).blocked.map((t) => t.id)).toEqual(['b']);
  });

  it('respects maxParallel', () => {
    const tasks = ['gameplay', 'engine', 'render'].map((squad, i) =>
      st(task({ id: `t${i}`, squad, writeScope: [`src/${squad}/a${i}/**`], testFiles: [`src/${squad}/a${i}.test.ts`] })),
    );
    expect(schedule(tasks, 2).ready).toHaveLength(2);
  });
});
