import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Org, Orchestrator, Store, type AgentRunner } from '@orchestrate/core';
import type { OrchestrateEvent, RunState } from '@orchestrate/shared';
import type { Scenario } from './scenario.ts';
import { evalTeam } from './team.ts';

/** One scenario run, scored. Field names are what the scorecard and comparisons use. */
export interface ScenarioResult {
  scenario: string;
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
  const hidden = readdirSync(path.join(scenario.dir, 'hidden'));
  const total = countTests(scenario);
  const ref = run.integrationHead ?? run.integrationBranch;
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
  /** Keep the scenario's temp folder (repo, worktrees) for inspection. */
  keep?: boolean;
}

/** Run one scenario end to end: plan, review, build, merge, then judge and score. */
export async function runScenario(scenario: Scenario, opts: RunOptions): Promise<ScenarioResult> {
  const root = mkdtempSync(path.join(os.tmpdir(), `orch-eval-${scenario.id}-`));
  const repo = startRepo(scenario, root);
  const store = new Store(':memory:');
  const orch = new Orchestrator({ org: Org.fromConfig(evalTeam(opts.model)), runner: opts.runner, repoRoot: repo, workDir: path.join(root, 'work'), store });
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
  store.close();
  if (!opts.keep) rmSync(root, { recursive: true, force: true });

  const gateFailures: Record<string, number> = {};
  for (const e of events) if (e.type === 'gate.result' && !e.ok) gateFailures[e.gate] = (gateFailures[e.gate] ?? 0) + 1;
  const tasks = run.tasks;
  return {
    scenario: scenario.id,
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
  };
}
