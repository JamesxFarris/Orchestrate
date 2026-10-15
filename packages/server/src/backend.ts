import type { EventBus, Org, Orchestrator, ShipResult, Store } from '@orchestrate/core';
import type { OrchestrateEvent, ProgressSnapshot, RunState } from '@orchestrate/shared';

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
  /** Merge a completed run into the default branch (see core ship/ship.ts). */
  ship(runId: string): Promise<ShipResult>;
  /** Record a run as shipped by hand, for merges detection cannot see (squash, rebase). */
  markShipped(runId: string): Promise<boolean>;
  progress(): ProgressSnapshot;
  /** Cancel active runs and wait (bounded) for them to record their status and clean up. */
  shutdown(): Promise<void>;
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
    ship: (id) => orch.ship(id),
    markShipped: (id) => orch.markShipped(id),
    progress: () => orch.progress(),
    shutdown: async () => {
      await orch.shutdown();
      store.close();
    },
  };
}
