import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { CircleReview, Plan, RunSummary, type RunState, type RunStatus, type TaskState } from '@orchestrate/shared';
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
import { READ_TOOLS, type AgentRunner } from './runner/types.ts';
import type { Store } from './store/store.ts';

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
    }
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
      const plan = await this.planWithCircle(ctx);
      if (!plan) {
        this.setStatus(run, 'failed', run.detail ?? 'no acceptable plan');
        return run;
      }
      run.plan = plan;
      run.tasks = plan.tasks.map((contract) => ({ contract, status: 'pending', attempts: 0 }));
      this.save(run);

      if (this.org.policy.requireHumanApproval && !opts.autoApprove) {
        this.setStatus(run, 'awaiting_approval');
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

  /** Master drafts; deterministic validation and the Tech Circle push back; at most N revision rounds. */
  private async planWithCircle(ctx: RunContext): Promise<Plan | undefined> {
    const { org, run } = ctx;
    const master = org.master();
    let previous: Plan | undefined;
    let feedback: string[] = [];
    let lastValid: Plan | undefined;

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
      if (reviewers.length === 0) return plan;
      this.setStatus(run, 'reviewing', `round ${round + 1}`);
      this.bus.emit({ type: 'circle.convened', runId: run.id, members: [master.id, ...reviewers.map((r) => r.id)] });
      const reviews = await Promise.all(
        reviewers.map(async (role) => {
          const r = await ctx.callAgent({
            role,
            activity: 'reviewing',
            cwd: this.repoRoot,
            system: circleReviewSystem(org, role),
            prompt: circleReviewPrompt(run.prompt, plan),
            tools: READ_TOOLS,
            guard: READ_ONLY,
            schema: outputSchema(CircleReview),
            headline: 'Tech Circle: reviewing the plan',
          });
          const p = parseStructured(CircleReview, r);
          // An unreadable review abstains rather than blocking the circle.
          const review: CircleReview = p.ok ? p.value : { verdict: 'approve', concerns: [`(review unreadable: ${p.error})`], requiredChanges: [] };
          this.bus.emit({ type: 'circle.review', runId: run.id, roleId: role.id, review });
          return { role, review };
        }),
      );
      const changes = reviews.flatMap(({ role, review }) =>
        review.verdict === 'revise' ? review.requiredChanges.map((c) => `[${role.title}] ${c}`) : [],
      );
      const approved = changes.length === 0;
      this.bus.emit({ type: 'circle.adjourned', runId: run.id, approved });
      if (approved) return plan;
      feedback = changes;
    }

    if (lastValid) {
      // Out of rounds but structurally sound: let the human gate decide with the concerns visible.
      run.detail = `Tech Circle still had concerns after ${org.policy.circleRevisionRounds} revisions: ${feedback.join(' | ')}`;
      return lastValid;
    }
    run.detail = `no valid plan after ${org.policy.circleRevisionRounds + 1} attempts: ${feedback.join(' | ')}`;
    return undefined;
  }

  private async executeTasks(ctx: RunContext, baseRef: string): Promise<void> {
    const { org, run } = ctx;
    const integration = new Integration(this.repoRoot, run.id, this.workDir, org.project.linkDirs);
    ctx.integration = integration;
    run.integrationBranch = integration.branch;
    await integration.init(baseRef, org.gates, ctx.signal);

    const running = new Map<string, Promise<void>>();
    try {
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
