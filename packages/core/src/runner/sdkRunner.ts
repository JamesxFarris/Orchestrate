import { query, type HookCallback, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { createScopeGuard, ORCH_MCP_SERVER, type GuardDecision } from '../scope/scopeGuard.ts';
import { createRoleToolServer, RoleToolState } from './roleTools.ts';
import type { AgentInvocation, AgentResult, AgentRunner } from './types.ts';

/** One-line description of a tool call for the live log. */
export function describeToolCall(name: string, input: unknown): string {
  const a = (input ?? {}) as Record<string, unknown>;
  const target = a.file_path ?? a.notebook_path ?? a.command ?? a.pattern ?? a.summary ?? '';
  return `${name}${target ? ` ${String(target).slice(0, 160)}` : ''}`;
}

/**
 * Runs one agent as a fresh Claude Agent SDK session. Every tool call passes through the scope
 * guard twice over: the PreToolUse hook (fires for every call) and canUseTool (any permission prompt).
 */
export class SdkRunner implements AgentRunner {
  async run(inv: AgentInvocation): Promise<AgentResult> {
    const state = new RoleToolState(inv.onSignal);
    const guard = createScopeGuard(inv.guard);
    let denials = 0;

    const decide = (toolName: string, input: unknown): GuardDecision => {
      const isRoleTool = toolName.startsWith(`mcp__${ORCH_MCP_SERVER}__`);
      if (state.halted && !isRoleTool) {
        return { allow: false, reason: 'You have already submitted or escalated. End your turn now.' };
      }
      const d = guard.check(toolName, input);
      if (!d.allow) {
        denials++;
        inv.onSignal({ kind: 'log', level: 'denied', text: `${describeToolCall(toolName, input)} — ${d.reason}` });
      } else if (!isRoleTool) {
        inv.onSignal({ kind: 'log', level: 'tool', text: describeToolCall(toolName, input) });
      }
      return d;
    };

    const preToolUse: HookCallback = async (input) => {
      if (input.hook_event_name !== 'PreToolUse') return {};
      const d = decide(input.tool_name, input.tool_input);
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: d.allow ? 'allow' : 'deny',
          ...(d.allow ? {} : { permissionDecisionReason: d.reason }),
        },
      };
    };

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new Error('timeout')), inv.runtime.timeoutMs);
    const onParentAbort = () => abort.abort(inv.signal?.reason);
    inv.signal?.addEventListener('abort', onParentAbort, { once: true });

    const options: Options = {
      cwd: inv.cwd,
      additionalDirectories: [...(inv.guard.externalRead ?? [])],
      model: inv.runtime.model,
      effort: inv.runtime.effort,
      maxTurns: inv.runtime.maxTurns,
      maxBudgetUsd: inv.runtime.maxBudgetUsd,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: inv.systemPrompt },
      tools: inv.tools,
      disallowedTools: ['WebFetch', 'WebSearch', 'Task', 'Agent'],
      mcpServers: { [ORCH_MCP_SERVER]: createRoleToolServer(state) },
      hooks: { PreToolUse: [{ hooks: [preToolUse] }] },
      canUseTool: async (toolName, input) => {
        const d = decide(toolName, input);
        return d.allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: d.reason };
      },
      permissionMode: 'default',
      settingSources: [],
      persistSession: false,
      abortController: abort,
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'orchestrate/0.1.0' },
      ...(inv.outputSchema ? { outputFormat: { type: 'json_schema' as const, schema: inv.outputSchema } } : {}),
    };

    const result: AgentResult = { outcome: 'completed', text: '', costUsd: 0, turns: 0, denials: 0 };
    try {
      for await (const msg of query({ prompt: inv.prompt, options }) as AsyncIterable<SDKMessage>) {
        if (msg.type === 'assistant') {
          for (const block of msg.message.content) {
            if (block.type === 'text' && block.text.trim()) {
              inv.onSignal({ kind: 'log', level: 'text', text: block.text.trim().slice(0, 400) });
            }
          }
        } else if (msg.type === 'result') {
          result.costUsd = msg.total_cost_usd;
          result.turns = msg.num_turns;
          if (msg.subtype === 'success') {
            result.text = msg.result;
            result.structured = msg.structured_output;
            if (msg.is_error) {
              result.outcome = 'error';
              result.error = msg.result;
            }
          } else {
            result.outcome = msg.subtype === 'error_max_turns' || msg.subtype === 'error_max_budget_usd' ? 'budget' : 'error';
            result.error = `${msg.subtype}${msg.errors.length ? `: ${msg.errors.join('; ')}` : ''}`;
          }
        }
      }
    } catch (err) {
      result.outcome = abort.signal.aborted && inv.signal?.aborted ? 'cancelled' : 'error';
      result.error = abort.signal.aborted && !inv.signal?.aborted ? `timed out after ${inv.runtime.timeoutMs}ms` : String(err);
    } finally {
      clearTimeout(timer);
      inv.signal?.removeEventListener('abort', onParentAbort);
    }

    if (result.costUsd) inv.onSignal({ kind: 'cost', usd: result.costUsd });
    if (result.error) inv.onSignal({ kind: 'log', level: 'error', text: result.error });

    result.denials = denials;
    result.submitSummary = state.submitSummary;
    result.scopeRequest = state.scopeRequest;
    result.blocker = state.blocker;
    // Escalations win over a "successful" end of turn: the agent was told to stop.
    if (state.scopeRequest) result.outcome = 'scope_change';
    else if (state.blocker) result.outcome = 'blocked';
    else if (state.submitSummary && result.outcome === 'completed') result.outcome = 'submitted';
    return result;
  }
}
