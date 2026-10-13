import { existsSync } from 'node:fs';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { z } from 'zod';
import type { Backend } from './backend.ts';

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const SubmitBody = z.object({
  prompt: z.string().min(3).max(20_000),
  autoApprove: z.boolean().optional(),
  baseRef: z.string().max(200).optional(),
});

export interface AppOptions {
  backend: Backend;
  /** Built city assets to serve at "/". */
  staticDir?: string;
  logger?: boolean;
}

/**
 * Local-only control plane. Browsers on other origins are refused (CORS + JSON-only bodies + WS
 * origin check) so a web page cannot start paid runs on your machine.
 */
export async function buildApp({ backend, staticDir, logger = false }: AppOptions) {
  const app = Fastify({ logger });

  await app.register(cors, { origin: (origin, cb) => cb(null, !origin || LOCAL_ORIGIN.test(origin)) });
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

  app.get('/api/state', async () => ({ agents: backend.bus.agentSnapshots(), runs: backend.list().slice(0, 20) }));

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

  app.get('/ws', { websocket: true }, (socket, req) => {
    const origin = req.headers.origin;
    if (origin && !LOCAL_ORIGIN.test(origin)) {
      socket.close(1008, 'origin not allowed');
      return;
    }
    socket.send(JSON.stringify({ type: 'hello', mode: backend.mode, agents: backend.bus.agentSnapshots() }));
    const off = backend.bus.on((e) => socket.send(JSON.stringify(e)));
    socket.on('close', off);
  });

  if (staticDir && existsSync(staticDir)) {
    await app.register(fastifyStatic, { root: staticDir });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html')));
  }

  return app;
}
