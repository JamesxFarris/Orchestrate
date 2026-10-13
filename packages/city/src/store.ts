import { create } from 'zustand';
export { ACTIVITY_COLOR, TASK_COLOR } from './palette.ts';
import type { AgentActivity, AgentSnapshot, OrchestrateEvent, RunState, TaskStatus } from '@orchestrate/shared';

export interface TeamRole {
  id: string;
  title: string;
  kind: string;
  tier: 'exec' | 'principal' | 'lead' | 'senior' | 'ic';
  squad?: string;
  reportsTo?: string;
}
export interface TeamSquad {
  id: string;
  name: string;
  color: string;
  mission: string;
}
export interface Team {
  mode: 'live' | 'demo';
  project: { name: string; language: string };
  squads: TeamSquad[];
  roles: TeamRole[];
  techCircle: string[];
}

export interface AgentView extends AgentSnapshot {
  /** Timestamp of the last merge this agent took part in (drives the green flash). */
  flashAt?: number;
}

export interface CameraCmd {
  kind: 'overview' | 'angled' | 'focus';
  target?: [number, number, number];
  seq: number;
}

export interface Trail {
  id: number;
  from: string;
  to: string;
  reason: string;
  at: number;
}

interface CityState {
  team?: Team;
  connected: boolean;
  agents: Record<string, AgentView>;
  runs: Record<string, RunState>;
  currentRunId?: string;
  events: OrchestrateEvent[];
  trails: Trail[];
  circleActive: boolean;
  selectedAgent?: string;
  /** Task whose tree was clicked (shows the task panel). */
  selectedTask?: string;
  highlightTask?: string;
  /** performance.now() when the last run completed; drives the city-wide glow wave. */
  waveAt?: number;
  /** Latest camera request from the HUD or a double-click; seq makes repeats re-trigger. */
  cameraCmd?: CameraCmd;
  setTeam(t: Team): void;
  setConnected(c: boolean): void;
  hydrate(agents: AgentSnapshot[], runs: RunState[]): void;
  ingest(e: OrchestrateEvent): void;
  select(agentId?: string): void;
  selectTask(taskId?: string): void;
  camera(cmd: Omit<CameraCmd, 'seq'>): void;
  highlight(taskId?: string): void;
  upsertRun(r: RunState): void;
}

let trailSeq = 0;
const MAX_EVENTS = 800;

function idle(agentId: string): AgentView {
  return { agentId, activity: 'idle', since: Date.now(), costUsd: 0 };
}

function patchTask(run: RunState | undefined, taskId: string, status: TaskStatus, detail?: string): RunState | undefined {
  if (!run) return run;
  return { ...run, tasks: run.tasks.map((t) => (t.contract.id === taskId ? { ...t, status, detail } : t)) };
}

export const useCity = create<CityState>((set, get) => ({
  connected: false,
  agents: {},
  runs: {},
  events: [],
  trails: [],
  circleActive: false,

  setTeam: (team) => set({ team }),
  setConnected: (connected) => set({ connected }),

  hydrate: (agents, runs) =>
    set(() => {
      const byId: Record<string, AgentView> = {};
      for (const a of agents) byId[a.agentId] = a;
      const runMap: Record<string, RunState> = {};
      for (const r of runs) runMap[r.id] = r;
      return { agents: byId, runs: runMap, currentRunId: runs[0]?.id };
    }),

  upsertRun: (r) => set((s) => ({ runs: { ...s.runs, [r.id]: r } })),

  select: (selectedAgent) => set({ selectedAgent, selectedTask: undefined }),
  selectTask: (selectedTask) => set({ selectedTask, selectedAgent: undefined }),
  camera: (cmd) => set((s) => ({ cameraCmd: { ...cmd, seq: (s.cameraCmd?.seq ?? 0) + 1 } })),
  highlight: (highlightTask) => set({ highlightTask }),

  ingest: (e) => {
    const s = get();
    const events = s.events.length >= MAX_EVENTS ? [...s.events.slice(-MAX_EVENTS / 2), e] : [...s.events, e];
    const next: Partial<CityState> = { events };
    const agent = (id: string) => ({ ...(s.agents[id] ?? idle(id)) });
    const run = e.runId ? s.runs[e.runId] : undefined;

    switch (e.type) {
      case 'run.created':
        next.runs = { ...s.runs, [e.runId]: { id: e.runId, prompt: e.prompt, status: 'planning', createdAt: e.ts, tasks: [], costUsd: 0 } };
        next.currentRunId = e.runId;
        break;
      case 'run.status':
        if (run) next.runs = { ...s.runs, [e.runId]: { ...run, status: e.status, detail: e.detail } };
        if (['completed', 'failed', 'cancelled'].includes(e.status)) next.circleActive = false;
        if (e.status === 'completed') next.waveAt = performance.now();
        break;
      case 'plan.proposed':
        if (run && e.problems.length === 0) {
          next.runs = { ...s.runs, [e.runId]: { ...run, plan: e.plan, tasks: e.plan.tasks.map((contract) => ({ contract, status: 'pending', attempts: 0 })) } };
        }
        break;
      case 'run.summary':
        if (run) next.runs = { ...s.runs, [e.runId]: { ...run, summary: e.summary, integrationBranch: e.branch } };
        break;
      case 'task.status':
        next.runs = { ...s.runs, [e.runId]: patchTask(run, e.taskId, e.status, e.detail)! };
        break;
      case 'circle.convened':
        next.circleActive = true;
        break;
      case 'circle.adjourned':
        next.circleActive = false;
        break;
      case 'agent.activity': {
        const a = agent(e.agentId);
        if (a.activity !== e.activity) a.since = e.ts;
        a.activity = e.activity as AgentActivity;
        a.taskId = e.activity === 'idle' ? undefined : e.taskId;
        a.taskTitle = e.activity === 'idle' ? undefined : e.taskTitle;
        a.summary = e.activity === 'idle' ? undefined : (e.summary ?? a.summary);
        next.agents = { ...s.agents, [e.agentId]: a };
        break;
      }
      case 'agent.progress': {
        const a = agent(e.agentId);
        a.summary = e.summary;
        next.agents = { ...s.agents, [e.agentId]: a };
        break;
      }
      case 'agent.cost': {
        const a = agent(e.agentId);
        a.costUsd += e.usd;
        next.agents = { ...s.agents, [e.agentId]: a };
        if (run) next.runs = { ...s.runs, [run.id]: { ...run, costUsd: run.costUsd + e.usd } };
        break;
      }
      case 'handoff': {
        const now = performance.now();
        const trails = s.trails.filter((t) => now - t.at < 6000);
        trails.push({ id: ++trailSeq, from: e.from, to: e.to, reason: e.reason, at: now });
        next.trails = trails;
        if (e.reason === 'merged') {
          const lead = agent(e.from);
          lead.flashAt = now;
          next.agents = { ...s.agents, [e.from]: lead, [e.to]: { ...agent(e.to), flashAt: now } };
        }
        break;
      }
    }
    set(next);
  },
}));


export const ACTIVITY_LABEL: Record<AgentActivity, string> = {
  idle: 'Idle',
  working: 'Working',
  testing: 'Testing',
  reviewing: 'Reviewing',
  blocked: 'Blocked',
};


export const TASK_LABEL: Record<TaskStatus, string> = {
  pending: 'pending',
  red: 'writing tests',
  in_progress: 'building',
  verifying: 'verifying',
  review: 'in review',
  merged: 'merged',
  escalated: 'escalated',
  failed: 'failed',
  skipped: 'skipped',
};
