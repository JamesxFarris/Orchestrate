import type { AgentSnapshot, OrchestrateEvent, ProgressSnapshot, RunState, TaskContract, TaskState } from '@orchestrate/shared';
import { describe, expect, it } from 'vitest';
import type { Team } from '../src/store.ts';
import { buildBoard, describeAction } from '../src/ui/board/buildBoard.ts';

const team: Team = {
  mode: 'demo',
  project: { name: 'Test', language: 'TypeScript' },
  squads: [
    { id: 'render', name: 'Render & UI', color: '#f2a541', mission: '' },
    { id: 'engine', name: 'Core Engine', color: '#1985a1', mission: '' },
  ],
  roles: [
    { id: 'render-dev', title: 'Render Developer', kind: 'dev', tier: 'senior', squad: 'render' },
    { id: 'render-qa', title: 'Render QA Engineer', kind: 'qa', tier: 'ic', squad: 'render' },
    { id: 'engine-dev', title: 'Engine Developer', kind: 'dev', tier: 'senior', squad: 'engine' },
    { id: 'engine-lead', title: 'Engine Lead', kind: 'lead', tier: 'lead', squad: 'engine' },
  ],
  techCircle: [],
};

const contract = (id: string, squad: string, extra: Partial<TaskContract> = {}): TaskContract => ({
  id,
  title: `Task ${id}`,
  squad,
  kind: 'code',
  objective: '',
  acceptanceCriteria: ['works'],
  nonGoals: [],
  writeScope: [`src/${squad}/**`],
  readScope: [],
  testFiles: [],
  dependsOn: [],
  testPlan: '',
  ...extra,
});

const task = (id: string, squad: string, status: TaskState['status'], attempts = 1): TaskState => ({ contract: contract(id, squad), status, attempts });

const run = (tasks: TaskState[], id = 'run-1'): RunState => ({ id, prompt: 'p', status: 'executing', createdAt: 0, tasks, costUsd: 0 });

const agent = (agentId: string, taskId: string, activity: AgentSnapshot['activity'] = 'working', summary?: string): AgentSnapshot => ({
  agentId,
  activity,
  taskId,
  summary,
  since: 1000,
  costUsd: 0.5,
});

describe('buildBoard: order and stages', () => {
  it('puts stuck work first, then active, then queued, then done, keeping plan order inside a group', () => {
    const r = run([
      task('done-1', 'render', 'merged'),
      task('queued-1', 'render', 'pending'),
      task('active-1', 'render', 'in_progress'),
      task('stuck-1', 'engine', 'escalated'),
      task('active-2', 'engine', 'review'),
    ]);
    const ids = buildBoard(r, {}, [], team).tiles.map((t) => t.taskId);
    expect(ids).toEqual(['stuck-1', 'active-1', 'active-2', 'queued-1', 'done-1']);
  });

  it('treats an agent waiting on its lead as stuck even though the task is still in progress', () => {
    const r = run([task('a', 'render', 'in_progress'), task('b', 'engine', 'in_progress')]);
    const tiles = buildBoard(r, { 'engine-dev': agent('engine-dev', 'b', 'blocked') }, [], team).tiles;
    expect(tiles[0]).toMatchObject({ taskId: 'b', tone: 'stuck', statusLabel: 'waiting on lead' });
  });

  it('maps task status to a growth stage', () => {
    const statuses: TaskState['status'][] = ['pending', 'red', 'in_progress', 'verifying', 'review', 'merged', 'escalated', 'failed', 'skipped'];
    const r = run(statuses.map((s, i) => task(`t${i}`, 'render', s)));
    const byId = new Map(buildBoard(r, {}, [], team).tiles.map((t) => [t.taskId, t.stage]));
    expect(statuses.map((_, i) => byId.get(`t${i}`))).toEqual(['queued', 'seed', 'sprout', 'sprout', 'bud', 'bloom', 'wilt', 'wilt', 'skipped']);
  });
});

