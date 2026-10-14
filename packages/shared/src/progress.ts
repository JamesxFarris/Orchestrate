/**
 * Progression: districts grow from shipped work. Only facts are stored (runs, their events, and when
 * each run shipped); everything here is derived from them, so changing a rule re-scores history.
 */

/** How one task scored. Bonuses only count when the task merged. */
export interface TaskOutcome {
  taskId: string;
  squad: string;
  merged: boolean;
  /** The implementer passed review on its first attempt. */
  firstTry: boolean;
  /** No escalations: no scope requests, blockers or rulings. */
  noFuss: boolean;
  /** Total cost (QA, dev and review, all attempts) stayed within one implementer budget. */
  thrifty: boolean;
  costUsd: number;
  growth: number;
}

/** A district's size. Levels 1–5 are Hamlet → City; beyond that, City II, City III… */
export interface Settlement {
  level: number;
  name: string;
  /** Growth earned since reaching this level. */
  into: number;
  /** Growth this level needs before the next one. */
  needed: number;
}

export interface DistrictProgress {
  squad: string;
  /** Banked: from shipped runs only. */
  growth: number;
  /** Earned by merged tasks in runs that have not shipped yet (drawn striped). */
  pending: number;
  settlement: Settlement;
  /** Where the district lands once everything pending ships. */
  settlementAfterPending: Settlement;
  /** Clean ships in a row: every task merged first try, no fuss. */
  streak: number;
  ships: number;
}

export interface RunProgress {
  runId: string;
  shippedAt?: number;
  outcomes: TaskOutcome[];
}

export interface ProgressSnapshot {
  districts: DistrictProgress[];
  runs: RunProgress[];
}
