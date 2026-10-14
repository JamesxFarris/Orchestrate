import type { DistrictProgress, ProgressSnapshot, Settlement } from '@orchestrate/shared';
import { describe, expect, it } from 'vitest';
import { harvestOf, levelUps } from '../src/ui/harvest/harvest.ts';

const settlement = (level: number, name: string, into = 0): Settlement => ({ level, name, into, needed: 100 + 100 * level });
const district = (squad: string, level: number, name: string, streak = 0): DistrictProgress => ({
  squad,
  growth: 0,
  pending: 0,
  settlement: settlement(level, name),
  settlementAfterPending: settlement(level, name),
  streak,
  ships: 0,
});
const snapshot = (districts: DistrictProgress[], runs: ProgressSnapshot['runs'] = []): ProgressSnapshot => ({ districts, runs });

describe('levelUps', () => {
  it('lists districts whose settlement grew, from and to', () => {
    const before = snapshot([district('render', 1, 'Hamlet'), district('engine', 2, 'Village')]);
    const after = snapshot([district('render', 2, 'Village'), district('engine', 2, 'Village')]);
    expect(levelUps(before, after)).toEqual([{ squad: 'render', from: settlement(1, 'Hamlet'), to: settlement(2, 'Village') }]);
  });

  it('ignores districts that did not exist before', () => {
    expect(levelUps(snapshot([]), snapshot([district('new', 3, 'Town')]))).toEqual([]);
  });
});

describe('harvestOf', () => {
  it("totals the run's merged tasks and lists their streaks", () => {
    const progress = snapshot(
      [district('render', 2, 'Village', 3), district('engine', 1, 'Hamlet', 0), district('gameplay', 1, 'Hamlet', 5)],
      [
        {
          runId: 'r1',
          shippedAt: 10,
          outcomes: [
            { taskId: 'a', squad: 'render', merged: true, firstTry: true, noFuss: true, thrifty: true, costUsd: 1, growth: 200 },
            { taskId: 'b', squad: 'engine', merged: true, firstTry: false, noFuss: true, thrifty: true, costUsd: 1, growth: 150 },
            { taskId: 'c', squad: 'engine', merged: false, firstTry: true, noFuss: false, thrifty: true, costUsd: 1, growth: 0 },
          ],
        },
      ],
    );
    const h = harvestOf(progress, 'r1')!;
    expect(h.total).toBe(350);
    expect(h.tasks.map((t) => t.taskId)).toEqual(['a', 'b']);
    expect(h.streaks).toEqual([
      { squad: 'render', streak: 3 },
      { squad: 'engine', streak: 0 },
    ]);
  });

  it('returns undefined for an unknown run', () => {
    expect(harvestOf(snapshot([]), 'nope')).toBeUndefined();
  });
});
