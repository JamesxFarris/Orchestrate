import type { AgentActivity, AgentSnapshot, GateName, OrchestrateEvent, ProgressSnapshot, RunState, TaskStatus } from '@orchestrate/shared';
import type { Team } from '../../store.ts';

/**
 * The task board's view model: joins the run's tasks, live agent snapshots, the event stream and the
 * team into one tile per task. Pure, so the rules (ordering, blockers, what counts as the latest
 * action) are unit-tested without a browser; the component only draws what this returns.
 */

/** A task's growth stage: seed = QA writing tests, sprout = building, bud = in review, bloom = merged. */
export type Stage = 'queued' | 'seed' | 'sprout' | 'bud' | 'bloom' | 'wilt' | 'skipped';
/** Drives sort order and emphasis: stuck work first, finished work last. */
export type Tone = 'stuck' | 'active' | 'queued' | 'done';
/** What the tile's colour means: one colour per phase of work, so a run reads at a glance. */
export type Phase = 'queued' | 'tests' | 'building' | 'checks' | 'review' | 'merged' | 'stuck' | 'skipped';

export interface BoardAgent {
  id: string;
  title: string;
  kind: string;
  activity: AgentActivity;
  since: number;
  costUsd: number;
}

export interface BoardTile {
  taskId: string;
  title: string;
  kind: 'code' | 'research';
  squad: { id: string; name: string; color: string };
  status: TaskStatus;
  statusLabel: string;
  stage: Stage;
  tone: Tone;
  phase: Phase;
  attempts: number;
  agent?: BoardAgent;
  /** The agent's latest "what I'm doing" summary. */
  progress?: string;
  /** The current agent's latest real tool call, e.g. "edited src/hud.ts". */
  lastAction?: string;
  gates: { gate: GateName; ok: boolean }[];
  /** An escalation the lead has not ruled on yet. */
  blocker?: string;
  /** Why the task escalated or failed. */
  detail?: string;
  scope: string[];
  /** The squad's district: settlement name, level, and how far toward the next (0–1). */
  district?: { name: string; level: number; fraction: number };
  /** Growth this task earned (merged tasks only). */
  growth?: number;
}

/**
 * growing = still running; ready = completed, waiting for Ship it; shipped = banked; none = failed or
 * cancelled. growth = what this run has earned so far (banked once shipped).
 */
export interface ShipStatus {
  state: 'growing' | 'ready' | 'shipped' | 'none';
  growth: number;
}

export interface BoardModel {
  tiles: BoardTile[];
  counts: { working: number; waiting: number; done: number; total: number };
  ship: ShipStatus;
}

const STAGE: Record<TaskStatus, Stage> = {
  pending: 'queued',
  red: 'seed',
  in_progress: 'sprout',
  verifying: 'sprout',
  review: 'bud',
  merged: 'bloom',
  escalated: 'wilt',
  failed: 'wilt',
  skipped: 'skipped',
};

const LABEL: Record<TaskStatus, string> = {
  pending: 'queued',
  red: 'writing tests',
  in_progress: 'building',
  verifying: 'running checks',
  review: 'in review',
  merged: 'merged',
  escalated: 'needs a decision',
  failed: 'failed',
  skipped: 'skipped',
};

const TONE_ORDER: Record<Tone, number> = { stuck: 0, active: 1, queued: 2, done: 3 };

const PHASE: Record<TaskStatus, Phase> = {
  pending: 'queued',
  red: 'tests',
  in_progress: 'building',
  verifying: 'checks',
  review: 'review',
  merged: 'merged',
  escalated: 'stuck',
  failed: 'stuck',
  skipped: 'skipped',
};

const VERB: Record<string, string> = {
  Edit: 'edited',
  MultiEdit: 'edited',
  NotebookEdit: 'edited',
  Write: 'wrote',
  Read: 'read',
  Bash: 'ran',
  Glob: 'searched',
  Grep: 'searched for',
};

/**
 * "Edit src/a.ts" → "edited src/a.ts". Orchestrator role tools (mcp__…) are plumbing, not work, so
 * they return undefined and the caller keeps looking further back.
 */
export function describeAction(text: string): string | undefined {
  const space = text.indexOf(' ');
  const name = space < 0 ? text : text.slice(0, space);
  const rest = space < 0 ? '' : text.slice(space + 1).trim();
  if (name.startsWith('mcp__')) return undefined;
  const verb = VERB[name] ?? name.toLowerCase();
  return rest ? `${verb} ${rest}` : verb;
}

