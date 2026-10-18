import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { filesIn, type Scenario } from './scenario.ts';

/**
 * The baseline Orchestrate is measured against: one plain Claude Code session given the same
 * request in the same starting repo, with no planning, no QA, no gates and no review. It answers
 * "would Claude on its own have done as well?".
 */
export interface SoloSession {
  scenario: Scenario;
  /** The scenario's fresh repo; the session works here and nowhere else. */
  repo: string;
  model: string;
  /** What the session is asked: the request plus the same project description the team gets. */
  prompt: string;
}

export interface SoloOutcome {
  ok: boolean;
  costUsd: number;
  turns: number;
  detail?: string;
}

export type SoloRunner = (s: SoloSession) => Promise<SoloOutcome>;

/** Turns and dollars one solo session may use: roughly what the team spends on a whole run. */
const SOLO_MAX_TURNS = 60;
const SOLO_MAX_BUDGET_USD = 3;

const insideRepo = (repo: string, p: unknown) => {
  if (typeof p !== 'string') return true; // tools without a path (Bash, Grep with no path) run in cwd
  const rel = path.relative(repo, path.resolve(repo, p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * A real Claude Code session through the Agent SDK. Kept close to plain Claude Code, but on the
 * same footing as the team: no user or project settings (`settingSources: []`), web tools off
 * (the team has none), credentials scrubbed from the commands it runs, and file tools confined to
 * the scenario repo.
 */
export const sdkSolo: SoloRunner = async ({ repo, model, prompt }) => {
  const outcome: SoloOutcome = { ok: false, costUsd: 0, turns: 0 };
  try {
    const session = query({
      prompt,
      options: {
        cwd: repo,
        model,
        maxTurns: SOLO_MAX_TURNS,
        maxBudgetUsd: SOLO_MAX_BUDGET_USD,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        disallowedTools: ['WebFetch', 'WebSearch'],
        permissionMode: 'acceptEdits',
        canUseTool: async (_tool, input) => {
          const p = (input as Record<string, unknown>).file_path ?? (input as Record<string, unknown>).path ?? (input as Record<string, unknown>).notebook_path;
          return insideRepo(repo, p) ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'Stay inside the project folder.' };
        },
        settingSources: [],
        persistSession: false,
        env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'orchestrate-eval/0.1.0', CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1' },
      },
    });
    for await (const msg of session as AsyncIterable<SDKMessage>) {
      if (msg.type !== 'result') continue;
      outcome.costUsd = msg.total_cost_usd;
      outcome.turns = msg.num_turns;
      outcome.ok = msg.subtype === 'success' && !msg.is_error;
      if (!outcome.ok) outcome.detail = msg.subtype === 'success' ? msg.result.slice(0, 300) : msg.subtype;
    }
  } catch (err) {
    outcome.detail = String(err).slice(0, 300);
  }
  return outcome;
};

/**
 * A solo session that writes the reference solution, for free. It must score perfectly, which
 * checks the solo path and the judging before a real session is paid for.
 */
export function scriptedSolo(): SoloRunner {
  return async ({ scenario, repo }) => {
    const solutionDir = path.join(scenario.dir, 'solution');
    for (const file of filesIn(solutionDir)) {
      const to = path.join(repo, file);
      mkdirSync(path.dirname(to), { recursive: true });
      writeFileSync(to, readFileSync(path.join(solutionDir, file), 'utf8'));
    }
    return { ok: true, costUsd: 0, turns: 0 };
  };
}
