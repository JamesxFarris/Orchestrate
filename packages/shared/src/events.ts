import type { CircleReview, CodeReview, EscalationDecision, Plan, TaskContract } from './plan.ts';

export type RunStatus =
  | 'planning'
  | 'reviewing' // tech circle in session
  | 'awaiting_approval' // waiting for the human (CTO) gate
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskStatus =
  | 'pending'
  | 'red' // QA writing failing tests
  | 'in_progress' // implementer working
  | 'verifying' // gates running
  | 'review' // lead reviewing the diff
  | 'merged'
  | 'escalated' // needs a human or a replan
  | 'failed'
  | 'skipped'; // a dependency did not merge

/** What a building in the city shows. */
export type AgentActivity = 'idle' | 'working' | 'testing' | 'reviewing' | 'blocked';

export type GateName = 'setup' | 'red' | 'typecheck' | 'lint' | 'test' | 'audit' | 'full';

interface Base {
  ts: number;
  runId?: string;
}

export type OrchestrateEvent =
  | (Base & { type: 'run.created'; runId: string; prompt: string })
  | (Base & { type: 'run.status'; runId: string; status: RunStatus; detail?: string })
  | (Base & { type: 'plan.proposed'; runId: string; plan: Plan; round: number; problems: string[] })
  | (Base & { type: 'circle.convened'; runId: string; members: string[] })
  | (Base & { type: 'circle.review'; runId: string; roleId: string; review: CircleReview })
  | (Base & { type: 'circle.adjourned'; runId: string; approved: boolean })
  | (Base & { type: 'task.status'; runId: string; taskId: string; status: TaskStatus; detail?: string })
  | (Base & {
      type: 'agent.activity';
      agentId: string;
      activity: AgentActivity;
      taskId?: string;
      taskTitle?: string;
      summary?: string;
    })
  | (Base & { type: 'agent.progress'; agentId: string; taskId?: string; summary: string })
  | (Base & { type: 'agent.log'; agentId: string; taskId?: string; kind: 'tool' | 'text' | 'denied' | 'error'; text: string })
  | (Base & { type: 'agent.cost'; agentId: string; taskId?: string; usd: number })
  | (Base & { type: 'gate.result'; runId: string; taskId: string; gate: GateName; ok: boolean; output: string })
  | (Base & { type: 'handoff'; runId: string; taskId: string; from: string; to: string; reason: string })
  | (Base & {
      type: 'escalation';
      runId: string;
      taskId: string;
      from: string;
      to: string;
      reason: string;
      decision?: EscalationDecision;
    })
  | (Base & { type: 'code.review'; runId: string; taskId: string; roleId: string; review: CodeReview })
  | (Base & { type: 'run.summary'; runId: string; summary: string; followUps: string[]; branch: string });

export type OrchestrateEventType = OrchestrateEvent['type'];

/** Distributive Omit so `emit({ type: ..., ... })` type-checks per variant without `ts`. */
export type EventInput = OrchestrateEvent extends infer E ? (E extends unknown ? Omit<E, 'ts'> : never) : never;

export interface TaskState {
  contract: TaskContract;
  status: TaskStatus;
  attempts: number;
  branch?: string;
  detail?: string;
}

export interface RunState {
  id: string;
  prompt: string;
  status: RunStatus;
  createdAt: number;
  plan?: Plan;
  tasks: TaskState[];
  integrationBranch?: string;
  summary?: string;
  costUsd: number;
  detail?: string;
}

export interface AgentSnapshot {
  agentId: string;
  activity: AgentActivity;
  taskId?: string;
  taskTitle?: string;
  summary?: string;
  since: number;
  costUsd: number;
}
