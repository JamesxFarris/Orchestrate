import { randomBytes } from 'node:crypto';
import { computeProgress, EventBus, finishedAt, type Org, type ShipResult } from '@orchestrate/core';
import type { EventInput, OrchestrateEvent, Plan, ProgressSnapshot, RunState, TaskContract, TaskState } from '@orchestrate/shared';
import type { Backend } from './backend.ts';

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), reject(new Error('cancelled'))), { once: true });
  });

const DEV_LINES = [
  'Reading the acceptance tests',
  'Sketching the data structures',
  'Implementing the core loop',
  'Wiring it into the existing system',
  'Running the targeted tests',
  'Fixing an off-by-one in the edge case',
];
const QA_LINES = ['Reading the contract', 'Writing acceptance tests', 'Covering edge cases', 'Confirming tests fail (red)'];
const SPEC_LINES = [
  'Reading the code the change touches',
  'Drawing the module boundaries',
  'Writing the contracts between squads',
  'Listing edge cases and testing notes',
  'Recording the decision in an ADR',
];

/** "Add a basic wave spawner!" -> "add-a-basic-wave-spawner" (used for the demo's doc file names). */
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'design';

/**
 * Simulated runs that exercise every event the city renders, using the real org chart.
 * No API calls, no repository. `speed` < 1 slows everything down for presentations.
 */
export class DemoBackend implements Backend {
  readonly mode = 'demo' as const;
  readonly bus = new EventBus();
  private runs = new Map<string, RunState>();
  private log = new Map<string, OrchestrateEvent[]>();
  private controllers = new Map<string, AbortController>();
  private approvals = new Map<string, () => void>();
  private ships = new Map<string, { sha: string; at: number }>();

  constructor(
    readonly org: Org,
    private readonly speed = 1,
    /** A completed demo project ships itself after this long unless Ship it was pressed first. */
    private readonly autoShipMs = 10_000,
  ) {
    this.bus.on((e) => {
      if (e.runId) this.log.get(e.runId)?.push(e);
    });
  }

  submit(prompt: string, opts: { autoApprove?: boolean }): RunState {
    const id = `demo-${randomBytes(3).toString('hex')}`;
    const run: RunState = { id, prompt, status: 'planning', createdAt: Date.now(), tasks: [], costUsd: 0 };
    this.runs.set(id, run);
    this.log.set(id, []);
    const c = new AbortController();
    this.controllers.set(id, c);
    this.emit({ type: 'run.created', runId: id, prompt });
    void this.simulate(run, c.signal, !!opts.autoApprove).catch(() => {
      for (const r of this.org.roles) this.emit({ type: 'agent.activity', runId: id, agentId: r.id, activity: 'idle' });
      run.status = 'cancelled';
      this.emit({ type: 'run.status', runId: id, status: 'cancelled' });
    });
    return run;
  }

  approve(runId: string): boolean {
    const a = this.approvals.get(runId);
    this.approvals.delete(runId);
    a?.();
    return !!a;
  }

  cancel(runId: string): boolean {
    const c = this.controllers.get(runId);
    if (!c || c.signal.aborted) return false;
    c.abort();
    return true;
  }

