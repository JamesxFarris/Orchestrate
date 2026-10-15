import path from 'node:path';
import { parseArgs } from 'node:util';
import { Org, Orchestrator, SdkRunner, Store } from '@orchestrate/core';
import { buildApp, CITY_DEV_PORT, localOrigins } from './app.ts';
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
  // Runs that were going when the daemon last stopped can never finish: say so, and clean up.
  const recovered = await orch.recoverInterrupted();
  if (recovered.length) console.log(`[orchestrate] marked ${recovered.length} interrupted run(s) as failed: ${recovered.join(', ')}`);
  // Fallback for projects merged outside Orchestrate: one cheap check a minute.
  stopShipWatch = orch.watchShips();
  console.log(`[orchestrate] target repo: ${repoRoot}`);
}

const port = Number(values.port);
const app = await buildApp({ backend, staticDir: path.join(HOME, 'packages', 'city', 'dist'), origins: localOrigins([port, CITY_DEV_PORT]) });
await app.listen({ host: '127.0.0.1', port });
console.log(`[orchestrate] ${backend.mode} mode · team "${org.project.name}" (${org.roles.length} agents) · http://127.0.0.1:${port}`);

// Stop: cancel runs and give them time to record "cancelled" and remove their worktrees. A second
// Ctrl+C exits straight away.
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log('[orchestrate] stopping: cancelling active runs (Ctrl+C again to force)…');
    stopShipWatch();
    void backend
      .shutdown()
      .then(() => app.close())
      .catch((e) => console.error('[orchestrate] error while stopping:', e))
      .finally(() => process.exit(0));
  });
}
