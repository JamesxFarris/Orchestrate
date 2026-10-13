import path from 'node:path';
import type { AgentActivity, GateConfig, GateName, RoleConfig, RunState, TaskState, TaskStatus } from '@orchestrate/shared';
import type { EventBus } from '../events/bus.ts';
import { runCommand, type CommandResult } from '../gates/gates.ts';
import * as g from '../git/git.ts';
import type { Org } from '../org/org.ts';
import type { ScopeGuardConfig } from '../scope/scopeGuard.ts';
import type { AgentResult, AgentRunner } from '../runner/types.ts';

export class CancelledError extends Error {
  constructor() {
    super('run cancelled');
  }
}

export interface AgentCall {
  role: RoleConfig;
  activity: AgentActivity;
  task?: TaskState;
  cwd: string;
  system: string;
  prompt: string;
  tools: string[];
  guard: Omit<ScopeGuardConfig, 'root'>;
  schema?: Record<string, unknown>;
  /** Initial line on the building's card before the agent reports progress. */
  headline: string;
}

/** Serialises merges into the run's integration branch and verifies each one. */
export class Integration {
  readonly branch: string;
  readonly worktree: g.Worktree;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly repoRoot: string,
    runId: string,
    workDir: string,
    private readonly links: readonly string[],
  ) {
    this.branch = `orch/run-${runId}`;
    this.worktree = { dir: path.join(workDir, runId, '_integration'), branch: this.branch };
  }

  async init(baseRef: string, gates: GateConfig, signal: AbortSignal): Promise<void> {
    const base = await g.revParse(this.repoRoot, baseRef);
    await g.addWorktree(this.repoRoot, this.worktree.dir, this.branch, base, this.links);
    if (gates.setup) {
      const r = await runCommand(gates.setup, this.worktree.dir, gates.timeoutMs, signal);
      if (!r.ok) throw new Error(`setup failed in integration worktree:\n${r.output}`);
    }
  }

  head(): Promise<string> {
    return g.head(this.worktree.dir);
  }

  /** Merge a task branch, run the full suite, and roll back on failure. */
  mergeVerified(
    taskBranch: string,
    message: string,
    verify: ((dir: string) => Promise<CommandResult>) | undefined,
  ): Promise<{ ok: true } | { ok: false; reason: 'conflict' | 'regression'; output: string }> {
    const job = this.lock.then(async () => {
      const before = await this.head();
      const merged = await g.merge(this.worktree.dir, taskBranch, message);
      if (!merged.ok) return { ok: false as const, reason: 'conflict' as const, output: merged.output };
      if (verify) {
        const r = await verify(this.worktree.dir);
        if (!r.ok) {
          await g.resetHard(this.worktree.dir, before);
          return { ok: false as const, reason: 'regression' as const, output: r.output };
        }
      }
      return { ok: true as const };
    });
    this.lock = job.catch(() => undefined);
    return job;
  }

  dispose(): Promise<void> {
    return g.removeWorktree(this.repoRoot, this.worktree, this.links);
  }
}

export interface RunContextDeps {
  org: Org;
  runner: AgentRunner;
  bus: EventBus;
  repoRoot: string;
  workDir: string;
  save: (run: RunState) => void;
}

/** Everything a run's pipeline stages share. */
export class RunContext {
  readonly org: Org;
  readonly runner: AgentRunner;
  readonly bus: EventBus;
  readonly repoRoot: string;
  readonly workDir: string;
  integration?: Integration;

  constructor(
    deps: RunContextDeps,
    readonly run: RunState,
    readonly signal: AbortSignal,
  ) {
    this.org = deps.org;
    this.runner = deps.runner;
    this.bus = deps.bus;
    this.repoRoot = deps.repoRoot;
    this.workDir = deps.workDir;
    this.persist = () => deps.save(run);
  }

  readonly persist: () => void;

  throwIfCancelled(): void {
    if (this.signal.aborted) throw new CancelledError();
  }

  setTaskStatus(task: TaskState, status: TaskStatus, detail?: string): void {
    task.status = status;
    task.detail = detail;
    this.bus.emit({ type: 'task.status', runId: this.run.id, taskId: task.contract.id, status, detail });
    this.persist();
  }

  activity(agentId: string, activity: AgentActivity, task?: TaskState, summary?: string): void {
    this.bus.emit({
      type: 'agent.activity',
      runId: this.run.id,
      agentId,
      activity,
      taskId: task?.contract.id,
      taskTitle: task?.contract.title,
      summary,
    });
  }

  gate(task: TaskState, gate: GateName, ok: boolean, output: string): void {
    this.bus.emit({ type: 'gate.result', runId: this.run.id, taskId: task.contract.id, gate, ok, output: output.slice(-4000) });
  }

  handoff(task: TaskState, from: string, to: string, reason: string): void {
    this.bus.emit({ type: 'handoff', runId: this.run.id, taskId: task.contract.id, from, to, reason });
  }

  async callAgent(c: AgentCall): Promise<AgentResult> {
    this.throwIfCancelled();
    const runId = this.run.id;
    const taskId = c.task?.contract.id;
    this.activity(c.role.id, c.activity, c.task, c.headline);
    try {
      const result = await this.runner.run({
        agentId: c.role.id,
        taskId,
        runtime: this.org.runtimeFor(c.role),
        cwd: c.cwd,
        systemPrompt: c.system,
        prompt: c.prompt,
        tools: c.tools,
        guard: { ...c.guard, root: c.cwd, externalRead: this.org.externalReferenceDirs() },
        outputSchema: c.schema,
        signal: this.signal,
        onSignal: (s) => {
          if (s.kind === 'progress') this.bus.emit({ type: 'agent.progress', runId, agentId: c.role.id, taskId, summary: s.summary });
          else if (s.kind === 'log') this.bus.emit({ type: 'agent.log', runId, agentId: c.role.id, taskId, kind: s.level, text: s.text });
          else {
            this.run.costUsd += s.usd;
            this.bus.emit({ type: 'agent.cost', runId, agentId: c.role.id, taskId, usd: s.usd });
          }
        },
      });
      if (result.outcome === 'cancelled') throw new CancelledError();
      this.throwIfCancelled();
      return result;
    } finally {
      this.activity(c.role.id, 'idle');
      this.persist();
    }
  }
}
