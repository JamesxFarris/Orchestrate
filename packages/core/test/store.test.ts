import { describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';

describe('Store.events', () => {
  it('returns a run’s events in order, optionally only some kinds', () => {
    const store = new Store(':memory:');
    store.appendEvent({ type: 'agent.log', runId: 'r1', ts: 1, agentId: 'a', kind: 'tool', text: 'Read x' });
    store.appendEvent({ type: 'agent.cost', runId: 'r1', ts: 2, agentId: 'a', usd: 0.5 });
    store.appendEvent({ type: 'run.status', runId: 'r1', ts: 3, status: 'completed' });
    store.appendEvent({ type: 'agent.cost', runId: 'r2', ts: 4, agentId: 'a', usd: 9 });

    expect(store.events('r1').map((e) => e.type)).toEqual(['agent.log', 'agent.cost', 'run.status']);
    expect(store.events('r1', ['agent.cost', 'run.status']).map((e) => e.ts)).toEqual([2, 3]);
    store.close();
  });
});
