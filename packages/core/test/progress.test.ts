import type { OrchestrateEvent, RunState, TaskContract, TaskState } from '@orchestrate/shared';
import { describe, expect, it } from 'vitest';
import { computeProgress, settlementFor, taskOutcome, type RunFacts } from '../src/progress/progress.ts';

const contract = (id: string, squad: string): TaskContract => ({
  id,
  title: `Task ${id}`,
  squad,
  kind: 'code',
  objective: '',
  acceptanceCriteria: ['works'],
  nonGoals: [],
  writeScope: [`src/${squad}/**`],
  readScope: [],
  testFiles: [],
  dependsOn: [],
  testPlan: '',
});

const task = (id: string, squad: string, status: TaskState['status'] = 'merged', attempts = 1): TaskState => ({ contract: contract(id, squad), status, attempts });

const run = (id: string, tasks: TaskState[], status: RunState['status'] = 'completed'): RunState => ({ id, prompt: 'p', status, createdAt: 0, tasks, costUsd: 0 });

const cost = (runId: string, taskId: string, usd: number): OrchestrateEvent => ({ type: 'agent.cost', ts: 1, runId, agentId: 'a', taskId, usd });
const escalation = (runId: string, taskId: string): OrchestrateEvent => ({ type: 'escalation', ts: 1, runId, taskId, from: 'dev', to: 'lead', reason: 'needs more scope' });

const BUDGET = 4;
const budgetFor = () => BUDGET;

describe('taskOutcome: growth per task', () => {
  it('scores a clean merged task 100 base + 50 first try + 25 no fuss + 25 thrifty', () => {
    expect(taskOutcome(task('a', 'render'), [cost('r', 'a', 1.5)], BUDGET)).toEqual({
      taskId: 'a',
      squad: 'render',
      merged: true,
      firstTry: true,
      noFuss: true,
      thrifty: true,
      costUsd: 1.5,
      growth: 200,
    });
  });

  it('drops each bonus independently', () => {
    expect(taskOutcome(task('a', 'render', 'merged', 2), [], BUDGET)).toMatchObject({ firstTry: false, growth: 150 });
    expect(taskOutcome(task('a', 'render'), [escalation('r', 'a')], BUDGET)).toMatchObject({ noFuss: false, growth: 175 });
    expect(taskOutcome(task('a', 'render'), [cost('r', 'a', 3), cost('r', 'a', 1.5)], BUDGET)).toMatchObject({ thrifty: false, costUsd: 4.5, growth: 175 });
  });

  it('counts only this task\'s costs and escalations', () => {
    const events = [cost('r', 'other', 10), escalation('r', 'other'), cost('r', 'a', 1)];
    expect(taskOutcome(task('a', 'render'), events, BUDGET)).toMatchObject({ costUsd: 1, noFuss: true, thrifty: true, growth: 200 });
  });

  it('earns nothing unless merged', () => {
    for (const status of ['escalated', 'failed', 'skipped', 'pending', 'in_progress'] as const) {
      expect(taskOutcome(task('a', 'render', status), [], BUDGET).growth).toBe(0);
    }
  });
});

describe('settlementFor: district size from banked growth', () => {
  it.each([
    [0, 1, 'Hamlet', 0, 200],
    [199, 1, 'Hamlet', 199, 200],
    [200, 2, 'Village', 0, 300],
    [500, 3, 'Town', 0, 400],
    [899, 3, 'Town', 399, 400],
    [900, 4, 'Borough', 0, 500],
    [1400, 5, 'City', 0, 600],
    [2000, 6, 'City II', 0, 600],
    [2700, 7, 'City III', 100, 600],
  ])('%i growth → level %i %s (%i of %i)', (growth, level, name, into, needed) => {
    expect(settlementFor(growth)).toEqual({ level, name, into, needed });
  });
});

