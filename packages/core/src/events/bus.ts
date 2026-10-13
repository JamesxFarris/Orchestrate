import type { AgentSnapshot, EventInput, OrchestrateEvent } from '@orchestrate/shared';

export type Listener = (event: OrchestrateEvent) => void;

/**
 * Typed event fan-out. Also keeps the live per-agent snapshot the city needs on first load,
 * so a fresh client does not have to replay history to know which buildings are lit.
 */
export class EventBus {
  private listeners = new Set<Listener>();
  private agents = new Map<string, AgentSnapshot>();

  emit(input: EventInput): OrchestrateEvent {
    const event = { ...input, ts: Date.now() } as OrchestrateEvent;
    this.track(event);
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        console.error('[bus] listener failed', err);
      }
    }
    return event;
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  agentSnapshots(): AgentSnapshot[] {
    return [...this.agents.values()];
  }

  private snapshot(agentId: string): AgentSnapshot {
    let s = this.agents.get(agentId);
    if (!s) {
      s = { agentId, activity: 'idle', since: Date.now(), costUsd: 0 };
      this.agents.set(agentId, s);
    }
    return s;
  }

  private track(e: OrchestrateEvent): void {
    switch (e.type) {
      case 'agent.activity': {
        const s = this.snapshot(e.agentId);
        if (s.activity !== e.activity) s.since = e.ts;
        s.activity = e.activity;
        s.taskId = e.activity === 'idle' ? undefined : e.taskId;
        s.taskTitle = e.activity === 'idle' ? undefined : e.taskTitle;
        s.summary = e.activity === 'idle' ? undefined : (e.summary ?? s.summary);
        break;
      }
      case 'agent.progress':
        this.snapshot(e.agentId).summary = e.summary;
        break;
      case 'agent.cost':
        this.snapshot(e.agentId).costUsd += e.usd;
        break;
    }
  }
}
