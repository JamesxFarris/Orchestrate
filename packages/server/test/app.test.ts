import { readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Org, validatePlan } from '@orchestrate/core';
import type { Plan, ProgressSnapshot, RunState } from '@orchestrate/shared';
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

  it('refuses a cross-site post to the routes that read no body (approve, cancel, ship)', async () => {
    const { app, backend } = await setup();
    const id = backend.submit('Add a basic wave spawner', {}).id;
    for (const action of ['approve', 'cancel', 'ship', 'mark-shipped']) {
      const res = await app.inject({ method: 'POST', url: `/api/runs/${id}/${action}`, headers: { origin: 'https://evil.example' } });
      expect(res.statusCode, action).toBe(403);
      // a browser that leaves out Origin still labels the request cross-site
      const bare = await app.inject({ method: 'POST', url: `/api/runs/${id}/${action}`, headers: { 'sec-fetch-site': 'cross-site' } });
      expect(bare.statusCode, action).toBe(403);
    }
    expect(backend.get(id)?.status).not.toBe('cancelled');
  });

  it('refuses other localhost ports: a dev server running agent-written code is not the city', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/runs', headers: { origin: 'http://localhost:3000' }, payload: { prompt: 'Add a basic wave spawner' } });
    expect(res.statusCode).toBe(403);
    const ok = await app.inject({ method: 'POST', url: '/api/runs', headers: { origin: 'http://localhost:5173' }, payload: { prompt: 'Add a basic wave spawner' } });
    expect(ok.statusCode).toBe(201);
  });

  it('refuses DNS rebinding: a request whose Host is not this machine', async () => {
    const { app } = await setup();
    for (const [method, url] of [['GET', '/api/state'], ['POST', '/api/runs'], ['GET', '/ws']] as const) {
      const res = await app.inject({ method, url, headers: { host: 'attacker.example:4317' }, payload: method === 'POST' ? { prompt: 'Add a basic wave spawner' } : undefined });
      expect(res.statusCode, url).toBe(403);
    }
    expect((await app.inject({ url: '/api/health', headers: { host: '127.0.0.1:4317' } })).statusCode).toBe(200);
  });

  it('validates the ship body', async () => {
    const { app, backend } = await setup();
    const id = backend.submit('Add a basic wave spawner', {}).id;
    const bad = await app.inject({ method: 'POST', url: `/api/runs/${id}/ship`, payload: { partial: 'yes' } });
    expect(bad.statusCode).toBe(400);
    const notReady = await app.inject({ method: 'POST', url: `/api/runs/${id}/ship`, payload: { partial: true } });
    expect(notReady.json()).toMatchObject({ reason: 'not-ready' });
  });

  it('still lets clients that are not browsers in (the MCP server, curl)', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/runs', payload: { prompt: 'Add a basic wave spawner' } });
    expect(res.statusCode).toBe(201);
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

describe('shipping and progress API (demo backend)', () => {
  async function finishedRun(autoShipMs: number) {
    const backend = new DemoBackend(org, 200, autoShipMs);
    const app = await buildApp({ backend });
    close = () => app.close();
    const shipped: string[] = [];
    backend.bus.on((e) => e.type === 'run.shipped' && shipped.push(`${e.runId}:${e.method}`));
    const id = (await app.inject({ method: 'POST', url: '/api/runs', payload: { prompt: 'Add a basic wave spawner', autoApprove: true } })).json<RunState>().id;
    await until(async () => (await app.inject({ url: `/api/runs/${id}` })).json<RunState>().status === 'completed', 20_000);
    return { app, id, shipped };
  }
  const totals = (p: ProgressSnapshot) => ({
    growth: p.districts.reduce((s, d) => s + d.growth, 0),
    pending: p.districts.reduce((s, d) => s + d.pending, 0),
  });

  it('banks a finished project only when it ships, and ships once', async () => {
    const { app, id, shipped } = await finishedRun(Infinity);
    const before = totals((await app.inject({ url: '/api/progress' })).json<ProgressSnapshot>());
    expect(before.growth).toBe(0);
    expect(before.pending).toBeGreaterThan(0);

    const res = await app.inject({ method: 'POST', url: `/api/runs/${id}/ship` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, alreadyShipped: false });

    const after = totals((await app.inject({ url: '/api/state' })).json<{ progress: ProgressSnapshot }>().progress);
    expect(after).toEqual({ growth: before.pending, pending: 0 });
    expect((await app.inject({ method: 'POST', url: `/api/runs/${id}/ship` })).json()).toMatchObject({ ok: true, alreadyShipped: true });
    expect((await app.inject({ method: 'POST', url: `/api/runs/${id}/mark-shipped` })).statusCode).toBe(409);
    expect(shipped).toEqual([`${id}:merged`]);
  });

  it('explains why a project cannot ship', async () => {
    const backend = new DemoBackend(org, 200, Infinity);
    const app = await buildApp({ backend });
    close = () => app.close();
    const res = await app.inject({ method: 'POST', url: '/api/runs/nope/ship' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ reason: 'not-ready', error: expect.stringContaining('completed') });
  });

  it('harvests a finished demo project by itself when nobody presses Ship it', async () => {
    const { app, id, shipped } = await finishedRun(30);
    await until(async () => shipped.length > 0, 5_000);
    expect(shipped).toEqual([`${id}:merged`]);
    expect(totals((await app.inject({ url: '/api/progress' })).json<ProgressSnapshot>()).pending).toBe(0);
  });
});
