import { randomBytes } from 'node:crypto';
import { rmdirSync } from 'node:fs';
import path from 'node:path';
import { CircleReview, Plan, roleName, RunSummary, type OrchestrateEvent, type ProgressSnapshot, type RoleConfig, type RunState, type RunStatus, type ShipMethod, type TaskState } from '@orchestrate/shared';
import { EventBus } from './events/bus.ts';
import * as g from './git/git.ts';
import type { Org } from './org/org.ts';
import { schedule } from './plan/dag.ts';
import { validatePlan } from './plan/validatePlan.ts';
import { CancelledError, Integration, RunContext } from './pipeline/context.ts';
import { executeTask } from './pipeline/taskPipeline.ts';
import {
  circleReviewPrompt,
  circleReviewSystem,
  masterPlanningPrompt,
  masterPlanningSystem,
  masterSummarySystem,
} from './prompts.ts';
import { outputSchema, parseStructured } from './runner/structured.ts';
import { computeProgress, finishedAt } from './progress/progress.ts';
import { READ_TOOLS, type AgentRunner } from './runner/types.ts';
import { detectShipped, shipRun, type ShipResult } from './ship/ship.ts';
import type { ShipRecord, Store } from './store/store.ts';

const FINISHED = new Set<RunStatus>(['completed', 'failed', 'cancelled']);
/** The only events progress reads: what each task cost, its escalations, and when the run ended. */
const PROGRESS_EVENT_TYPES: OrchestrateEvent['type'][] = ['agent.cost', 'escalation', 'run.status'];
const TASK_FINISHED = new Set<TaskState['status']>(['merged', 'failed', 'escalated', 'skipped']);

export interface OrchestratorOptions {
  org: Org;
  runner: AgentRunner;
  /** Absolute path of the target repository's main checkout. Never written to except via git branches. */
  repoRoot: string;
  /** Where worktrees live. Defaults to <repoRoot>/../.orchestrate-work/<repo name>. */
  workDir?: string;
  store?: Store;
  bus?: EventBus;
}

export interface SubmitOptions {
  /** Skip the human approval gate for this run. */
  autoApprove?: boolean;
  /** Branch or commit to build on. Defaults to project.defaultBranch. */
  baseRef?: string;
}

const READ_ONLY = { write: [], read: ['**'], protected: [], bash: [] };

export class Orchestrator {
  readonly bus: EventBus;
  readonly org: Org;
  private readonly runner: AgentRunner;
  private readonly repoRoot: string;
  private readonly workDir: string;
  private readonly store?: Store;
  private readonly runs = new Map<string, RunState>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly approvals = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
  private readonly done = new Map<string, Promise<RunState>>();
  private readonly ships = new Map<string, ShipRecord>();
  /** Progress events of finished runs, which never change (see progress()). */
  private readonly progressEvents = new Map<string, OrchestrateEvent[]>();
  /** Ships and ship detection run one at a time, so a run is never recorded twice. */
  private shipLock: Promise<unknown> = Promise.resolve();
  private lastTargetHead?: string;

  constructor(opts: OrchestratorOptions) {
    this.org = opts.org;
    this.runner = opts.runner;
    this.repoRoot = path.resolve(opts.repoRoot);
    this.workDir = path.resolve(opts.workDir ?? path.join(this.repoRoot, '..', '.orchestrate-work', path.basename(this.repoRoot)));
    this.store = opts.store;
    this.bus = opts.bus ?? new EventBus();
    if (this.store) {
      const store = this.store;
      this.bus.on((e) => store.appendEvent(e));
      for (const s of store.ships()) this.ships.set(s.runId, s);
    }
  }

  // ---------------------------------------------------------------- shipping & progression