  get(runId: string) {
    return this.runs.get(runId);
  }
  list() {
    return [...this.runs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
  events(runId: string) {
    return this.log.get(runId) ?? [];
  }

  /** No repository in demo mode: shipping is a simulated merge, so the whole loop is visible. */
  async ship(runId: string): Promise<ShipResult> {
    const done = this.ships.get(runId);
    if (done) return { ok: true, sha: done.sha, alreadyShipped: true, tested: false };
    if (this.runs.get(runId)?.status !== 'completed') return { ok: false, reason: 'not-ready', message: 'Only a completed project can ship.' };
    return { ok: true, sha: this.recordShip(runId, 'merged'), alreadyShipped: false, tested: false };
  }

  async markShipped(runId: string): Promise<boolean> {
    if (this.runs.get(runId)?.status !== 'completed' || this.ships.has(runId)) return false;
    this.recordShip(runId, 'marked');
    return true;
  }

  progress(): ProgressSnapshot {
    const facts = [...this.runs.values()].map((run) => {
      const events = this.log.get(run.id) ?? [];
      return { run, events, finishedAt: finishedAt(events), shippedAt: this.ships.get(run.id)?.at };
    });
    return computeProgress(facts, this.org.squads.map((s) => s.id), (squad, kind) => this.org.implementerBudget(squad, kind));
  }

  private recordShip(runId: string, method: 'merged' | 'marked'): string {
    const sha = randomBytes(20).toString('hex');
    this.ships.set(runId, { sha, at: Date.now() });
    this.emit({ type: 'run.shipped', runId, sha, method });
    return sha;
  }

  private emit(e: EventInput) {
    this.bus.emit(e);
  }

  private wait(ms: number, s: AbortSignal) {
    return sleep(ms / this.speed, s);
  }

  private async work(run: RunState, s: AbortSignal, agentId: string, activity: 'working' | 'testing' | 'reviewing', task: TaskState | undefined, lines: string[], each = 1600) {
    this.emit({ type: 'agent.activity', runId: run.id, agentId, activity, taskId: task?.contract.id, taskTitle: task?.contract.title, summary: lines[0] });
    for (const line of lines) {
      this.emit({ type: 'agent.progress', runId: run.id, agentId, taskId: task?.contract.id, summary: line });
      this.emit({ type: 'agent.log', runId: run.id, agentId, taskId: task?.contract.id, kind: 'tool', text: `Edit ${task?.contract.writeScope[0] ?? 'docs'}` });
      await this.wait(each * (0.6 + Math.random() * 0.8), s);
    }
    const usd = +(0.05 + Math.random() * 0.4).toFixed(3);
    run.costUsd += usd;
    this.emit({ type: 'agent.cost', runId: run.id, agentId, taskId: task?.contract.id, usd });
    this.emit({ type: 'agent.activity', runId: run.id, agentId, activity: 'idle' });
  }

  private status(run: RunState, status: RunState['status'], detail?: string) {
    run.status = status;
    run.detail = detail;
    this.emit({ type: 'run.status', runId: run.id, status, detail });
  }

  private taskStatus(run: RunState, t: TaskState, status: TaskState['status'], detail?: string) {
    t.status = status;
    t.detail = detail;
    this.emit({ type: 'task.status', runId: run.id, taskId: t.contract.id, status, detail });
  }

  private demoPlan(prompt: string): Plan {
    const squads = this.org.squads.filter((sq) => this.org.implementer(sq.id, 'code') || this.org.implementer(sq.id, 'research'));
    const tasks: TaskContract[] = [];
    // The Architecture squad (no QA): a design doc + ADR under its docs root that the code tasks depend on.
    const research = squads.find((sq) => !this.org.squadRole(sq.id, 'qa'));
    const docsRoot = research?.owns[0]!.replace(/\*.*$/, '') ?? 'docs/';
    const slug = slugify(prompt);
    const designDoc = `${docsRoot}design/${slug}.md`;
    if (research) {
      tasks.push({
        id: 'spec',
        title: 'Design doc and ADR',
        squad: research.id,
        kind: 'research',
        objective: `Write the design doc and ADR for: ${prompt}`,
        acceptanceCriteria: [
          'Design doc covers goals, non-goals, module boundaries, cross-squad contracts, data flow, edge cases and testing notes',
          'ADR records the context, the decision, rejected alternatives and consequences',
        ],
        nonGoals: ['Implementation'],
        writeScope: [designDoc, `${docsRoot}adr/0001-${slug}.md`],
        readScope: [],
        testFiles: [],
        dependsOn: [],
        testPlan: 'Reviewed by the Architecture Lead; QA turns the testing notes into acceptance tests for the code tasks',
      });
    }
    for (const sq of squads.filter((x) => x !== research).slice(0, 3)) {
      tasks.push({
        id: `${sq.id}-work`,
        title: `${sq.name}: ${prompt.slice(0, 40)}`,
        squad: sq.id,
        kind: 'code',
        objective: `${sq.name} part of: ${prompt}`,
        acceptanceCriteria: ['Behaviour covered by tests'],
        nonGoals: ['Refactors'],
        writeScope: [sq.owns[0]!],
        readScope: research ? [designDoc] : [],
        testFiles: [`${(sq.testDirs[0] ?? 'tests/**').replace('**', sq.id)}.test.ts`],
        dependsOn: research ? ['spec'] : [],
        testPlan: 'Unit tests',
      });
    }
    return { summary: `Split "${prompt}" across ${tasks.length} squads.`, tasks, risks: [] };
  }

  private async simulate(run: RunState, s: AbortSignal, autoApprove: boolean) {
    const org = this.org;
    const master = org.master();

    this.status(run, 'planning');
    await this.work(run, s, master.id, 'working', undefined, ['Reading the request', 'Surveying the codebase', 'Drafting the plan']);
    const plan = this.demoPlan(run.prompt);
    run.plan = plan;
    run.tasks = plan.tasks.map((contract) => ({ contract, status: 'pending', attempts: 0 }));
    this.emit({ type: 'plan.proposed', runId: run.id, plan, round: 0, problems: [] });

    const reviewers = org.circle().filter((r) => r.kind !== 'master');
    this.status(run, 'reviewing', 'round 1');
    this.emit({ type: 'circle.convened', runId: run.id, members: [master.id, ...reviewers.map((r) => r.id)] });
    await Promise.all(
      reviewers.map(async (r) => {
        await this.wait(Math.random() * 800, s);
        await this.work(run, s, r.id, 'reviewing', undefined, ['Tech Circle: reviewing the plan', 'Checking scopes and interfaces'], 1200);
        this.emit({ type: 'circle.review', runId: run.id, roleId: r.id, review: { verdict: 'approve', concerns: [], requiredChanges: [] } });
      }),
    );
    this.emit({ type: 'circle.adjourned', runId: run.id, approved: true });

    if (!autoApprove) {
      this.status(run, 'awaiting_approval');
      await new Promise<void>((resolve, reject) => {
        this.approvals.set(run.id, resolve);
        s.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      });
    }
    this.status(run, 'executing');
    run.integrationBranch = `orch/run-${run.id}`;

    const done = new Map<string, Promise<void>>();
    const runTask = async (t: TaskState) => {
      await Promise.all(t.contract.dependsOn.map((d) => done.get(d)));
      const c = t.contract;
      const lead = org.lead(c.squad);
      const impl = org.implementer(c.squad, c.kind)!;
      if (c.kind === 'code') {
        const qa = org.squadRole(c.squad, 'qa')!;
        this.taskStatus(run, t, 'red');
        await this.work(run, s, qa.id, 'testing', t, QA_LINES);
        this.emit({ type: 'gate.result', runId: run.id, taskId: c.id, gate: 'red', ok: true, output: '3 failing' });
        this.emit({ type: 'handoff', runId: run.id, taskId: c.id, from: qa.id, to: impl.id, reason: 'acceptance tests are red' });
      }
      this.taskStatus(run, t, 'in_progress');
      await this.work(run, s, impl.id, 'working', t, (c.kind === 'research' ? SPEC_LINES : DEV_LINES).slice(0, 3 + Math.floor(Math.random() * 3)));
      if (Math.random() < 0.35) {
        this.emit({ type: 'agent.activity', runId: run.id, agentId: impl.id, activity: 'blocked', taskId: c.id, taskTitle: c.title, summary: 'Needs a shared type outside scope' });
        this.emit({ type: 'escalation', runId: run.id, taskId: c.id, from: impl.id, to: lead.id, reason: 'Needs a shared type outside scope' });
        this.emit({ type: 'handoff', runId: run.id, taskId: c.id, from: impl.id, to: lead.id, reason: 'escalation' });
        await this.wait(1800, s);
        await this.work(run, s, lead.id, 'reviewing', t, ['Ruling on escalation: stay in scope'], 1500);
        this.emit({ type: 'handoff', runId: run.id, taskId: c.id, from: lead.id, to: impl.id, reason: 'guidance' });
        await this.work(run, s, impl.id, 'working', t, ['Applying lead guidance', 'Reworking within scope']);
      }
      this.taskStatus(run, t, 'verifying');
      await this.work(run, s, impl.id, 'testing', t, ['Running gates: typecheck, tests'], 1400);
      for (const gate of ['audit', 'typecheck', 'test'] as const) this.emit({ type: 'gate.result', runId: run.id, taskId: c.id, gate, ok: true, output: 'ok' });
      this.taskStatus(run, t, 'review');
      this.emit({ type: 'handoff', runId: run.id, taskId: c.id, from: impl.id, to: lead.id, reason: 'code review' });
      await this.work(run, s, lead.id, 'reviewing', t, [`Reviewing: ${c.title}`], 1800);
      this.emit({ type: 'code.review', runId: run.id, taskId: c.id, roleId: lead.id, review: { verdict: 'approve', notes: 'LGTM', issues: [] } });
      this.emit({ type: 'gate.result', runId: run.id, taskId: c.id, gate: 'full', ok: true, output: 'merged; full suite green' });
      this.emit({ type: 'handoff', runId: run.id, taskId: c.id, from: lead.id, to: master.id, reason: 'merged' });
      this.taskStatus(run, t, 'merged');
    };
    for (const t of run.tasks) done.set(t.contract.id, runTask(t));
    await Promise.all(done.values());

    await this.work(run, s, master.id, 'working', undefined, ['Writing the run report'], 1500);
    run.summary = `Demo run complete: ${run.tasks.length} tasks merged into ${run.integrationBranch}.`;
    this.emit({ type: 'run.summary', runId: run.id, summary: run.summary, followUps: [], branch: run.integrationBranch });
    this.status(run, 'completed', `${run.tasks.length}/${run.tasks.length} tasks merged`);
    if (Number.isFinite(this.autoShipMs)) setTimeout(() => void this.ship(run.id), this.autoShipMs).unref?.();
  }
}
