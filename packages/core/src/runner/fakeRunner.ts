import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createScopeGuard } from '../scope/scopeGuard.ts';
import { RoleToolState } from './roleTools.ts';
import type { AgentInvocation, AgentResult, AgentRunner } from './types.ts';

export interface FakeAgentContext {
  inv: AgentInvocation;
  /** 1-based count of invocations so far for this agent+task. */
  attempt: number;
  /** Write through the scope guard, as a real agent's Write tool would. Returns false when denied. */
  write(rel: string, content: string): boolean;
  /** Write straight to disk, bypassing the guard (simulates an escape the post-hoc audit must catch). */
  rogueWrite(rel: string, content: string): void;
  read(rel: string): string | undefined;
  progress(summary: string): void;
  submit(summary: string): void;
  requestScope(paths: string[], reason: string): void;
  block(reason: string): void;
}

export interface FakeReply {
  structured?: unknown;
  text?: string;
  costUsd?: number;
  /** End the session as if it hit its budget or crashed, whatever the agent did before. */
  ended?: 'budget' | 'error';
}

export type FakeHandler = (ctx: FakeAgentContext) => Promise<FakeReply | void> | FakeReply | void;

/** Deterministic stand-in for SdkRunner. Lets tests script each role's behaviour with zero API spend. */
export class FakeRunner implements AgentRunner {
  readonly calls: AgentInvocation[] = [];
  private counts = new Map<string, number>();

  constructor(private readonly handler: FakeHandler) {}

  async run(inv: AgentInvocation): Promise<AgentResult> {
    this.calls.push(inv);
    const key = `${inv.agentId}:${inv.taskId ?? ''}`;
    const attempt = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, attempt);

    const state = new RoleToolState(inv.onSignal);
    const guard = createScopeGuard(inv.guard);
    let denials = 0;
    const abs = (rel: string) => path.join(inv.cwd, rel);
    const put = (rel: string, content: string) => {
      mkdirSync(path.dirname(abs(rel)), { recursive: true });
      writeFileSync(abs(rel), content);
    };

    const ctx: FakeAgentContext = {
      inv,
      attempt,
      write: (rel, content) => {
        const d = state.halted ? { allow: false as const, reason: 'halted' } : guard.check('Write', { file_path: abs(rel) });
        if (!d.allow) {
          denials++;
          inv.onSignal({ kind: 'log', level: 'denied', text: `Write ${rel} — ${d.reason}` });
          return false;
        }
        inv.onSignal({ kind: 'log', level: 'tool', text: `Write ${rel}` });
        put(rel, content);
        return true;
      },
      rogueWrite: put,
      read: (rel) => {
        try {
          return readFileSync(abs(rel), 'utf8');
        } catch {
          return undefined;
        }
      },
      progress: (s) => void state.reportProgress(s),
      submit: (s) => void state.submitWork(s),
      requestScope: (paths, reason) => void state.requestScopeChange(paths, reason),
      block: (reason) => void state.raiseBlocker(reason),
    };

    const reply = (await this.handler(ctx)) ?? {};
    const costUsd = reply.costUsd ?? 0;
    if (costUsd) inv.onSignal({ kind: 'cost', usd: costUsd });

    let outcome: AgentResult['outcome'] = 'completed';
    if (reply.ended) outcome = reply.ended;
    else if (state.scopeRequest) outcome = 'scope_change';
    else if (state.blocker) outcome = 'blocked';
    else if (state.submitSummary) outcome = 'submitted';

    return {
      outcome,
      text: reply.text ?? '',
      structured: reply.structured,
      costUsd,
      turns: 1,
      denials,
      submitSummary: state.submitSummary,
      scopeRequest: state.scopeRequest,
      blocker: state.blocker,
    };
  }
}
