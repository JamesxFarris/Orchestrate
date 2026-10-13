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
    expect(result.outcome).toBe('submitted');
    expect(readFileSync(path.join(fx!.repo, 'src', 'sum.js'), 'utf8')).toContain('a + b');
    expect(existsSync(path.join(fx!.repo, 'src', 'other.js'))).toBe(false);
    expect(result.denials).toBeGreaterThanOrEqual(1);
    expect(signals.some((s) => s.kind === 'progress' && s.summary === 'starting')).toBe(true);
    expect(signals.some((s) => s.kind === 'log' && s.level === 'denied')).toBe(true);
    expect(result.costUsd).toBeGreaterThan(0);
  }, 240_000);
});
