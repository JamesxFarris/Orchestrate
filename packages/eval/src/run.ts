import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Org, Orchestrator, Store, totalTokens, type AgentResult, type AgentRunner, type TokenUsage } from '@orchestrate/core';
import type { OrchestrateEvent, RunState } from '@orchestrate/shared';
import { inspect, type Quality } from './inspect.ts';
import type { Scenario } from './scenario.ts';
import type { SoloRunner } from './solo.ts';
import { evalTeam } from './team.ts';

/** Who did the work: the Orchestrate team, or one plain Claude Code session (the baseline). */
export type Arm = 'orchestrate' | 'solo';

/** One scenario run, scored. Field names are what the scorecard and comparisons use. */
export interface ScenarioResult {
  scenario: string;
  /** Absent in reports saved before the solo baseline existed: those are all 'orchestrate'. */
  arm?: Arm;
  /** The run reached "completed" (some work merged). */
  completed: boolean;
  status: RunState['status'];
  /** Hidden judge tests on the run's final code: the ground truth. */
  judge: { passed: number; total: number };
  /** Every judge test passed. */
  correct: boolean;
  tasks: { total: number; merged: number; firstTry: number; escalated: number; failed: number };
  /** Attempts beyond the first, over all tasks. */
  retries: number;
  /** Gate name -> how many times it failed. */
  gateFailures: Record<string, number>;
  /** Tool calls the scope guard refused. */
  denials: number;
  /** The plan stopped for a person (unreadable verdict or concerns left), so it was not hands-off. */
  neededHuman: boolean;
  costUsd: number;
  seconds: number;
  /** Why a run did not complete, when it did not. */
  detail?: string;
  /** Beyond correctness: regressions, scope, size of the change, tests left behind. Absent in older reports. */
  quality?: Quality;
  /** Context and tokens over every agent session of the run. Absent in older reports. */
  context?: ContextUse;
  /** Tool calls the guard (or, for the solo arm, the folder check) refused, by tool name. */
  deniedTools?: Record<string, number>;
  /** The refused calls themselves ("Bash npm test", "Read src/x.js"), the first MAX_DENIED_CALLS of them. */
  deniedCalls?: string[];
}

/** Enough refused calls to see the pattern without bloating a report. */
export const MAX_DENIED_CALLS = 50;

/**
 * How much context the work took. `peak` is the largest prompt any single model request carried:
 * the number Orchestrate means to keep small by giving each agent a fresh, focused session.
 */
export interface ContextUse {
  sessions: number;
  peak: number;
  tokens: TokenUsage;
  /** Every token read or written over all sessions. */
  total: number;
}

const NO_TOKENS: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function contextUse(sessions: { tokens?: TokenUsage; peakContext?: number }[]): ContextUse {
  const tokens = sessions.reduce<TokenUsage>((a, s) => {
    const t = s.tokens ?? NO_TOKENS;
    return { input: a.input + t.input, output: a.output + t.output, cacheRead: a.cacheRead + t.cacheRead, cacheWrite: a.cacheWrite + t.cacheWrite };
  }, NO_TOKENS);
  return { sessions: sessions.length, peak: Math.max(0, ...sessions.map((s) => s.peakContext ?? 0)), tokens, total: totalTokens(tokens) };
}

/** The tool a refusal names: refusals are logged as "<Tool> <target> — <reason>". */
const toolOf = (text: string) => text.split(/\s/, 1)[0] || 'unknown';

/** The call a refusal names, without the guard's reason. */
const callOf = (text: string) => text.split(' — ', 1)[0]!;

/** Wraps the team's runner to keep every session's result and every refused tool call. */
function recorder(inner: AgentRunner) {
  const sessions: AgentResult[] = [];
  const deniedTools: Record<string, number> = {};
  const deniedCalls: string[] = [];
  const runner: AgentRunner = {
    run: async (inv) => {
      const r = await inner.run({
        ...inv,
        onSignal: (sig) => {
          if (sig.kind === 'log' && sig.level === 'denied') {
            deniedTools[toolOf(sig.text)] = (deniedTools[toolOf(sig.text)] ?? 0) + 1;
            if (deniedCalls.length < MAX_DENIED_CALLS) deniedCalls.push(callOf(sig.text));
          }
          inv.onSignal(sig);
        },
      });
      sessions.push(r);
      return r;
    },
  };
  return { runner, sessions, deniedTools, deniedCalls };
}

