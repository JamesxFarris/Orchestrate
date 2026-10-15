import { describe, expect, it } from 'vitest';
import { AgentRuntime } from '@orchestrate/shared';
import { createRoleToolServer, RoleToolState } from '../src/runner/roleTools.ts';
import { buildOptions } from '../src/runner/sdkRunner.ts';
import type { AgentInvocation } from '../src/runner/types.ts';

const inv: AgentInvocation = {
  agentId: 'core-dev',
  runtime: AgentRuntime.parse({ model: 'claude-opus-5-5', maxTurns: 5, maxBudgetUsd: 1, timeoutMs: 1000 }),
  cwd: '/repo',
  systemPrompt: 'be good',
  prompt: 'see @secrets/.env',
  tools: ['Read', 'Write'],
  guard: { root: '/repo', write: ['src/**'], read: ['**'], protected: [], bash: [] },
  onSignal: () => {},
};
const roleTools = createRoleToolServer(new RoleToolState(() => {}));
const options = buildOptions(inv, { roleTools, preToolUse: async () => ({}), decide: () => ({ allow: false, reason: 'no' }), abort: new AbortController() });

describe('agent session options: what keeps an agent contained', () => {
  it('loads nothing from the target repo, and keeps every tool call in front of the guard', () => {
    expect(options.settingSources).toEqual([]);
    expect(options.permissionMode).toBe('default');
    expect(options.hooks?.PreToolUse?.[0]?.hooks).toHaveLength(1);
    expect(options.persistSession).toBe(false);
    expect(options.disallowedTools).toEqual(expect.arrayContaining(['WebFetch', 'WebSearch', 'Task', 'Agent']));
  });

  it('sends task text verbatim: "@path" is not expanded by the CLI behind the guard', () => {
    expect(options.verbatimPrompts).toBe(true);
  });

  it('asks the guard on permission prompts too', async () => {
    const r = await options.canUseTool!('Write', { file_path: 'x' }, { signal: new AbortController().signal, suggestions: [], toolUseID: 't' } as never);
    expect(r).toMatchObject({ behavior: 'deny', message: 'no' });
  });

  it('keeps credentials out of the commands an agent runs', () => {
    expect(options.env?.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBe('1');
  });

  it('adds the Stop hook only for agents that must submit', () => {
    expect(options.hooks?.Stop).toBeUndefined();
    const gate = async () => ({});
    const must = buildOptions({ ...inv, requireSubmit: true }, { roleTools, preToolUse: async () => ({}), stopGate: gate, decide: () => ({ allow: true }), abort: new AbortController() });
    expect(must.hooks?.Stop?.[0]?.hooks).toEqual([gate]);
  });

  it('never defers the role tools behind tool search (the guard refuses ToolSearch)', () => {
    // the SDK marks each tool; reading the registered tools is the only way to see it from outside
    const tools = (roleTools.instance as unknown as { _registeredTools: Record<string, { _meta?: Record<string, unknown> }> })._registeredTools;
    expect(Object.keys(tools).sort()).toEqual(['raise_blocker', 'report_progress', 'request_scope_change', 'submit_work']);
    for (const t of Object.values(tools)) expect(t._meta?.['anthropic/alwaysLoad']).toBe(true);
  });
});
