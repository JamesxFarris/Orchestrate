import type { EventInput, OrchestrateEvent, Plan, RunState } from '@orchestrate/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCity } from '../src/store.ts';

const ev = (e: EventInput): OrchestrateEvent => ({ ...e, ts: 1 }) as OrchestrateEvent;
const plan: Plan = {
  summary: 's',
  risks: [],
  tasks: [{ id: 't1', title: 'Task 1', squad: 'render', kind: 'code', objective: '', acceptanceCriteria: ['works'], nonGoals: [], writeScope: ['src/**'], readScope: [], testFiles: [], dependsOn: [], testPlan: '' }],
};
const state = () => useCity.getState();
const initial = useCity.getState();
beforeEach(() => useCity.setState(initial, true));

describe('store.ingest: the city follows the daemon’s events', () => {
  it('follows a run from creation through its plan to a task status', () => {
    state().ingest(ev({ type: 'run.created', runId: 'r1', prompt: 'build it' }));
    expect(state().currentRunId).toBe('r1');
    state().ingest(ev({ type: 'plan.proposed', runId: 'r1', plan, round: 0, problems: [] }));
    state().ingest(ev({ type: 'task.status', runId: 'r1', taskId: 't1', status: 'in_progress' }));
    expect(state().runs.r1!.tasks.map((t) => t.status)).toEqual(['in_progress']);
  });

  it('ignores a plan that failed validation: the master will revise it', () => {
    state().ingest(ev({ type: 'run.created', runId: 'r1', prompt: 'build it' }));
    state().ingest(ev({ type: 'plan.proposed', runId: 'r1', plan, round: 0, problems: ['bad scope'] }));
    expect(state().runs.r1!.tasks).toEqual([]);
  });

  it('skips a task update for a run it has not loaded, rather than storing undefined', () => {
    state().ingest(ev({ type: 'task.status', runId: 'ghost', taskId: 't1', status: 'merged' }));
    expect('ghost' in state().runs).toBe(false);
  });

  it('opens and closes the Tech Circle, and a snapshot taken after it adjourned clears it', () => {
    state().ingest(ev({ type: 'circle.convened', runId: 'r1', members: ['vp'] }));
    expect(state().circleActive).toBe(true);
    const run: RunState = { id: 'r1', prompt: 'p', status: 'executing', createdAt: 0, tasks: [], costUsd: 0 };
    state().hydrate([], [run]);
    expect(state().circleActive).toBe(false);
    state().hydrate([], [{ ...run, status: 'reviewing' }]);
    expect(state().circleActive).toBe(true);
  });

  it('draws a trail for each handoff', () => {
    state().ingest(ev({ type: 'handoff', runId: 'r1', taskId: 't1', from: 'render-qa', to: 'render-dev', reason: 'tests ready' }));
    expect(state().trails.map((t) => [t.from, t.to])).toEqual([['render-qa', 'render-dev']]);
  });
});