  /**
   * Ship it: merge a completed run into the default branch. Safety rules live in ship/ship.ts.
   * A run where some tasks did not finish is still "completed", so shipping it needs `partial`:
   * whoever ships has to have seen that only part of the feature is there.
   */
  ship(runId: string, opts: { partial?: boolean } = {}): Promise<ShipResult> {
    return this.serialShip(async () => {
      const done = this.ships.get(runId);
      if (done) return { ok: true, sha: done.sha, alreadyShipped: true, tested: false };
      const run = this.get(runId);
      if (!run || run.status !== 'completed' || !run.integrationBranch) return { ok: false, reason: 'not-ready', message: 'Only a completed project can ship.' };
      const unfinished = run.tasks.filter((t) => t.status !== 'merged');
      if (unfinished.length && !opts.partial) {
        const finished = run.tasks.length - unfinished.length;
        return {
          ok: false,
          reason: 'incomplete',
          message: `Only ${finished} of ${run.tasks.length} tasks finished (not: ${unfinished.map((t) => t.contract.title).join('; ')}). Confirm a partial ship to ship just the finished work.`,
        };
      }
      const res = await shipRun({
        repoRoot: this.repoRoot,
        runId,
        branch: run.integrationBranch,
        target: this.org.project.defaultBranch,
        workDir: this.workDir,
        links: this.org.project.linkDirs,
        fullGate: this.org.gates.full ?? this.org.gates.test, // GateConfig: full defaults to test
        timeoutMs: this.org.gates.timeoutMs,
        message: `Ship ${run.integrationBranch}: ${run.prompt.split('\n')[0]!.slice(0, 72)}`,
      });
      if (res.ok) this.recordShip(runId, res.sha, res.alreadyShipped ? 'detected' : 'merged');
      return res;
    });
  }

  /** For merges detection cannot see (squash, rebase): the human says it shipped. */
  markShipped(runId: string): Promise<boolean> {
    return this.serialShip(async () => {
      const run = this.get(runId);
      if (!run || run.status !== 'completed' || this.ships.has(runId)) return false;
      this.recordShip(runId, await g.revParse(this.repoRoot, this.org.project.defaultBranch), 'marked');
      return true;
    });
  }

  /** Fallback for runs merged outside Orchestrate. Costs one rev-parse unless the target moved. */
  checkShipped(): Promise<string[]> {
    return this.serialShip(async () => {
      const target = this.org.project.defaultBranch;
      const now = await g.revParse(this.repoRoot, target).catch(() => undefined);
      if (!now || now === this.lastTargetHead) return [];
      this.lastTargetHead = now;
      const candidates = this.allRuns()
        .filter((r) => r.status === 'completed' && r.integrationHead && !this.ships.has(r.id))
        .map((r) => ({ runId: r.id, head: r.integrationHead! }));
      const found = await detectShipped(this.repoRoot, target, candidates);
      for (const id of found) this.recordShip(id, now, 'detected');
      return found;
    });
  }

