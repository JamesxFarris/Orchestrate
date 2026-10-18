import { describe, expect, it } from 'vitest';
import { comparison, htmlReport, loadScenarios, runScenario, runSolo, scorecard, scriptedSolo, scriptedTeam, soloModel, summarize, totals, verdict, type ScenarioResult } from '../src/index.ts';

/**
 * These tests drive real git in temp folders while other test files do the same in parallel. On
 * Windows a new file in .git/objects can be briefly locked (antivirus, the indexer), and git then
 * fails with "Permission denied". That's the machine, not the bench, so these suites retry once.
 */
const REAL_GIT = { retry: 1 };

/**
 * The scripted team plays every role perfectly, so every scenario must score perfectly. If one
 * does not, either the scenario is broken (its judge, plan or solution disagree) or the harness
 * rejects correct work, which is how this bench first caught the red-phase SyntaxError rule.
 */
describe('eval bench, scripted team (free)', REAL_GIT, () => {
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

/**
 * The baseline: one plain Claude Code session on the same request. A scripted session that writes
 * the reference solution must score perfectly, and one that does nothing must score as wrong, so
 * the solo path and its judging are checked before a real session is paid for.
 */
describe('eval bench, Claude alone baseline (free)', REAL_GIT, () => {
  const scenarios = loadScenarios();

  it.each(scenarios.map((s) => [s.id, s] as const))('%s: a solo session with the right answer scores perfectly', async (_id, scenario) => {
    const r = await runSolo(scenario, { runner: scriptedSolo(), model: 'scripted' });
    expect(r).toMatchObject({ arm: 'solo', completed: true, correct: true });
    expect(r.judge.passed).toBe(r.judge.total);
  });

  it('scores a solo session that changed nothing as wrong', async () => {
    const scenario = scenarios.find((s) => s.id === 'slugify')!;
    const r = await runSolo(scenario, { runner: async () => ({ ok: false, costUsd: 0.4, turns: 3, detail: 'error_max_turns' }), model: 'scripted' });
    expect(r).toMatchObject({ arm: 'solo', completed: false, correct: false, status: 'failed', costUsd: 0.4, detail: 'error_max_turns' });
    expect(r.judge.passed).toBeLessThan(r.judge.total);
  });

  it('asks the solo session for the request plus the project description, nothing more', async () => {
    const scenario = scenarios.find((s) => s.id === 'slugify')!;
    let prompt = '';
    await runSolo(scenario, { runner: async (s) => ((prompt = s.prompt), { ok: true, costUsd: 0, turns: 1 }), model: 'scripted' });
    expect(prompt.startsWith(scenario.request)).toBe(true);
    expect(prompt).toContain('node --test');
  });
});

describe('comparing Orchestrate with Claude alone', () => {
  const run = (arm: 'orchestrate' | 'solo', scenario: string, passed: number, costUsd: number): ScenarioResult => ({
    scenario, arm, completed: true, status: 'completed', judge: { passed, total: 10 }, correct: passed === 10,
    tasks: { total: 1, merged: 1, firstTry: 1, escalated: 0, failed: 0 }, retries: 0, gateFailures: {}, denials: 0, neededHuman: false, costUsd, seconds: 10,
  });

  it('says which side passed more judge tests, at what cost, and when the sample is too small to trust', () => {
    const team = [run('orchestrate', 'a', 10, 3)];
    const solo = [run('solo', 'a', 7, 1)];
    expect(verdict(summarize(team), summarize(solo), 1)).toBe('Orchestrate passed 30 points more of the judge tests than Claude alone at 3.0x the cost. Fewer than 3 runs per scenario on each side, so treat a small gap as chance; rerun with --repeat 3.');
    const many = (arm: 'orchestrate' | 'solo', p: number) => [run(arm, 'a', p, 1), run(arm, 'a', p, 1), run(arm, 'a', p, 1)];
    expect(verdict(summarize(many('orchestrate', 8)), summarize(many('solo', 9)), 1)).toBe('Orchestrate passed 10 points fewer of the judge tests than Claude alone at 1.0x the cost.');
  });

  it('puts the comparison in the scorecard only when there are solo runs, and keeps old reports readable', () => {
    const at = new Date().toISOString();
    const old = { ...run('orchestrate', 'a', 10, 1) };
    delete old.arm; // reports saved before the baseline existed have no arm
    const plain = scorecard({ at, commit: 'x', mode: 'scripted', model: 'scripted', repeat: 1, results: [old] });
    expect(plain).not.toContain('Claude alone');
    expect(plain).toContain('| a | yes (10/10)');
    const both = scorecard({ at, commit: 'x', mode: 'scripted', model: 'scripted', repeat: 1, results: [old, run('solo', 'a', 6, 0.5)] });
    expect(both).toContain('## Orchestrate vs Claude alone');
    expect(both).toContain('| a | 1/1 (10/10) | 0/1 (6/10) | $1.00 | $0.50 | 10s | 10s |');
    expect(comparison([old], [run('solo', 'a', 6, 0.5)])).toContain('Orchestrate passed 40 points more');
    // the solo run stays out of the Orchestrate table and its totals
    expect(both).toContain('**Totals over 1 runs:**');
  });
});

describe('the comparison page', () => {
  const result = (arm: 'orchestrate' | 'solo', scenario: string, passed: number): ScenarioResult => ({
    scenario, arm, completed: true, status: 'completed', judge: { passed, total: 6 }, correct: passed === 6,
    tasks: { total: 1, merged: 1, firstTry: 1, escalated: 0, failed: 0 }, retries: 0, gateFailures: {}, denials: 0, neededHuman: false, costUsd: 1, seconds: 30,
  });

  it('shows both sides per scenario with the verdict, and escapes what it prints', () => {
    const page = htmlReport({ at: '2026-10-18T21:00:00Z', commit: 'abc', mode: 'live', model: 'm<1>', repeat: 1, results: [result('orchestrate', 'slug<ify>', 6), result('solo', 'slug<ify>', 4)] });
    expect(page).toContain('Orchestrate passed 33 points more of the judge tests than Claude alone at 1.0x the cost.');
    expect(page).toContain('slug&lt;ify&gt;');
    expect(page).not.toContain('slug<ify>');
    expect(page).toContain('Live, m&lt;1&gt;');
    expect(page.match(/<figure class="chart">/g)).toHaveLength(3);
    expect(page).toContain('<td>6/6</td><td>4/6</td>');
  });
});

describe('a like-for-like baseline', () => {
  it('gives Claude alone the model the team writes code with', () => {
    expect(soloModel('claude-opus-5-5')).toBe('claude-opus-5-5');
    expect(soloModel('claude-opus-5-5', true)).toBe('claude-sonnet-5-5');
  });
});