const GIT = ['-c', 'user.name=eval', '-c', 'user.email=eval@orchestrate.local', '-c', 'core.autocrlf=false'];
const git = (cwd: string, ...args: string[]) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A fresh copy of the scenario's starting project, committed on main. */
function startRepo(scenario: Scenario, root: string): string {
  const repo = path.join(root, 'repo');
  cpSync(path.join(scenario.dir, 'repo'), repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'start');
  return repo;
}

/** Run the hidden judge tests against the code a run produced (its integration branch). */
export function judge(scenario: Scenario, repo: string, run: RunState): { passed: number; total: number } {
  return judgeRef(scenario, repo, run.integrationHead ?? run.integrationBranch);
}

/** Run the hidden judge tests against the code at `ref` in `repo`. */
export function judgeRef(scenario: Scenario, repo: string, ref: string | undefined): { passed: number; total: number } {
  const hidden = readdirSync(path.join(scenario.dir, 'hidden'));
  const total = countTests(scenario);
  if (!ref) return { passed: 0, total };
  const dir = path.join(path.dirname(repo), 'judge');
  try {
    git(repo, 'worktree', 'add', '-q', '--detach', dir, ref);
    const judgeDir = path.join(dir, 'test', '__judge__');
    mkdirSync(judgeDir, { recursive: true });
    for (const f of hidden) cpSync(path.join(scenario.dir, 'hidden', f), path.join(judgeDir, f));
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...hidden.map((f) => `test/__judge__/${f}`)], { cwd: dir, encoding: 'utf8', timeout: 120_000 });
    const passed = Number(/^# pass (\d+)/m.exec(r.stdout ?? '')?.[1] ?? 0);
    return { passed, total };
  } catch {
    return { passed: 0, total };
  } finally {
    try {
      git(repo, 'worktree', 'remove', '--force', dir);
    } catch {
      /* already gone */
    }
  }
}