describe('computeProgress: banking, pending and streaks', () => {
  const squads = ['render', 'engine'];

  it('banks growth only from shipped runs; unshipped merged work is pending', () => {
    const facts: RunFacts[] = [
      { run: run('r1', [task('a', 'render'), task('b', 'engine')]), events: [], finishedAt: 10, shippedAt: 20 },
      { run: run('r2', [task('c', 'render')]), events: [], finishedAt: 30 },
      { run: run('r3', [task('d', 'render')], 'executing'), events: [] },
    ];
    const render = computeProgress(facts, squads, budgetFor).districts.find((d) => d.squad === 'render')!;
    expect(render).toMatchObject({ growth: 200, pending: 400, ships: 1 });
    expect(render.settlement).toMatchObject({ level: 2, name: 'Village' });
    expect(render.settlementAfterPending).toMatchObject({ level: 3, name: 'Town', into: 100 });
  });

  it('ignores cancelled runs entirely', () => {
    const facts: RunFacts[] = [{ run: run('r1', [task('a', 'render')], 'cancelled'), events: [], finishedAt: 10 }];
    expect(computeProgress(facts, squads, budgetFor).districts.find((d) => d.squad === 'render')).toMatchObject({ growth: 0, pending: 0, streak: 0 });
  });

  it('lists every squad, even ones with no work yet', () => {
    expect(computeProgress([], squads, budgetFor).districts.map((d) => [d.squad, d.settlement.name])).toEqual([
      ['render', 'Hamlet'],
      ['engine', 'Hamlet'],
    ]);
  });

  it('counts clean ships in a row and resets on a rough one, in time order', () => {
    const facts: RunFacts[] = [
      // listed out of order on purpose: streaks follow ship time, not array order
      { run: run('r3', [task('c', 'render')]), events: [], finishedAt: 50, shippedAt: 60 },
      { run: run('r1', [task('a', 'render')]), events: [], finishedAt: 10, shippedAt: 20 },
      { run: run('r2', [task('b', 'render', 'merged', 2)]), events: [], finishedAt: 30, shippedAt: 40 },
    ];
    expect(computeProgress(facts, squads, budgetFor).districts.find((d) => d.squad === 'render')!.streak).toBe(1);
  });

  it('breaks a streak when a run fails, even though it never ships', () => {
    const facts: RunFacts[] = [
      { run: run('r1', [task('a', 'render')]), events: [], finishedAt: 10, shippedAt: 20 },
      { run: run('r2', [task('b', 'render', 'escalated')], 'failed'), events: [], finishedAt: 30 },
    ];
    expect(computeProgress(facts, squads, budgetFor).districts.find((d) => d.squad === 'render')!.streak).toBe(0);
  });

  it('only judges a squad on its own tasks', () => {
    const facts: RunFacts[] = [
      { run: run('r1', [task('a', 'render'), task('b', 'engine', 'escalated')]), events: [], finishedAt: 10, shippedAt: 20 },
    ];
    const { districts } = computeProgress(facts, squads, budgetFor);
    expect(districts.map((d) => [d.squad, d.streak, d.ships])).toEqual([
      ['render', 1, 1],
      ['engine', 0, 0],
    ]);
  });

  it("treats a skipped task (its dependency never merged) as neutral for the streak", () => {
    const facts: RunFacts[] = [
      { run: run('r1', [task('a', 'render')]), events: [], finishedAt: 10, shippedAt: 20 },
      { run: run('r2', [task('b', 'engine', 'escalated'), task('c', 'render', 'skipped'), task('d', 'render')]), events: [], finishedAt: 30, shippedAt: 40 },
      { run: run('r3', [task('e', 'engine', 'escalated'), task('f', 'render', 'skipped')]), events: [], finishedAt: 50, shippedAt: 60 },
    ];
    expect(computeProgress(facts, squads, budgetFor).districts.find((d) => d.squad === 'render')!.streak).toBe(2);
  });

  it('a clean run that has not shipped yet neither extends nor breaks the streak', () => {
    const facts: RunFacts[] = [
      { run: run('r1', [task('a', 'render')]), events: [], finishedAt: 10, shippedAt: 20 },
      { run: run('r2', [task('b', 'render')]), events: [], finishedAt: 30 },
    ];
    expect(computeProgress(facts, squads, budgetFor).districts.find((d) => d.squad === 'render')!.streak).toBe(1);
  });

  it('reports each run\'s task outcomes and ship time', () => {
    const facts: RunFacts[] = [{ run: run('r1', [task('a', 'render')]), events: [escalation('r1', 'a')], finishedAt: 10, shippedAt: 20 }];
    expect(computeProgress(facts, squads, budgetFor).runs).toEqual([
      { runId: 'r1', shippedAt: 20, outcomes: [expect.objectContaining({ taskId: 'a', noFuss: false, growth: 175 })] },
    ]);
  });

  it('uses each squad\'s own budget for thrifty', () => {
    const facts: RunFacts[] = [{ run: run('r1', [task('a', 'render'), task('b', 'engine')]), events: [cost('r1', 'a', 3), cost('r1', 'b', 3)], finishedAt: 10, shippedAt: 20 }];
    const progress = computeProgress(facts, squads, (squad) => (squad === 'render' ? 2 : 5));
    expect(progress.runs[0]!.outcomes.map((o) => [o.taskId, o.thrifty])).toEqual([
      ['a', false],
      ['b', true],
    ]);
  });
});
