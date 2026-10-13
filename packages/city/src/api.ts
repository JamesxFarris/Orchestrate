import type { AgentSnapshot, OrchestrateEvent, RunState } from '@orchestrate/shared';
import { useCity, type Team } from './store.ts';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  team: () => json<Team>('/api/team'),
  state: () => json<{ agents: AgentSnapshot[]; runs: RunState[] }>('/api/state'),
  submit: (prompt: string, autoApprove: boolean) =>
    json<RunState>('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, autoApprove }) }),
  approve: (id: string) => json(`/api/runs/${id}/approve`, { method: 'POST' }),
  cancel: (id: string) => json(`/api/runs/${id}/cancel`, { method: 'POST' }),
  events: (id: string) => json<OrchestrateEvent[]>(`/api/runs/${id}/events`),
};

const REPLAY = new Set<OrchestrateEvent['type']>(['agent.log', 'gate.result', 'circle.review', 'code.review', 'escalation']);

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
      if (data.type !== 'hello') useCity.getState().ingest(data);
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