describe('buildBoard: who is working and on what', () => {
  it('attaches the non-idle agent on the task, with its role and live summary', () => {
    const r = run([task('a', 'render', 'red')]);
    const [tile] = buildBoard(r, { 'render-qa': agent('render-qa', 'a', 'working', 'Writing failing tests') }, [], team).tiles;
    expect(tile!.agent).toMatchObject({ id: 'render-qa', title: 'Render QA Engineer', kind: 'qa', activity: 'working', since: 1000, costUsd: 0.5 });
    expect(tile!.progress).toBe('Writing failing tests');
  });

  it('ignores idle agents', () => {
    const r = run([task('a', 'render', 'pending')]);
    expect(buildBoard(r, { 'render-dev': agent('render-dev', 'a', 'idle') }, [], team).tiles[0]!.agent).toBeUndefined();
  });

  it("shows the current agent's latest real tool call, skipping orchestrator role tools", () => {
    const r = run([task('a', 'render', 'in_progress')]);
    const events: OrchestrateEvent[] = [
      { type: 'agent.log', ts: 1, runId: 'run-1', agentId: 'render-dev', taskId: 'a', kind: 'tool', text: 'Read src/render/hud.ts' },
      { type: 'agent.log', ts: 2, runId: 'run-1', agentId: 'render-dev', taskId: 'a', kind: 'tool', text: 'Edit src/render/healthBar.ts' },
      { type: 'agent.log', ts: 3, runId: 'run-1', agentId: 'render-dev', taskId: 'a', kind: 'tool', text: 'mcp__orch__report_progress wiring the bar' },
      { type: 'agent.log', ts: 4, runId: 'run-1', agentId: 'render-dev', taskId: 'a', kind: 'text', text: 'thinking out loud' },
    ];
    const [tile] = buildBoard(r, { 'render-dev': agent('render-dev', 'a') }, events, team).tiles;
    expect(tile!.lastAction).toBe('edited src/render/healthBar.ts');
  });

  it("does not show a previous agent's action once someone else holds the task", () => {
    const r = run([task('a', 'render', 'in_progress')]);
    const events: OrchestrateEvent[] = [{ type: 'agent.log', ts: 1, runId: 'run-1', agentId: 'render-qa', taskId: 'a', kind: 'tool', text: 'Write tests/a.test.ts' }];
    expect(buildBoard(r, { 'render-dev': agent('render-dev', 'a') }, events, team).tiles[0]!.lastAction).toBeUndefined();
  });

  it('ignores events from another run that reused the same task id', () => {
    const r = run([task('a', 'render', 'in_progress')]);
    const events: OrchestrateEvent[] = [
      { type: 'agent.log', ts: 1, runId: 'old-run', agentId: 'render-dev', taskId: 'a', kind: 'tool', text: 'Edit old.ts' },
      { type: 'gate.result', ts: 2, runId: 'old-run', taskId: 'a', gate: 'test', ok: false, output: '' },
    ];
    const [tile] = buildBoard(r, { 'render-dev': agent('render-dev', 'a') }, events, team).tiles;
    expect(tile!.lastAction).toBeUndefined();
    expect(tile!.gates).toEqual([]);
  });
});

describe('describeAction', () => {
  it('turns tool calls into short past-tense phrases', () => {
    expect(describeAction('Write tests/a.test.ts')).toBe('wrote tests/a.test.ts');
    expect(describeAction('Bash npx vitest run tests/a.test.ts')).toBe('ran npx vitest run tests/a.test.ts');
    expect(describeAction('Grep healthBar')).toBe('searched for healthBar');
    expect(describeAction('TodoWrite')).toBe('todowrite');
    expect(describeAction('mcp__orch__submit_work done')).toBeUndefined();
  });
});

describe('buildBoard: checks and blockers', () => {
  it('keeps the latest result per gate, in first-seen order', () => {
    const r = run([task('a', 'engine', 'review', 2)]);
    const g = (gate: 'typecheck' | 'test', ok: boolean, ts: number): OrchestrateEvent => ({ type: 'gate.result', ts, runId: 'run-1', taskId: 'a', gate, ok, output: '' });
    const [tile] = buildBoard(r, {}, [g('typecheck', false, 1), g('test', false, 2), g('typecheck', true, 3), g('test', true, 4)], team).tiles;
    expect(tile!.gates).toEqual([
      { gate: 'typecheck', ok: true },
      { gate: 'test', ok: true },
    ]);
  });

  it("shows an escalation as the blocker until the lead rules on it", () => {
    const r = run([task('a', 'engine', 'in_progress', 2)]);
    const asked: OrchestrateEvent = { type: 'escalation', ts: 1, runId: 'run-1', taskId: 'a', from: 'engine-dev', to: 'engine-lead', reason: 'needs src/core/bus.ts' };
    const ruled: OrchestrateEvent = {
      type: 'escalation',
      ts: 2,
      runId: 'run-1',
      taskId: 'a',
      from: 'engine-lead',
      to: 'engine-dev',
      reason: 'granted',
      decision: { decision: 'grant', guidance: 'granted', addWriteScope: ['src/core/bus.ts'] },
    };
    expect(buildBoard(r, {}, [asked], team).tiles[0]!.blocker).toBe('needs src/core/bus.ts');
    expect(buildBoard(r, {}, [asked, ruled], team).tiles[0]!.blocker).toBeUndefined();
  });

  it('carries the failure detail on escalated or failed tasks', () => {
    const t = { ...task('a', 'engine', 'escalated'), detail: 'not accepted after 3 attempts' };
    expect(buildBoard(run([t]), {}, [], team).tiles[0]!.detail).toBe('not accepted after 3 attempts');
  });
});

