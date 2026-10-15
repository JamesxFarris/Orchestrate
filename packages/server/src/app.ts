import { existsSync } from 'node:fs';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { z } from 'zod';
import type { Backend } from './backend.ts';

/** A Host header naming this machine. Anything else is DNS rebinding: a web page whose own hostname now points here. */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
/** The city dev server (Vite) proxies to the daemon from this port. */
export const CITY_DEV_PORT = 5173;

/** Browser origins allowed to call the API: the daemon's own pages and the city dev server, on local hostnames only. */
export function localOrigins(ports: number[]): Set<string> {
  return new Set(ports.flatMap((port) => ['localhost', '127.0.0.1', '[::1]'].map((h) => `http://${h}:${port}`)));
}

const SubmitBody = z.object({
  prompt: z.string().min(3).max(20_000),
  autoApprove: z.boolean().optional(),
  baseRef: z.string().max(200).optional(),
});

/** A WebSocket client this far behind is dropped rather than buffered without limit. */
const MAX_BUFFERED = 4 * 1024 * 1024;
/** Ping interval; a client that misses one pong is dropped. */
const HEARTBEAT_MS = 30_000;

/** `partial`: ship a run even though some of its tasks did not finish (the caller has said so). */
const ShipBody = z.object({ partial: z.boolean().optional() });

export interface AppOptions {
  backend: Backend;
  /** Built city assets to serve at "/". */
  staticDir?: string;
  logger?: boolean;
  /** Browser origins allowed to call the API. Default: localhost on the daemon's default port (4317) and the city dev port. */
  origins?: Set<string>;
}

/**
 * Local-only control plane: a web page must not be able to start paid runs or ship on your machine.
 * - The Host header must name this machine, which defeats DNS rebinding.
 * - A browser request that changes anything (POST, the WebSocket) must come from an allowed origin.
 *   CORS alone is not enough: it only hides responses, and a form post runs the route without asking.
 * - Clients that are not browsers (the MCP server, curl) send no Origin and are allowed.
 */
export async function buildApp({ backend, staticDir, logger = false, origins = localOrigins([4317, CITY_DEV_PORT]) }: AppOptions) {
  const app = Fastify({ logger });
  const allowed = (origin: string | undefined) => origin === undefined || origins.has(origin);

  app.addHook('onRequest', async (req, reply) => {
    if (!LOCAL_HOST.test(req.headers.host ?? '')) return reply.code(403).send({ error: 'host not allowed' });
    if (req.method === 'GET' && !req.headers.upgrade) return; // reads: CORS keeps other origins from seeing the answer
    const origin = req.headers.origin;
    // Without Origin, a browser still says where the request came from (Sec-Fetch-Site), unlike curl or the MCP server.
    const site = req.headers['sec-fetch-site'];
    const browserCrossSite = origin === undefined && site !== undefined && site !== 'same-origin' && site !== 'none';
    if (!allowed(origin) || browserCrossSite) return reply.code(403).send({ error: 'origin not allowed' });
  });

  await app.register(cors, { origin: (origin, cb) => cb(null, allowed(origin)) });
  await app.register(websocket);

  app.get('/api/health', async () => ({ ok: true, mode: backend.mode }));

  app.get('/api/team', async () => {
    const { org } = backend;
    return {
      mode: backend.mode,
      project: { name: org.project.name, language: org.project.language },
      squads: org.squads.map(({ id, name, color, mission }) => ({ id, name, color, mission })),
      roles: org.roles.map(({ id, title, kind, tier, squad, reportsTo }) => ({ id, title, kind, tier, squad, reportsTo })),
      techCircle: org.config.techCircle,
    };
  });

  app.get('/api/state', async () => ({ agents: backend.bus.agentSnapshots(), runs: backend.list().slice(0, 60), progress: backend.progress() }));

  app.get('/api/progress', async () => backend.progress());

  app.get('/api/runs', async () => backend.list());

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => {
    const run = backend.get(req.params.id);
    return run ?? reply.code(404).send({ error: 'not found' });
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/events', async (req) => backend.events(req.params.id));

  app.post('/api/runs', async (req, reply) => {
    const body = SubmitBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues.map((i) => i.message).join('; ') });
    const run = backend.submit(body.data.prompt, body.data);
    return reply.code(201).send(run);
  });

  app.post<{ Params: { id: string } }>('/api/runs/:id/approve', async (req, reply) =>
    backend.approve(req.params.id) ? { ok: true } : reply.code(409).send({ error: 'run is not awaiting approval' }),
  );

  app.post<{ Params: { id: string } }>('/api/runs/:id/cancel', async (req, reply) =>
    backend.cancel(req.params.id) ? { ok: true } : reply.code(409).send({ error: 'run is not active' }),
  );

  // Ship it. A refusal is a 409 carrying the reason and git's output, so the UI can say why.
  app.post<{ Params: { id: string } }>('/api/runs/:id/ship', async (req, reply) => {
    const body = ShipBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.issues.map((i) => i.message).join('; ') });
    const res = await backend.ship(req.params.id, body.data);
    return res.ok ? res : reply.code(409).send({ error: res.message, reason: res.reason, output: res.output });
  });

  app.post<{ Params: { id: string } }>('/api/runs/:id/mark-shipped', async (req, reply) =>
    (await backend.markShipped(req.params.id)) ? { ok: true } : reply.code(409).send({ error: 'only a completed project that has not shipped yet can be marked as shipped' }),
  );

  // the onRequest hook has already refused foreign hosts and origins before the upgrade
  app.get('/ws', { websocket: true }, (socket) => {
    socket.send(JSON.stringify({ type: 'hello', mode: backend.mode, agents: backend.bus.agentSnapshots() }));
    // A stalled tab or a half-open connection would otherwise buffer every agent.log forever.
    // Dropped clients reconnect and reload the state (the city queues events while it does).
    const off = backend.bus.on((e) => {
      if (socket.readyState !== socket.OPEN) return;
      if (socket.bufferedAmount > MAX_BUFFERED) return socket.terminate();
      socket.send(JSON.stringify(e));
    });
    let alive = true;
    socket.on('pong', () => (alive = true));
    const heartbeat = setInterval(() => {
      if (!alive) return socket.terminate();
      alive = false;
      socket.ping();
    }, HEARTBEAT_MS);
    socket.on('close', () => {
      off();
      clearInterval(heartbeat);
    });
  });

  if (staticDir && existsSync(staticDir)) {
    await app.register(fastifyStatic, { root: staticDir });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html')));
  }

  return app;
}
