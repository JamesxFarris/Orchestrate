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

/** Refetch progress (debounced). After a ship, compare before/after and open the Harvest screen. */
function refreshProgress(e: OrchestrateEvent): void {
  if (e.type === 'run.shipped') harvestFor = e.runId;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    const shipped = harvestFor;
    harvestFor = undefined;
    try {
      const before = useCity.getState().progress;
      const after = await api.progress();
      useCity.getState().setProgress(after);
      if (shipped) useCity.getState().openHarvest({ runId: shipped, levelUps: before ? levelUps(before, after) : [] });
    } catch {
      /* the next event or reconnect will refresh */
    }
  }, 250);
}

/** Load the org + live state, then stream events. Reconnects with backoff. */
export function connect(): () => void {
  const city = useCity.getState();
  let ws: WebSocket | undefined;
  let stopped = false;
  let delay = 500;

  const boot = async () => {
    try {
      const [team, state] = await Promise.all([api.team(), api.state()]);
      city.setTeam(team);
      city.hydrate(state.agents, state.runs);
      if (state.progress) city.setProgress(state.progress);
      const current = state.runs[0];
      // Restore the current run's logs and verdicts so panels have context after a reload.
      if (current) {
        const history = (await api.events(current.id)).filter((e) => REPLAY.has(e.type));
        useCity.setState({ events: history.slice(-400) });
      }
    } catch {
      /* daemon not up yet; the socket loop retries */
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
      useCity.getState().ingest(data);
      if (PROGRESS_EVENTS.has(data.type)) refreshProgress(data);
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
