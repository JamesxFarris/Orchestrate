import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AgentRuntime } from '@orchestrate/shared';
import { SdkRunner } from '../src/runner/sdkRunner.ts';
import type { AgentSignal } from '../src/runner/types.ts';
import { BUILD_TOOLS } from '../src/runner/types.ts';
import { commandPattern } from '../src/scope/scopeGuard.ts';
import { makeFixtureRepo } from './helpers.ts';

/**
 * Opt-in: spends real API money (a few cents). Run with
 *   ORCH_LIVE=1 npx vitest run packages/core/test/live.test.ts
 */
const live = process.env.ORCH_LIVE === '1';
const fx = live ? makeFixtureRepo() : undefined;
describe.skipIf(!live)('SdkRunner against the real Claude Agent SDK', () => {
  afterAll(() => fx && rmSync(fx.root, { recursive: true, force: true }));

  it('enforces scope on a real agent and captures role-tool signals', async () => {
    const signals: AgentSignal[] = [];
    const result = await new SdkRunner().run({
      agentId: 'core-dev',
      taskId: 'sum',
      runtime: AgentRuntime.parse({ model: process.env.ORCH_LIVE_MODEL ?? 'claude-opus-5-5', effort: 'low', maxTurns: 12, maxBudgetUsd: 0.5, timeoutMs: 180_000 }),
      cwd: fx!.repo,
      systemPrompt: 'You are a test agent. Follow the user instructions exactly and briefly.',
      prompt: [
        '1. Call mcp__orch__report_progress with summary "starting".',
        '2. Create src/sum.js containing exactly: export const sum = (a, b) => a + b;',
        '3. Try to create src/other.js containing: export {}; (it may be refused; if refused, do not retry or work around it).',
        '4. Call mcp__orch__submit_work with summary "done".',
      ].join('\n'),
      tools: BUILD_TOOLS,
      guard: { root: fx!.repo, write: ['src/sum.js'], read: ['**'], protected: [], bash: [commandPattern('node --test')] },
      onSignal: (s) => signals.push(s),
    });

    console.log(JSON.stringify({ outcome: result.outcome, cost: result.costUsd, turns: result.turns, denials: result.denials, error: result.error }));
    expect(result.initTools).toContain('mcp__orch__submit_work');
    expect(result.outcome).toBe('submitted');
    expect(readFileSync(path.join(fx!.repo, 'src', 'sum.js'), 'utf8')).toContain('a + b');
    expect(existsSync(path.join(fx!.repo, 'src', 'other.js'))).toBe(false);
    expect(result.denials).toBeGreaterThanOrEqual(1);
    expect(signals.some((s) => s.kind === 'progress' && s.summary === 'starting')).toBe(true);
    expect(signals.some((s) => s.kind === 'log' && s.level === 'denied')).toBe(true);
    expect(result.costUsd).toBeGreaterThan(0);
  }, 240_000);

  // Tool search defers MCP tools behind a ToolSearch call the guard refuses; the role tools must
  // stay loaded anyway. And credentials must not reach the commands the agent runs.
  it('keeps the role tools reachable with tool search on, and hides credentials from Bash', async () => {
    const saved = { search: process.env.ENABLE_TOOL_SEARCH, headers: process.env.ANTHROPIC_CUSTOM_HEADERS };
    process.env.ENABLE_TOOL_SEARCH = 'true';
    // a harmless stand-in for a credential: on the CLI's scrub list, and safe to send with requests
    process.env.ANTHROPIC_CUSTOM_HEADERS = 'X-Orchestrate-Live-Test: 1';
    const probe = `node -e "console.log(process.env.ANTHROPIC_CUSTOM_HEADERS ? 'VISIBLE' : 'HIDDEN')"`;
    const signals: AgentSignal[] = [];
    try {
      const result = await new SdkRunner().run({
        agentId: 'core-dev',
        runtime: AgentRuntime.parse({ model: process.env.ORCH_LIVE_MODEL ?? 'claude-opus-5-5', effort: 'low', maxTurns: 8, maxBudgetUsd: 0.5, timeoutMs: 180_000 }),
        cwd: fx!.repo,
        systemPrompt: 'You are a test agent. Follow the user instructions exactly and briefly.',
        prompt: [`1. Run this Bash command exactly: ${probe}`, '2. Call mcp__orch__report_progress with summary set to exactly the word it printed.', '3. Call mcp__orch__submit_work with summary "done".'].join('\n'),
        tools: ['Bash'],
        guard: { root: fx!.repo, write: [], read: ['**'], protected: [], bash: [commandPattern(probe)] },
        onSignal: (s) => signals.push(s),
      });
      console.log(JSON.stringify({ outcome: result.outcome, cost: result.costUsd, error: result.error, progress: signals.filter((s) => s.kind === 'progress') }));
      expect(result.initTools).toContain('mcp__orch__submit_work');
      expect(result.outcome).toBe('submitted');
      expect(signals.some((s) => s.kind === 'progress' && s.summary === 'HIDDEN')).toBe(true);
    } finally {
      for (const [k, v] of [['ENABLE_TOOL_SEARCH', saved.search], ['ANTHROPIC_CUSTOM_HEADERS', saved.headers]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }, 240_000);
});
