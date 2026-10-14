import { readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Org, validatePlan } from '@orchestrate/core';
import type { Plan, RunState } from '@orchestrate/shared';
import { buildApp } from '../src/app.ts';
import { DemoBackend } from '../src/demo.ts';

const org = Org.load(path.resolve(import.meta.dirname, '../../../presets/corpsegrinder.team.yaml'));
let close: (() => Promise<void>) | undefined;
afterEach(async () => close?.());

async function setup() {
  const backend = new DemoBackend(org, 200);
  const app = await buildApp({ backend });
  close = () => app.close();
  return { app, backend };
}

describe('daemon API (demo backend)', () => {
  it('serves the org chart for the city', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/team' });
    const team = res.json();
    expect(team.mode).toBe('demo');
    expect(team.squads.map((s: { id: string }) => s.id)).toEqual(['gameplay', 'engine', 'render', 'research']);
    expect(team.roles.find((r: { id: string }) => r.id === 'head-of-eng').kind).toBe('master');
    expect(team.roles.some((r: { id: string }) => r.id === 'head-of-product')).toBe(false);
  });

  it('runs a prompt through planning, the human gate, and execution', async () => {
    const { app, backend } = await setup();
    const kinds = new Set<string>();
    backend.bus.on((e) => kinds.add(e.type));

    const created = await app.inject({ method: 'POST', url: '/api/runs', payload: { prompt: 'Add a basic wave spawner' } });
    expect(created.statusCode).toBe(201);
    const id = created.json<RunState>().id;

    await until(async () => (await app.inject({ url: `/api/runs/${id}` })).json<RunState>().status === 'awaiting_approval');
    expect((await app.inject({ method: 'POST', url: `/api/runs/${id}/approve` })).statusCode).toBe(200);
    await until(async () => (await app.inject({ url: `/api/runs/${id}` })).json<RunState>().status === 'completed', 20_000);

    const run = (await app.inject({ url: `/api/runs/${id}` })).json<RunState>();
    expect(run.tasks.every((t) => t.status === 'merged')).toBe(true);
    for (const k of ['circle.convened', 'agent.activity', 'agent.progress', 'handoff', 'gate.result', 'run.summary']) expect(kinds).toContain(k);
    expect((await app.inject({ url: `/api/runs/${id}/events` })).json().length).toBeGreaterThan(20);
    const state = (await app.inject({ url: '/api/state' })).json();
    expect(state.agents.every((a: { activity: string }) => a.activity === 'idle')).toBe(true);
  });

  it('validates input and state transitions', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'POST', url: '/api/runs', payload: { prompt: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/runs/nope/approve' })).statusCode).toBe(409);
    expect((await app.inject({ url: '/api/runs/nope' })).statusCode).toBe(404);
  });

  it('refuses browsers on foreign origins', async () => {
    const { app } = await setup();
    const evil = await app.inject({ method: 'OPTIONS', url: '/api/runs', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    const local = await app.inject({ method: 'OPTIONS', url: '/api/runs', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' } });
    expect(local.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    // a form/text post (no preflight) is not parsed as a run request
    const form = await app.inject({ method: 'POST', url: '/api/runs', headers: { 'content-type': 'text/plain' }, payload: 'prompt=hi' });
    expect(form.statusCode).toBeGreaterThanOrEqual(400);
  });
});

const presetsDir = path.resolve(import.meta.dirname, '../../../presets');
const presets = readdirSync(presetsDir).filter((f) => f.endsWith('.team.yaml'));

describe('demo plan', () => {
  // The simulated plan must pass the same deterministic checks a real Master's plan faces.
  it.each(presets)('passes validatePlan for %s', async (file) => {
    const teamOrg = Org.load(path.join(presetsDir, file));
    const backend = new DemoBackend(teamOrg, 200);
    let plan: Plan | undefined;
    backend.bus.on((e) => {
      if (e.type === 'plan.proposed') plan = e.plan;
    });
    const run = backend.submit('Add a basic wave spawner', {});
    await until(async () => !!plan);
    backend.cancel(run.id);
    expect(validatePlan(plan!, teamOrg)).toEqual([]);
    const spec = plan!.tasks.find((t) => t.kind === 'research');
    expect(spec?.writeScope).toEqual(['docs/design/add-a-basic-wave-spawner.md', 'docs/adr/0001-add-a-basic-wave-spawner.md']);
    expect(plan!.tasks.filter((t) => t.kind === 'code').every((t) => t.dependsOn.includes('spec'))).toBe(true);
  });
});

async function until(cond: () => Promise<boolean>, timeoutMs = 10_000) {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}