describe('buildBoard: header counts and squads', () => {
  it('counts working, waiting and done', () => {
    const r = run([task('a', 'render', 'in_progress'), task('b', 'engine', 'in_progress'), task('c', 'render', 'merged'), task('d', 'engine', 'pending')]);
    const agents = { 'render-dev': agent('render-dev', 'a'), 'engine-dev': agent('engine-dev', 'b', 'blocked') };
    expect(buildBoard(r, agents, [], team).counts).toEqual({ working: 1, waiting: 1, done: 1, total: 4 });
  });

  it("uses the squad's name and colour from the team, falling back to the raw id", () => {
    const r = run([task('a', 'render', 'pending'), task('b', 'ghost', 'pending')]);
    const [a, b] = buildBoard(r, {}, [], team).tiles;
    expect(a!.squad).toEqual({ id: 'render', name: 'Render & UI', color: '#f2a541' });
    expect(b!.squad).toMatchObject({ id: 'ghost', name: 'ghost' });
  });
});

describe('buildBoard: progression', () => {
  const settlement = (level: number, name: string, into: number, needed: number) => ({ level, name, into, needed });
  const progress = (shippedAt?: number): ProgressSnapshot => ({
    districts: [
      { squad: 'render', growth: 340, pending: 200, settlement: settlement(2, 'Village', 140, 300), settlementAfterPending: settlement(3, 'Town', 40, 400), streak: 2, ships: 2 },
      { squad: 'engine', growth: 0, pending: 0, settlement: settlement(1, 'Hamlet', 0, 200), settlementAfterPending: settlement(1, 'Hamlet', 0, 200), streak: 0, ships: 0 },
    ],
    runs: [
      {
        runId: 'run-1',
        shippedAt,
        outcomes: [
          { taskId: 'a', squad: 'render', merged: true, firstTry: true, noFuss: true, thrifty: true, costUsd: 1, growth: 200 },
          { taskId: 'b', squad: 'engine', merged: false, firstTry: true, noFuss: true, thrifty: true, costUsd: 0, growth: 0 },
        ],
      },
    ],
  });

  it("gives each tile its district's settlement and how far along it is", () => {
    const r = run([task('a', 'render', 'merged'), task('b', 'engine', 'in_progress')]);
    const tiles = buildBoard(r, {}, [], team, progress()).tiles;
    expect(tiles.find((t) => t.taskId === 'b')!.district).toEqual({ name: 'Hamlet', level: 1, fraction: 0 });
    expect(tiles.find((t) => t.taskId === 'a')!.district).toMatchObject({ name: 'Village', level: 2, fraction: 140 / 300 });
  });

  it('shows the growth a merged task earned', () => {
    const r = run([task('a', 'render', 'merged'), task('b', 'engine', 'in_progress')]);
    const tiles = buildBoard(r, {}, [], team, progress()).tiles;
    expect(tiles.find((t) => t.taskId === 'a')!.growth).toBe(200);
    expect(tiles.find((t) => t.taskId === 'b')!.growth).toBeUndefined();
  });

  it('is ready to ship once completed, and remembers when it has shipped', () => {
    const done = { ...run([task('a', 'render', 'merged')]), status: 'completed' as const };
    expect(buildBoard(done, {}, [], team, progress()).ship).toEqual({ state: 'ready', growth: 200 });
    expect(buildBoard(done, {}, [], team, progress(99)).ship).toEqual({ state: 'shipped', growth: 200 });
    expect(buildBoard(run([task('a', 'render', 'in_progress')]), {}, [], team, progress()).ship).toEqual({ state: 'growing', growth: 200 });
    expect(buildBoard({ ...done, status: 'failed' }, {}, [], team, progress()).ship).toEqual({ state: 'none', growth: 200 });
  });

  it('works without progress (older daemon, or still loading)', () => {
    const [tile] = buildBoard(run([task('a', 'render', 'merged')]), {}, [], team).tiles;
    expect(tile!.district).toBeUndefined();
    expect(buildBoard(run([task('a', 'render', 'merged')]), {}, [], team).ship).toEqual({ state: 'growing', growth: 0 });
  });
});

describe('buildBoard: phase (what the colour means)', () => {
  it('gives every status its own phase, and anything stuck the stuck phase', () => {
    const statuses: TaskState['status'][] = ['pending', 'red', 'in_progress', 'verifying', 'review', 'merged', 'escalated', 'failed', 'skipped'];
    const r = run(statuses.map((s, i) => task(`t${i}`, 'render', s)));
    const byId = new Map(buildBoard(r, {}, [], team).tiles.map((t) => [t.taskId, t.phase]));
    expect(statuses.map((_, i) => byId.get(`t${i}`))).toEqual(['queued', 'tests', 'building', 'checks', 'review', 'merged', 'stuck', 'stuck', 'skipped']);
  });

  it('marks a task stuck while its agent waits on the lead', () => {
    const r = run([task('b', 'engine', 'in_progress')]);
    expect(buildBoard(r, { 'engine-dev': agent('engine-dev', 'b', 'blocked') }, [], team).tiles[0]!.phase).toBe('stuck');
  });
});
