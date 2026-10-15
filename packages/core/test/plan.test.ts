import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { roleName, type Plan, type TaskContract, type TaskStatus } from '@orchestrate/shared';
import { circleReviewSystem } from '../src/prompts.ts';
import { Org, TeamConfigError } from '../src/org/org.ts';
import { schedule, topoOrder } from '../src/plan/dag.ts';
import { validatePlan } from '../src/plan/validatePlan.ts';
import { isShellSafePath, testFilesCommand } from '../src/gates/gates.ts';

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

describe('presets', () => {
  const dir = path.resolve(import.meta.dirname, '../../../presets');
  const files = readdirSync(dir).filter((f) => f.endsWith('.team.yaml'));

  it('finds the shipped presets', () => {
    expect(files).toEqual(expect.arrayContaining(['corpsegrinder.team.yaml', 'default.team.yaml']));
  });

  // A preset that fails the real loader would crash the daemon on start, so none may ship broken.
  it.each(files)('%s loads through the org loader with no problems', (file) => {
    let problems: string[] = [];
    let loaded: Org | undefined;
    try {
      loaded = Org.load(path.join(dir, file));
    } catch (e) {
      problems = e instanceof TeamConfigError ? e.problems : [String(e)];
    }
    expect(problems).toEqual([]);
    for (const s of loaded!.squads) expect(loaded!.squadRole(s.id, 'lead'), `squad "${s.id}" lead`).toBeDefined();
    expect(loaded!.circle().map((r) => r.id)).toEqual(loaded!.config.techCircle);
  });

  it('default preset: ownership globs fit a typical full-stack plan', () => {
    const def = Org.load(path.join(dir, 'default.team.yaml'));
    const good = plan(
      task({ id: 'design', squad: 'research', kind: 'research', writeScope: ['docs/design/auth.md', 'docs/adr/0001-auth.md'], testFiles: [] }),
      task({ id: 'types', squad: 'platform', writeScope: ['src/shared/auth.ts'], testFiles: ['tests/platform/auth.test.ts'], dependsOn: ['design'] }),
      task({ id: 'ci', squad: 'platform', writeScope: ['.github/workflows/ci.yml', 'vite.config.ts'], testFiles: ['tests/platform/ci.test.ts'] }),
      task({ id: 'api', squad: 'backend', writeScope: ['src/server/auth/**'], testFiles: ['tests/server/auth.test.ts'], dependsOn: ['types'] }),
      task({ id: 'ui', squad: 'frontend', writeScope: ['src/client/login/**'], testFiles: ['tests/client/login.test.tsx'], dependsOn: ['types'] }),
    );
    expect(validatePlan(good, def)).toEqual([]);
    const crossed = task({ id: 'x', squad: 'frontend', writeScope: ['src/server/**'], testFiles: ['tests/server/x.test.ts'] });
    const problems = validatePlan(plan(crossed), def).join('\n');
    expect(problems).toMatch(/outside squad "frontend" ownership/);
    expect(problems).toMatch(/not a test path for squad "frontend"/);
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

describe('testFilesCommand', () => {
  const gates = { test: 'npm test', testFiles: 'npx vitest run {files}', timeoutMs: 1000 };
  it('fills in plain paths', () => {
    expect(testFilesCommand(gates, ['tests/a.test.ts', 'tests/b.test.ts'])).toBe('npx vitest run tests/a.test.ts tests/b.test.ts');
  });
  it('refuses unsafe paths even if plan validation was bypassed', () => {
    expect(() => testFilesCommand(gates, ['tests/a.test.ts & calc'])).toThrow(/unsafe test file path/);
    expect(() => testFilesCommand(gates, ['--config=evil.js'])).toThrow(/unsafe/);
  });
  it("refuses $& and $' in paths, which String.replace would expand", () => {
    for (const f of ['tests/$&.test.ts', "tests/$'.test.ts"]) expect(isShellSafePath(f)).toBe(false);
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

describe('role titles', () => {
  const role = (id: string) => org.roles.find((r) => r.id === id)!;

  it('uses industry titles, with the squad carried alongside since titles repeat', () => {
    expect(roleName(role('gameplay-lead'), org.squads)).toBe('Tech Lead · Gameplay');
    expect(roleName(role('render-lead'), org.squads)).toBe('Tech Lead · Render & UI');
    expect(roleName(role('head-of-eng'), org.squads)).toBe('VP of Engineering');
  });

  it('tells each agent which squad it belongs to', () => {
    expect(circleReviewSystem(org, role('gameplay-lead'))).toContain('You are Tech Lead in the Gameplay squad (gameplay-lead)');
    expect(circleReviewSystem(org, role('architect'))).toContain('You are Principal Architect (architect)');
  });
});
