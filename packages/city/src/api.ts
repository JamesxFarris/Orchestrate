import type { AgentSnapshot, OrchestrateEvent, ProgressSnapshot, RunState } from '@orchestrate/shared';
import { useCity, type Team } from './store.ts';
import { levelUps } from './ui/harvest/harvest.ts';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  team: () => json<Team>('/api/team'),
  state: () => json<{ agents: AgentSnapshot[]; runs: RunState[]; progress?: ProgressSnapshot }>('/api/state'),
  progress: () => json<ProgressSnapshot>('/api/progress'),
  markShipped: (id: string) => json(`/api/runs/${id}/mark-shipped`, { method: 'POST' }),
  /** Ship it. Refusals come back as values (with the reason and git's output) rather than throwing. */
  ship: async (id: string, partial = false): Promise<ShipOutcome> => {
    const res = await fetch(`/api/runs/${id}/ship`, partial ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ partial }) } : { method: 'POST' });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, tested: !!body.tested };
    return { ok: false, message: String(body.error ?? `HTTP ${res.status}`), output: typeof body.output === 'string' ? body.output : undefined };
  },
  submit: (prompt: string, autoApprove: boolean) =>
    json<RunState>('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, autoApprove }) }),
  approve: (id: string) => json(`/api/runs/${id}/approve`, { method: 'POST' }),
  cancel: (id: string) => json(`/api/runs/${id}/cancel`, { method: 'POST' }),
  events: (id: string) => json<OrchestrateEvent[]>(`/api/runs/${id}/events`),
};

export type ShipOutcome = { ok: true; tested: boolean } | { ok: false; message: string; output?: string };

const REPLAY = new Set<OrchestrateEvent['type']>(['agent.log', 'gate.result', 'circle.review', 'code.review', 'escalation']);
/** Events that change growth: a task merging (pending), a run ending, a run shipping (banked). */
const PROGRESS_EVENTS = new Set<OrchestrateEvent['type']>(['task.status', 'run.status', 'run.shipped']);

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let harvestFor: string | undefined;

/**
 * Refetch progress (debounced). After a ship, compare before/after and open the Harvest screen.
 * A failed fetch is retried a few times: after a ship, it is the only thing that opens the Harvest
 * screen and turns the Ship bar from "Shipping…" to "Harvested".
 */
function refreshProgress(e?: OrchestrateEvent, attempt = 0): void {
  if (e?.type === 'run.shipped') harvestFor = e.runId;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      const before = useCity.getState().progress;
      const after = await api.progress();
      const shipped = harvestFor;
      harvestFor = undefined;
      useCity.getState().setProgress(after);
      if (shipped) useCity.getState().openHarvest({ runId: shipped, levelUps: before ? levelUps(before, after) : [] });
    } catch {
      if (attempt < 5) refreshProgress(undefined, attempt + 1);
    }
  }, attempt ? 1000 * 2 ** attempt : 250);
}

/** Load the org + live state, then stream events. Reconnects with backoff. */
export function connect(): () => void {
  const city = useCity.getState();
  let ws: WebSocket | undefined;
  let stopped = false;
  let delay = 500;
  // While a boot fetches the snapshot, events keep streaming in. They are newer than the snapshot,
  // so they wait here and are applied on top of it, rather than being overwritten by it.
  let queued: OrchestrateEvent[] | undefined;
  let generation = 0;

  const deliver = (e: OrchestrateEvent) => {
    useCity.getState().ingest(e);
    if (PROGRESS_EVENTS.has(e.type)) refreshProgress(e);
  };

  const boot = async () => {
    const gen = ++generation;
    queued = [];
    try {
      const [team, state] = await Promise.all([api.team(), api.state()]);
      const current = state.runs[0];
      // Restore the current run's logs and verdicts so panels have context after a reload.
      const history = current ? (await api.events(current.id)).filter((e) => REPLAY.has(e.type)).slice(-400) : undefined;
      if (gen !== generation) return; // a newer connection is booting; this snapshot is stale

      // a new team object rebuilds the whole scene, so only replace it when it changed
      if (JSON.stringify(team) !== JSON.stringify(useCity.getState().team)) city.setTeam(team);
      city.hydrate(state.agents, state.runs);
      if (state.progress) city.setProgress(state.progress);
      if (history) useCity.setState({ events: history });
      const seen = new Set(history?.map((e) => JSON.stringify(e)));
      for (const e of queued ?? []) if (!seen.has(JSON.stringify(e))) deliver(e);
    } catch {
      /* daemon not up yet; the socket loop retries */
      if (gen === generation) for (const e of queued ?? []) deliver(e);
    } finally {
      if (gen === generation) queued = undefined;
    }
  };

  const open = () => {
    if (stopped) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      delay = 500;
      useCity.getState().setConnected(true);
      void boot();
    };
    ws.onmessage = (m) => {
      const data = JSON.parse(m.data as string) as OrchestrateEvent | { type: 'hello' };
      if (data.type === 'hello') return;
      if (queued) queued.push(data);
      else deliver(data);
    };
    ws.onclose = () => {
      useCity.getState().setConnected(false);
      if (!stopped) setTimeout(open, (delay = Math.min(delay * 2, 8000)));
    };
  };

  open();
  return () => {
    stopped = true;
    ws?.close();
  };
}
