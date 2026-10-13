import type { EventBus, Org, Orchestrator, Store } from '@orchestrate/core';
import type { OrchestrateEvent, RunState } from '@orchestrate/shared';

/** What the HTTP layer needs. Implemented by the real orchestrator and by the demo simulator. */
export interface Backend {
  readonly mode: 'live' | 'demo';
  readonly bus: EventBus;
  readonly org: Org;
  submit(prompt: string, opts: { autoApprove?: boolean; baseRef?: string }): RunState;
  approve(runId: string): boolean;
  cancel(runId: string): boolean;
  get(runId: string): RunState | undefined;
  list(): RunState[];
  events(runId: string): OrchestrateEvent[];
}

export function liveBackend(orch: Orchestrator, store: Store): Backend {
  return {
    mode: 'live',
    bus: orch.bus,
    org: orch.org,
    submit: (prompt, opts) => orch.submit(prompt, opts),
    approve: (id) => orch.approve(id),
    cancel: (id) => orch.cancel(id),
    get: (id) => orch.get(id),
    list: () => orch.list(),
    events: (id) => store.events(id),
  };
}