  /** Check now, then every `intervalMs`. Returns a stop function. */
  watchShips(intervalMs = 60_000): () => void {
    const tick = () => void this.checkShipped().catch((err) => console.error('[ship detection]', err));
    tick();
    const timer = setInterval(tick, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  /** Districts' growth, settlements and streaks, derived from stored runs, events and ships. */
  progress(): ProgressSnapshot {
    const facts = this.allRuns().map((run) => {
      // Progress reads only costs, escalations and the final status. A finished run's are settled,
      // so they are read once; this runs on every task change, for every run ever.
      let events = this.progressEvents.get(run.id);
      if (!events) {
        events = this.store?.events(run.id, PROGRESS_EVENT_TYPES) ?? [];
        if (FINISHED.has(run.status)) this.progressEvents.set(run.id, events);
      }
      return { run, events, finishedAt: finishedAt(events), shippedAt: this.ships.get(run.id)?.at };
    });
    return computeProgress(facts, this.org.squads.map((s) => s.id), (squad, kind) => this.org.implementerBudget(squad, kind));
  }

  private recordShip(runId: string, sha: string, method: ShipMethod): void {
    if (this.ships.has(runId)) return;
    const record: ShipRecord = { runId, sha, at: Date.now(), method };
    this.ships.set(runId, record);
    this.store?.recordShip(record);
    this.bus.emit({ type: 'run.shipped', runId, sha, method });
  }

  private serialShip<T>(job: () => Promise<T>): Promise<T> {
    const next = this.shipLock.then(job);
    this.shipLock = next.catch(() => undefined);
    return next;
  }

  private allRuns(): RunState[] {
    const live = [...this.runs.values()];
    const stored = this.store?.listRuns(Number.MAX_SAFE_INTEGER) ?? [];
    const ids = new Set(live.map((r) => r.id));
    return [...live, ...stored.filter((r) => !ids.has(r.id))];
  }

  submit(prompt: string, opts: SubmitOptions = {}): RunState {
    const id = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex')}`;
    const run: RunState = { id, prompt, status: 'planning', createdAt: Date.now(), tasks: [], costUsd: 0 };
    this.runs.set(id, run);
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.save(run);
    this.bus.emit({ type: 'run.created', runId: id, prompt });
    this.done.set(id, this.execute(run, controller.signal, opts));
    return run;
  }

  /** Resolves when the run reaches a terminal state. */
  wait(runId: string): Promise<RunState> {
    const p = this.done.get(runId);
    if (!p) throw new Error(`unknown run ${runId}`);
    return p;
  }

  approve(runId: string): boolean {
    const a = this.approvals.get(runId);
    if (!a) return false;
    this.approvals.delete(runId);
    a.resolve();
    return true;
  }

  cancel(runId: string, reason = 'cancelled by user'): boolean {
    const c = this.controllers.get(runId);
    if (!c || c.signal.aborted) return false;
    c.abort(new Error(reason));
    this.approvals.get(runId)?.reject(new CancelledError());
    this.approvals.delete(runId);
    return true;
  }

  /**
   * Cancel every active run and wait (up to `timeoutMs`) until each has recorded its status and
   * removed its worktrees. Without the wait, a stop left runs "executing" forever and worktrees on disk.
   */
  async shutdown(timeoutMs = 20_000): Promise<void> {
    const active = [...this.controllers.keys()];
    for (const id of active) this.cancel(id, 'the daemon is shutting down');
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<void>((r) => (timer = setTimeout(r, timeoutMs)));
    await Promise.race([Promise.allSettled(active.map((id) => this.wait(id))), limit]);
    clearTimeout(timer);
  }

  /**
   * After a restart, runs the store still shows as going have nothing behind them: approvals and
   * cancellation live in memory, so they could never finish, be approved or be cancelled. Mark them
   * failed and remove their worktrees and task branches (the integration branch is kept, in case it
   * holds work). Call once at startup, before taking requests. Returns the recovered run ids.
   */
  async recoverInterrupted(): Promise<string[]> {
    const recovered: string[] = [];
    for (const run of this.store?.listRuns(Number.MAX_SAFE_INTEGER) ?? []) {
      if (FINISHED.has(run.status) || this.controllers.has(run.id)) continue;
      const was = run.status.replace('_', ' ');
      for (const t of run.tasks) if (!TASK_FINISHED.has(t.status)) t.status = 'skipped';
      this.setStatus(run, 'failed', `The daemon stopped while this run was ${was}. Submit it again to retry.`);
      await this.removeRunWorktrees(run.id).catch((e) => console.error(`[run ${run.id}] could not remove worktrees:`, e));
      await this.cleanupBranches(run.id).catch(() => undefined);
      recovered.push(run.id);
    }
    return recovered;
  }

  /** Remove the git worktrees a run left under its work folder, never deleting through linked dirs. */
  private async removeRunWorktrees(runId: string): Promise<void> {
    const runDir = path.join(this.workDir, runId);
    const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
    const out = await g.git(this.repoRoot, ['worktree', 'list', '--porcelain']);
    for (const block of out.split(/\n\s*\n/)) {
      const dir = /^worktree (.+)$/m.exec(block)?.[1];
      if (!dir) continue;
      const abs = path.resolve(dir);
      if (!same(path.dirname(abs), runDir)) continue;
      const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? '';
      await g.removeWorktree(this.repoRoot, { dir: abs, branch }, this.org.project.linkDirs);
    }
    await g.git(this.repoRoot, ['worktree', 'prune']).catch(() => undefined);
    try {
      rmdirSync(runDir); // only if empty: anything left is not ours to delete blindly
    } catch {
      // not empty or already gone
    }
  }

  get(runId: string): RunState | undefined {
    return this.runs.get(runId) ?? this.store?.getRun(runId);
  }

  list(): RunState[] {
    const live = [...this.runs.values()];
    const stored = this.store?.listRuns() ?? [];
    const ids = new Set(live.map((r) => r.id));
    return [...live, ...stored.filter((r) => !ids.has(r.id))].sort((a, b) => b.createdAt - a.createdAt);
  }

  private save(run: RunState): void {
    this.store?.saveRun(run);
  }

  private setStatus(run: RunState, status: RunStatus, detail?: string): void {
    run.status = status;
    run.detail = detail;
    this.save(run);
    this.bus.emit({ type: 'run.status', runId: run.id, status, detail });
  }

  private async execute(run: RunState, signal: AbortSignal, opts: SubmitOptions): Promise<RunState> {
    const ctx = new RunContext(
      { org: this.org, runner: this.runner, bus: this.bus, repoRoot: this.repoRoot, workDir: this.workDir, save: (r) => this.save(r) },
      run,
      signal,
    );
    try {
      const planned = await this.planWithCircle(ctx);
      if (!planned.plan) {
        this.setStatus(run, 'failed', planned.reason);
        return run;
      }
      const { plan, needsHuman } = planned;
      run.plan = plan;
      run.tasks = plan.tasks.map((contract) => ({ contract, status: 'pending', attempts: 0 }));
      this.save(run);

      // auto-approve skips the gate only for a plan the Tech Circle actually approved
      if (needsHuman || (this.org.policy.requireHumanApproval && !opts.autoApprove)) {
        this.setStatus(run, 'awaiting_approval', needsHuman);
        await new Promise<void>((resolve, reject) => this.approvals.set(run.id, { resolve, reject }));
      }

      ctx.throwIfCancelled();
      this.setStatus(run, 'executing');
      await this.executeTasks(ctx, opts.baseRef ?? this.org.project.defaultBranch);
      await this.summarise(ctx);
      const merged = run.tasks.filter((t) => t.status === 'merged').length;
      this.setStatus(run, merged > 0 ? 'completed' : 'failed', `${merged}/${run.tasks.length} tasks merged`);
    } catch (err) {
      if (err instanceof CancelledError || signal.aborted) {
        for (const t of run.tasks) if (!['merged', 'failed', 'escalated', 'skipped'].includes(t.status)) t.status = 'skipped';
        this.setStatus(run, 'cancelled', String(signal.reason ?? 'cancelled'));
      } else {
        console.error(`[run ${run.id}]`, err);
        this.setStatus(run, 'failed', err instanceof Error ? err.message : String(err));
      }
    } finally {
      for (const r of this.org.roles) ctx.activity(r.id, 'idle');
      this.approvals.delete(run.id);
      this.controllers.delete(run.id);
    }
    return run;
  }

  /**
   * Master drafts; deterministic validation and the Tech Circle push back; at most N revision rounds.
   * `needsHuman` says why a person must approve the plan even when the run is auto-approved: a
   * reviewer whose verdict could not be read, or concerns left after the last round.
   */
  private async planWithCircle(ctx: RunContext): Promise<{ plan: Plan; needsHuman?: string } | { plan?: undefined; reason: string }> {
    const { org, run } = ctx;
    const master = org.master();
    let previous: Plan | undefined;
    let feedback: string[] = [];
    let lastValid: Plan | undefined;
    let unread: string[] = [];

    for (let round = 0; round <= org.policy.circleRevisionRounds; round++) {
      this.setStatus(run, 'planning', round ? `revision ${round}` : undefined);
      const res = await ctx.callAgent({
        role: master,
        activity: 'working',
        cwd: this.repoRoot,
        system: masterPlanningSystem(org),
        prompt: masterPlanningPrompt(run.prompt, previous ? { previous, feedback } : undefined),
        tools: READ_TOOLS,
        guard: READ_ONLY,
        schema: outputSchema(Plan),
        headline: round ? `Revising the plan (round ${round})` : `Planning: ${run.prompt.slice(0, 100)}`,
      });
      const parsed = parseStructured(Plan, res);
      if (!parsed.ok) {
        feedback = [`Your answer was not a valid plan: ${parsed.error}`];
        continue;
      }
      const plan = parsed.value;
      previous = plan;
      const problems = validatePlan(plan, org);
      this.bus.emit({ type: 'plan.proposed', runId: run.id, plan, round, problems });
      if (problems.length) {
        feedback = problems;
        continue;
      }
      lastValid = plan;

      // -------------------------------------------------------------- Tech Circle
      const involved = new Set(plan.tasks.map((t) => t.squad));
      const reviewers = org.circle().filter((r) => r.kind !== 'master' && (!r.squad || involved.has(r.squad)));
      if (reviewers.length === 0) return { plan };
      this.setStatus(run, 'reviewing', `round ${round + 1}`);
      this.bus.emit({ type: 'circle.convened', runId: run.id, members: [master.id, ...reviewers.map((r) => r.id)] });
      const ask = async (role: RoleConfig, unreadable?: string) =>
        parseStructured(
          CircleReview,
          await ctx.callAgent({
            role,
            activity: 'reviewing',
            cwd: this.repoRoot,
            system: circleReviewSystem(org, role),
            prompt: unreadable
              ? `${circleReviewPrompt(run.prompt, plan)}

Your previous reply could not be read as a review (${unreadable}). Reply with only the structured verdict.`
              : circleReviewPrompt(run.prompt, plan),
            tools: READ_TOOLS,
            guard: READ_ONLY,
            schema: outputSchema(CircleReview),
            headline: 'Tech Circle: reviewing the plan',
          }),
        );
      unread = [];
      const reviews = await Promise.all(
        reviewers.map(async (role) => {
          let p = await ask(role);
          if (!p.ok) p = await ask(role, p.error);
          // Still unreadable: not an approval. It doesn't block the others, but a person must look.
          if (!p.ok) unread.push(`${roleName(role, org.squads)} (${p.error})`);
          const review: CircleReview = p.ok ? p.value : { verdict: 'revise', concerns: [`(review unreadable: ${p.error})`], requiredChanges: [] };
          this.bus.emit({ type: 'circle.review', runId: run.id, roleId: role.id, review });
          return { role, review };
        }),
      );
      const changes = reviews.flatMap(({ role, review }) =>
        review.verdict === 'revise' ? review.requiredChanges.map((c) => `[${roleName(role, org.squads)}] ${c}`) : [],
      );
      const approved = changes.length === 0 && unread.length === 0;
      this.bus.emit({ type: 'circle.adjourned', runId: run.id, approved });
      if (changes.length === 0) return unread.length ? { plan, needsHuman: `Unreviewed: the Tech Circle could not read the verdict of ${unread.join(', ')}.` } : { plan };
      feedback = changes;
    }

    if (lastValid) {
      // Out of rounds but structurally sound: a person decides, with the concerns in front of them.
      const unreviewed = unread.length ? ` Also unreviewed by ${unread.join(', ')}.` : '';
      return { plan: lastValid, needsHuman: `Tech Circle still had concerns after ${org.policy.circleRevisionRounds} revisions: ${feedback.join(' | ')}.${unreviewed}` };
    }
    return { reason: `no valid plan after ${org.policy.circleRevisionRounds + 1} attempts: ${feedback.join(' | ')}` };
  }

  private async executeTasks(ctx: RunContext, baseRef: string): Promise<void> {
    const { org, run } = ctx;
    const integration = new Integration(this.repoRoot, run.id, this.workDir, org.project.linkDirs);
    ctx.integration = integration;
    run.integrationBranch = integration.branch;

    const running = new Map<string, Promise<void>>();
    try {
      // inside the try, so a failed or cancelled setup still removes the integration worktree
      await integration.init(baseRef, org.gates, ctx.signal);
      for (;;) {
        ctx.throwIfCancelled();
        const { ready, blocked } = schedule(run.tasks, org.policy.maxParallel);
        for (const b of blocked) {
          const t = run.tasks.find((x) => x.contract.id === b.id)!;
          ctx.setTaskStatus(t, 'skipped', 'a dependency did not merge');
        }
        for (const contract of ready) {
          const t = run.tasks.find((x) => x.contract.id === contract.id)!;
          ctx.setTaskStatus(t, 'in_progress'); // reserve the slot before the async work starts
          const p = this.runTask(ctx, t).finally(() => running.delete(contract.id));
          running.set(contract.id, p);
        }
        if (running.size === 0) {
          if (blocked.length) continue; // newly skipped tasks may unblock evaluation of others
          break;
        }
        await Promise.race(running.values());
      }
    } finally {
      await Promise.allSettled(running.values());
      run.integrationHead = await integration.head().catch(() => undefined);
      this.save(run);
      await integration.dispose().catch(() => undefined);
    }
  }

  private async runTask(ctx: RunContext, task: TaskState): Promise<void> {
    try {
      await executeTask(ctx, task);
    } catch (err) {
      if (err instanceof CancelledError) throw err;
      console.error(`[task ${task.contract.id}]`, err);
      ctx.setTaskStatus(task, 'failed', err instanceof Error ? err.message.slice(0, 500) : String(err));
    }
  }

  private async summarise(ctx: RunContext): Promise<void> {
    const { org, run } = ctx;
    const outcomes = run.tasks.map((t) => `- ${t.contract.id} (${t.contract.squad}): ${t.status}${t.detail ? ` — ${t.detail}` : ''}`).join('\n');
    let summary: RunSummary = { summary: `Run finished.\n${outcomes}`, followUps: [] };
    try {
      const res = await ctx.callAgent({
        role: org.master(),
        activity: 'working',
        cwd: this.repoRoot,
        system: masterSummarySystem(org),
        prompt: `REQUEST\n${run.prompt}\n\nPLAN SUMMARY\n${run.plan?.summary}\n\nOUTCOMES\n${outcomes}\n\nIntegration branch: ${run.integrationBranch}`,
        tools: [],
        guard: READ_ONLY,
        schema: outputSchema(RunSummary),
        headline: 'Writing the run report',
      });
      const parsed = parseStructured(RunSummary, res);
      if (parsed.ok) summary = parsed.value;
    } catch (err) {
      if (err instanceof CancelledError) throw err;
    }
    run.summary = summary.summary;
    this.save(run);
    this.bus.emit({ type: 'run.summary', runId: run.id, summary: summary.summary, followUps: summary.followUps, branch: run.integrationBranch ?? '' });
  }

  /** Keep the integration branch, remove task branches. Called by tooling after a human merges. */
  async cleanupBranches(runId: string): Promise<void> {
    const out = await g.git(this.repoRoot, ['branch', '--list', `orch/${runId}/*`, '--format=%(refname:short)']);
    for (const b of out.split('\n').map((s) => s.trim()).filter(Boolean)) {
      await g.git(this.repoRoot, ['branch', '-D', b]).catch(() => undefined);
    }
  }
}

