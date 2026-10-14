import type { DistrictProgress, OrchestrateEvent, ProgressSnapshot, RunState, Settlement, TaskOutcome, TaskState } from '@orchestrate/shared';

/**
 * Progression rules. Pure functions over stored facts (runs, their events, when each run shipped):
 * nothing here is persisted, so changing a number below re-scores all history consistently.
 */

export const GROWTH = { base: 100, firstTry: 50, noFuss: 25, thrifty: 25 } as const;

const SETTLEMENTS = ['Hamlet', 'Village', 'Town', 'Borough', 'City'] as const;

/** The facts about one run that progression reads. */
export interface RunFacts {
  run: RunState;
  /** This run's event history. */
  events: readonly OrchestrateEvent[];
  /** When the run stopped executing (completed, failed or cancelled). */
  finishedAt?: number;
  /** When its branch landed in the default branch. */
  shippedAt?: number;
}

/** The implementer's per-invocation budget for a squad: the bar a whole task must stay under to be thrifty. */
export type BudgetFor = (squad: string, kind: 'code' | 'research') => number;

export function taskOutcome(task: TaskState, runEvents: readonly OrchestrateEvent[], budgetUsd: number): TaskOutcome {
  const id = task.contract.id;
  let costUsd = 0;
  let escalations = 0;
  for (const e of runEvents) {
    if (e.type === 'agent.cost' && e.taskId === id) costUsd += e.usd;
    else if (e.type === 'escalation' && e.taskId === id) escalations++;
  }
  const merged = task.status === 'merged';
  const firstTry = task.attempts <= 1;
  const noFuss = escalations === 0;
  const thrifty = costUsd <= budgetUsd;
  const growth = merged ? GROWTH.base + (firstTry ? GROWTH.firstTry : 0) + (noFuss ? GROWTH.noFuss : 0) + (thrifty ? GROWTH.thrifty : 0) : 0;
  return { taskId: id, squad: task.contract.squad, merged, firstTry, noFuss, thrifty, costUsd: round(costUsd), growth };
}

/** Growth a level needs before the next: 200, 300, 400, 500, then 600 per City level. */
function neededAt(level: number): number {
  return Math.min(100 + 100 * level, 600);
}

export function settlementFor(growth: number): Settlement {
  let level = 1;
  let into = Math.max(0, growth);
  while (into >= neededAt(level)) {
    into -= neededAt(level);
    level++;
  }
  const name = level <= SETTLEMENTS.length ? SETTLEMENTS[level - 1]! : `City ${roman(level - SETTLEMENTS.length + 1)}`;
  return { level, name, into, needed: neededAt(level) };
}

export function computeProgress(facts: readonly RunFacts[], squads: readonly string[], budgetFor: BudgetFor): ProgressSnapshot {
  const district = new Map(squads.map((s) => [s, { growth: 0, pending: 0, ships: 0, timeline: [] as { at: number; clean: boolean }[] }]));
  const runs: ProgressSnapshot['runs'] = [];

  for (const f of facts) {
    const outcomes = f.run.tasks.map((t) => taskOutcome(t, f.events, budgetFor(t.contract.squad, t.contract.kind)));
    runs.push({ runId: f.run.id, shippedAt: f.shippedAt, outcomes });
    if (f.run.status === 'cancelled') continue; // your call, not the squad's: neither scored nor held against it

    for (const [squad, d] of district) {
      const mine = outcomes.filter((o) => o.squad === squad);
      if (!mine.length) continue;
      const earned = mine.reduce((sum, o) => sum + o.growth, 0);
      if (f.shippedAt !== undefined) {
        d.growth += earned;
        if (mine.some((o) => o.merged)) d.ships++;
        // Skipped = a dependency (maybe another squad's) never merged: not this squad's doing, so neutral.
        const judged = mine.filter((o) => f.run.tasks.find((t) => t.contract.id === o.taskId)?.status !== 'skipped');
        if (judged.length) d.timeline.push({ at: f.shippedAt, clean: judged.every((o) => o.merged && o.firstTry && o.noFuss) });
      } else {
        d.pending += earned;
        // Clean work only counts once it ships, but failure breaks the streak the moment the run ends.
        const statuses = f.run.tasks.filter((t) => t.contract.squad === squad).map((t) => t.status);
        if (f.finishedAt !== undefined && statuses.some((s) => s === 'escalated' || s === 'failed')) d.timeline.push({ at: f.finishedAt, clean: false });
      }
    }
  }

  const districts: DistrictProgress[] = [...district].map(([squad, d]) => {
    const timeline = d.timeline.sort((a, b) => a.at - b.at);
    let streak = 0;
    for (let i = timeline.length - 1; i >= 0 && timeline[i]!.clean; i--) streak++;
    return {
      squad,
      growth: d.growth,
      pending: d.pending,
      settlement: settlementFor(d.growth),
      settlementAfterPending: settlementFor(d.growth + d.pending),
      streak,
      ships: d.ships,
    };
  });

  return { districts, runs };
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/** When a run stopped executing, from its event history. */
export function finishedAt(events: readonly OrchestrateEvent[]): number | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'run.status' && TERMINAL.has(e.status)) return e.ts;
  }
  return undefined;
}

const round = (usd: number) => Math.round(usd * 1000) / 1000;

function roman(n: number): string {
  const digits: [number, string][] = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let out = '';
  for (const [value, symbol] of digits) {
    while (n >= value) {
      out += symbol;
      n -= value;
    }
  }
  return out;
}
