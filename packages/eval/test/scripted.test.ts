import { describe, expect, it } from 'vitest';
import { loadScenarios, runScenario, scorecard, scriptedTeam, totals } from '../src/index.ts';

/**
 * The scripted team plays every role perfectly, so every scenario must score perfectly. If one
 * does not, either the scenario is broken (its judge, plan or solution disagree) or the harness
 * rejects correct work, which is how this bench first caught the red-phase SyntaxError rule.
 */
describe('eval bench, scripted team (free)', () => {
  const scenarios = loadScenarios();

  it('has scenarios to run', () => {
    expect(scenarios.map((s) => s.id)).toEqual(expect.arrayContaining(['median-bug', 'slugify', 'tax-endpoint']));
  });

  it.each(scenarios.map((s) => [s.id, s] as const))('%s scores perfectly', async (_id, scenario) => {
    const r = await runScenario(scenario, { runner: scriptedTeam(scenario), model: 'scripted' });
    expect(r).toMatchObject({ completed: true, correct: true, retries: 0, denials: 0, neededHuman: false });
    expect(r.judge.passed).toBe(r.judge.total);
    expect(r.judge.total).toBeGreaterThan(0);
    expect(r.tasks.firstTry).toBe(r.tasks.total);
    expect(r.gateFailures).toEqual({});
  });

  it('scores a run that produced nothing as wrong, not as an error', async () => {
    const scenario = scenarios.find((s) => s.id === 'slugify')!;
    // a team whose VP cannot plan: the run fails, the judge finds nothing to pass
    const { FakeRunner } = await import('@orchestrate/core');
    const r = await runScenario(scenario, { runner: new FakeRunner(() => ({ text: 'no plan' })), model: 'scripted' });
    expect(r).toMatchObject({ completed: false, correct: false });
    expect(r.judge.passed).toBe(0);
    const card = scorecard({ at: new Date().toISOString(), commit: 'test', mode: 'scripted', model: 'scripted', repeat: 1, results: [r] });
    expect(card).toContain('| slugify | NO (0/6)');
    expect(totals([r]).correctRate).toBe(0);
  });
});
