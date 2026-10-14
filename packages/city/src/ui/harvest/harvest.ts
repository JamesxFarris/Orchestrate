import type { ProgressSnapshot, Settlement, TaskOutcome } from '@orchestrate/shared';

/** What the Harvest screen shows for one shipped run. Pure, so it is tested without a browser. */

export interface LevelUp {
  squad: string;
  from: Settlement;
  to: Settlement;
}

/** Districts whose settlement grew between two snapshots (before and after a ship). */
export function levelUps(before: ProgressSnapshot, after: ProgressSnapshot): LevelUp[] {
  const was = new Map(before.districts.map((d) => [d.squad, d.settlement]));
  const out: LevelUp[] = [];
  for (const d of after.districts) {
    const from = was.get(d.squad);
    if (from && d.settlement.level > from.level) out.push({ squad: d.squad, from, to: d.settlement });
  }
  return out;
}

export interface HarvestTally {
  /** Merged tasks only: they are the ones that earned growth. */
  tasks: TaskOutcome[];
  total: number;
  /** Each district that worked on this run, with its run of clean ships now. */
  streaks: { squad: string; streak: number }[];
}

export function harvestOf(progress: ProgressSnapshot, runId: string): HarvestTally | undefined {
  const run = progress.runs.find((r) => r.runId === runId);
  if (!run) return undefined;
  const tasks = run.outcomes.filter((o) => o.merged);
  const squads = [...new Set(run.outcomes.map((o) => o.squad))];
  return {
    tasks,
    total: tasks.reduce((sum, t) => sum + t.growth, 0),
    streaks: squads.map((squad) => ({ squad, streak: progress.districts.find((d) => d.squad === squad)?.streak ?? 0 })),
  };
}