/** How many judge tests a scenario has (each `test(` in its hidden files). */
function countTests(scenario: Scenario): number {
  const dir = path.join(scenario.dir, 'hidden');
  return readdirSync(dir).reduce((n, f) => n + (readFileSync(path.join(dir, f), 'utf8').match(/^test\(/gm) ?? []).length, 0);
}

export interface RunOptions {
  runner: AgentRunner;
  model: string;
  /** Use the budget preset's per-job models and limits. */
  budget?: boolean;
  /** Keep the scenario's temp folder (repo, worktrees) for inspection. */
  keep?: boolean;
}

/** Run one scenario end to end: plan, review, build, merge, then judge and score. */
export async function runScenario(scenario: Scenario, opts: RunOptions): Promise<ScenarioResult> {
  const root = mkdtempSync(path.join(os.tmpdir(), `orch-eval-${scenario.id}-`));
  const repo = startRepo(scenario, root);
  const start = git(repo, 'rev-parse', 'HEAD');
  const recorded = recorder(opts.runner);
  const store = new Store(':memory:');
  const orch = new Orchestrator({ org: Org.fromConfig(evalTeam(opts.model, opts.budget, scenario.team)), runner: recorded.runner, repoRoot: repo, workDir: path.join(root, 'work'), store });
  const events: OrchestrateEvent[] = [];
  orch.bus.on((e) => events.push(e));

  const started = Date.now();
  const { id } = orch.submit(scenario.request, { autoApprove: true });
  // Hands-off: a plan that stops for a person anyway is approved here, but marked against the harness.
  let neededHuman = false;
  const watch = setInterval(() => {
    if (orch.get(id)?.status === 'awaiting_approval') {
      neededHuman = true;
      orch.approve(id);
    }
  }, 200);
  const run = await orch.wait(id).finally(() => clearInterval(watch));
  const seconds = Math.round((Date.now() - started) / 1000);

  const verdict = judge(scenario, repo, run);
  const quality = inspect(scenario, repo, start, run.integrationHead ?? run.integrationBranch);
  store.close();
  if (!opts.keep) rmSync(root, { recursive: true, force: true });

  const gateFailures: Record<string, number> = {};
  for (const e of events) if (e.type === 'gate.result' && !e.ok) gateFailures[e.gate] = (gateFailures[e.gate] ?? 0) + 1;
  const tasks = run.tasks;
  return {
    scenario: scenario.id,
    arm: 'orchestrate',
    completed: run.status === 'completed',
    status: run.status,
    judge: verdict,
    correct: verdict.total > 0 && verdict.passed === verdict.total,
    tasks: {
      total: tasks.length,
      merged: tasks.filter((t) => t.status === 'merged').length,
      firstTry: tasks.filter((t) => t.status === 'merged' && t.attempts <= 1).length,
      escalated: tasks.filter((t) => t.status === 'escalated').length,
      failed: tasks.filter((t) => t.status === 'failed').length,
    },
    retries: tasks.reduce((n, t) => n + Math.max(0, t.attempts - 1), 0),
    gateFailures,
    denials: events.filter((e) => e.type === 'agent.log' && e.kind === 'denied').length,
    neededHuman,
    costUsd: Math.round(run.costUsd * 100) / 100,
    seconds,
    ...(run.status === 'completed' ? {} : { detail: run.detail }),
    quality,
    context: contextUse(recorded.sessions),
    deniedTools: recorded.deniedTools,
    deniedCalls: recorded.deniedCalls,
  };
}

export interface SoloOptions {
  runner: SoloRunner;
  model: string;
  keep?: boolean;
}

/**
 * The baseline: one plain Claude Code session does the same request in a fresh copy of the same
 * repo, its changes are committed as they stand, and the same hidden judge tests score it. The
 * prompt is the request plus the project description the team is given, nothing more.
 */
export async function runSolo(scenario: Scenario, opts: SoloOptions): Promise<ScenarioResult> {
  const root = mkdtempSync(path.join(os.tmpdir(), `orch-eval-solo-${scenario.id}-`));
  const repo = startRepo(scenario, root);
  const start = git(repo, 'rev-parse', 'HEAD');
  const prompt = `${scenario.request}

${evalTeam(opts.model).project.description}`;

  const started = Date.now();
  const outcome = await opts.runner({ scenario, repo, model: opts.model, prompt });
  const seconds = Math.round((Date.now() - started) / 1000);

  git(repo, 'add', '-A');
  if (git(repo, 'status', '--porcelain')) git(repo, 'commit', '-q', '-m', 'solo session');
  const verdict = judgeRef(scenario, repo, 'HEAD');
  const quality = inspect(scenario, repo, start, 'HEAD');
  if (!opts.keep) rmSync(root, { recursive: true, force: true });

  return {
    scenario: scenario.id,
    arm: 'solo',
    completed: outcome.ok,
    status: outcome.ok ? 'completed' : 'failed',
    judge: verdict,
    correct: verdict.total > 0 && verdict.passed === verdict.total,
    // a solo session has no plan: one "task", the whole request
    tasks: { total: 1, merged: outcome.ok ? 1 : 0, firstTry: outcome.ok ? 1 : 0, escalated: 0, failed: outcome.ok ? 0 : 1 },
    retries: 0,
    gateFailures: {},
    denials: Object.values(outcome.deniedTools ?? {}).reduce((n, c) => n + c, 0),
    neededHuman: false,
    costUsd: Math.round(outcome.costUsd * 100) / 100,
    seconds,
    ...(outcome.ok ? {} : { detail: outcome.detail }),
    quality,
    context: contextUse([outcome]),
    deniedTools: outcome.deniedTools ?? {},
  };
}
