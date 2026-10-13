import type { AgentRuntime } from '@orchestrate/shared';
import type { ScopeGuardConfig } from '../scope/scopeGuard.ts';

/** Signals an agent run streams back while working. */
export type AgentSignal =
  | { kind: 'progress'; summary: string }
  | { kind: 'log'; level: 'tool' | 'text' | 'denied' | 'error'; text: string }
  | { kind: 'cost'; usd: number };

export interface AgentInvocation {
  agentId: string;
  taskId?: string;
  runtime: AgentRuntime;
  /** Working directory; also the scope guard's root. */
  cwd: string;
  systemPrompt: string;
  prompt: string;
  /** Built-in tools this agent can see at all. */
  tools: string[];
  guard: ScopeGuardConfig;
  /** JSON schema the final answer must satisfy (structured output). */
  outputSchema?: Record<string, unknown>;
  signal?: AbortSignal;
  onSignal: (s: AgentSignal) => void;
}

export type AgentOutcome =
  | 'submitted' // implementer called submit_work
  | 'completed' // finished without submit_work (planners, reviewers)
  | 'scope_change' // asked to widen its write scope
  | 'blocked' // raised a blocker
  | 'budget' // hit turn or cost limit
  | 'cancelled'
  | 'error';

export interface AgentResult {
  outcome: AgentOutcome;
  text: string;
  structured?: unknown;
  costUsd: number;
  turns: number;
  denials: number;
  submitSummary?: string;
  scopeRequest?: { paths: string[]; reason: string };
  blocker?: string;
  error?: string;
}

export interface AgentRunner {
  run(inv: AgentInvocation): Promise<AgentResult>;
}

/** Tools by job. Planners/reviewers never get write tools; the guard backs this up. */
export const READ_TOOLS = ['Read', 'Glob', 'Grep'];
export const BUILD_TOOLS = ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'TodoWrite'];
