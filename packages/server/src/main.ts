import path from 'node:path';
import { parseArgs } from 'node:util';
import { Org, Orchestrator, SdkRunner, Store } from '@orchestrate/core';
import { buildApp } from './app.ts';
import { liveBackend, type Backend } from './backend.ts';
import { DemoBackend } from './demo.ts';

const HOME = path.resolve(import.meta.dirname, '../../..');

const { values } = parseArgs({
  options: {
    team: { type: 'string', default: process.env.ORCH_TEAM ?? path.join(HOME, 'presets', 'corpsegrinder.team.yaml') },
    repo: { type: 'string', default: process.env.ORCH_REPO },
    port: { type: 'string', default: process.env.ORCH_PORT ?? '4317' },
    db: { type: 'string', default: process.env.ORCH_DB ?? path.join(HOME, '.orchestrate', 'orchestrate.db') },
    demo: { type: 'boolean', default: process.env.ORCH_DEMO === '1' },
    speed: { type: 'string', default: '1' },
  },
});

const teamFile = path.resolve(values.team!);
const org = Org.load(teamFile);
let backend: Backend;
let stopShipWatch = () => {};

if (values.demo) {
  backend = new DemoBackend(org, Number(values.speed) || 1);
} else {
  const repo = values.repo ?? org.project.repoPath;
  if (!repo) throw new Error('No target repository: pass --repo or set project.repoPath in the team file.');
  // repoPath in the team file is relative to the team file.
  const repoRoot = values.repo ? path.resolve(values.repo) : path.resolve(path.dirname(teamFile), repo);
  const store = new Store(path.resolve(values.db!));
  const orch = new Orchestrator({ org, runner: new SdkRunner(), repoRoot, store });
  backend = liveBackend(orch, store);
  // Fallback for projects merged outside Orchestrate: one cheap check a minute.
  stopShipWatch = orch.watchShips();
  console.log(`[orchestrate] target repo: ${repoRoot}`);
}

const app = await buildApp({ backend, staticDir: path.join(HOME, 'packages', 'city', 'dist') });
const port = Number(values.port);
await app.listen({ host: '127.0.0.1', port });
console.log(`[orchestrate] ${backend.mode} mode · team "${org.project.name}" (${org.roles.length} agents) · http://127.0.0.1:${port}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    stopShipWatch();
    for (const r of backend.list()) if (!['completed', 'failed', 'cancelled'].includes(r.status)) backend.cancel(r.id);
    void app.close().then(() => process.exit(0));
  });
}
