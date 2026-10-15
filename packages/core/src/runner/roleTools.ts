import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { ORCH_MCP_SERVER } from '../scope/scopeGuard.ts';
import type { AgentSignal } from './types.ts';

/** What an agent reported through its role tools during one run. */
export class RoleToolState {
  submitSummary?: string;
  scopeRequest?: { paths: string[]; reason: string };
  blocker?: string;

  constructor(private readonly onSignal: (s: AgentSignal) => void) {}

  /** Once an agent has escalated or submitted, further work is refused. */
  get halted(): boolean {
    return this.submitSummary !== undefined || this.scopeRequest !== undefined || this.blocker !== undefined;
  }

  reportProgress(summary: string): string {
    this.onSignal({ kind: 'progress', summary: summary.slice(0, 140) });
    return 'Progress noted.';
  }

  requestScopeChange(paths: string[], reason: string): string {
    this.scopeRequest = { paths, reason };
    return 'Escalated to your squad lead. Do not continue the work and do not try alternatives. End your turn now with a one-line summary.';
  }

  raiseBlocker(reason: string): string {
    this.blocker = reason;
    return 'Blocker escalated to your squad lead. End your turn now with a one-line summary.';
  }

  submitWork(summary: string): string {
    this.submitSummary = summary;
    return 'Submitted. The orchestrator will now run the gates and your lead will review. End your turn.';
  }
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

export function createRoleToolServer(state: RoleToolState) {
  return createSdkMcpServer({
    name: ORCH_MCP_SERVER,
    version: '0.1.0',
    // Never deferred behind tool search: the scope guard refuses ToolSearch, so a deferred
    // submit_work would be unreachable and every agent would end without submitting.
    alwaysLoad: true,
    tools: [
      tool(
        'report_progress',
        'Post a short (max 140 chars) status line about what you are doing right now. Call it at each meaningful step.',
        { summary: z.string().max(280) },
        async ({ summary }) => text(state.reportProgress(summary)),
      ),
      tool(
        'request_scope_change',
        'Use when finishing the task requires touching files outside your write scope or changing the contract. Escalates to your lead; you must stop afterwards.',
        { paths: z.array(z.string()).min(1), reason: z.string() },
        async ({ paths, reason }) => text(state.requestScopeChange(paths, reason)),
      ),
      tool(
        'raise_blocker',
        'Use when you cannot meet the acceptance criteria within the contract (missing dependency, contradictory requirements, broken environment). Escalates; you must stop afterwards.',
        { reason: z.string() },
        async ({ reason }) => text(state.raiseBlocker(reason)),
      ),
      tool(
        'submit_work',
        'Declare the task complete once the acceptance criteria are met and the relevant tests pass locally.',
        { summary: z.string() },
        async ({ summary }) => text(state.submitWork(summary)),
      ),
    ],
  });
}