export function buildBoard(run: RunState, agents: Record<string, AgentSnapshot>, events: readonly OrchestrateEvent[], team: Team, progress?: ProgressSnapshot): BoardModel {
  const roles = new Map(team.roles.map((r) => [r.id, r]));
  const squads = new Map(team.squads.map((s) => [s.id, s]));
  const districts = new Map(progress?.districts.map((d) => [d.squad, d.settlement]));
  const runProgress = progress?.runs.find((r) => r.runId === run.id);
  const outcomes = new Map(runProgress?.outcomes.map((o) => [o.taskId, o]));
  // Task ids repeat across runs (demo runs reuse "spec"), so only this run's events count.
  const ofTask = (taskId: string) => events.filter((e) => e.runId === run.id && 'taskId' in e && e.taskId === taskId);

  const tiles = run.tasks.map((task, index): BoardTile & { index: number } => {
    const c = task.contract;
    const snapshot = Object.values(agents).find((a) => a.taskId === c.id && a.activity !== 'idle');
    const role = snapshot ? roles.get(snapshot.agentId) : undefined;
    const agent: BoardAgent | undefined = snapshot && {
      id: snapshot.agentId,
      title: role?.title ?? snapshot.agentId,
      kind: role?.kind ?? 'dev',
      activity: snapshot.activity,
      since: snapshot.since,
      costUsd: snapshot.costUsd,
    };

    const mine = ofTask(c.id);
    let lastAction: string | undefined;
    if (agent) {
      for (let i = mine.length - 1; i >= 0 && !lastAction; i--) {
        const e = mine[i]!;
        if (e.type === 'agent.log' && e.kind === 'tool' && e.agentId === agent.id) lastAction = describeAction(e.text);
      }
    }

    const gates = new Map<GateName, boolean>();
    for (const e of mine) if (e.type === 'gate.result') gates.set(e.gate, e.ok);

    const done = task.status === 'merged' || task.status === 'skipped';
    const lastEscalation = [...mine].reverse().find((e) => e.type === 'escalation');
    const blocker = !done && lastEscalation?.type === 'escalation' && !lastEscalation.decision ? lastEscalation.reason : undefined;

    const waitingOnLead = agent?.activity === 'blocked' || !!blocker;
    const tone: Tone = task.status === 'escalated' || task.status === 'failed' || waitingOnLead ? 'stuck' : done ? 'done' : task.status === 'pending' ? 'queued' : 'active';

    const squad = squads.get(c.squad);
    const settlement = districts.get(c.squad);
    const outcome = outcomes.get(c.id);
    return {
      index,
      taskId: c.id,
      title: c.title,
      kind: c.kind,
      squad: { id: c.squad, name: squad?.name ?? c.squad, color: squad?.color ?? '#8b7d66' },
      status: task.status,
      statusLabel: waitingOnLead && task.status !== 'escalated' && task.status !== 'failed' ? 'waiting on lead' : LABEL[task.status],
      stage: STAGE[task.status],
      tone,
      phase: tone === 'stuck' ? 'stuck' : PHASE[task.status],
      attempts: task.attempts,
      agent,
      progress: snapshot?.summary,
      lastAction,
      gates: [...gates].map(([gate, ok]) => ({ gate, ok })),
      blocker,
      detail: task.status === 'escalated' || task.status === 'failed' ? task.detail : undefined,
      scope: c.writeScope,
      district: settlement && { name: settlement.name, level: settlement.level, fraction: settlement.needed ? settlement.into / settlement.needed : 0 },
      growth: outcome?.merged ? outcome.growth : undefined,
    };
  });

  const growth = runProgress?.outcomes.reduce((sum, o) => sum + o.growth, 0) ?? 0;
  const ship: ShipStatus = {
    state: runProgress?.shippedAt !== undefined ? 'shipped' : run.status === 'completed' ? 'ready' : run.status === 'failed' || run.status === 'cancelled' ? 'none' : 'growing',
    growth,
  };

  tiles.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || a.index - b.index);

  return {
    tiles: tiles.map(({ index: _index, ...tile }) => tile),
    counts: {
      working: tiles.filter((t) => t.agent && t.tone !== 'stuck').length,
      waiting: tiles.filter((t) => t.tone === 'stuck').length,
      done: tiles.filter((t) => t.status === 'merged').length,
      total: tiles.length,
    },
    ship,
  };
}
