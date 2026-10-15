import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { OrchestrateEvent, RunState, ShipMethod } from '@orchestrate/shared';

export interface ShipRecord {
  runId: string;
  sha: string;
  at: number;
  method: ShipMethod;
}

/** Durable record of runs and their full event history (for replaying a run in the city). */
export class Store {
  private db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        state TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        body TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_run ON events(run_id, seq);
      -- The one fact progression adds: when a run's work landed on the default branch.
      CREATE TABLE IF NOT EXISTS ships (
        run_id TEXT PRIMARY KEY,
        sha TEXT NOT NULL,
        shipped_at INTEGER NOT NULL,
        method TEXT NOT NULL
      );
    `);
  }

  /** First record wins: a run ships once. */
  recordShip(s: ShipRecord): void {
    this.db.prepare('INSERT OR IGNORE INTO ships (run_id, sha, shipped_at, method) VALUES (?, ?, ?, ?)').run(s.runId, s.sha, s.at, s.method);
  }

  ships(): ShipRecord[] {
    const rows = this.db.prepare('SELECT run_id, sha, shipped_at, method FROM ships').all() as { run_id: string; sha: string; shipped_at: number; method: ShipMethod }[];
    return rows.map((r) => ({ runId: r.run_id, sha: r.sha, at: r.shipped_at, method: r.method }));
  }

  saveRun(run: RunState): void {
    this.db
      .prepare('INSERT INTO runs (id, created_at, state) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state')
      .run(run.id, run.createdAt, JSON.stringify(run));
  }

  getRun(id: string): RunState | undefined {
    const row = this.db.prepare('SELECT state FROM runs WHERE id = ?').get(id) as { state: string } | undefined;
    return row ? (JSON.parse(row.state) as RunState) : undefined;
  }

  listRuns(limit = 50): RunState[] {
    const rows = this.db.prepare('SELECT state FROM runs ORDER BY created_at DESC LIMIT ?').all(limit) as { state: string }[];
    return rows.map((r) => JSON.parse(r.state) as RunState);
  }

  appendEvent(e: OrchestrateEvent): void {
    this.db.prepare('INSERT INTO events (run_id, ts, type, body) VALUES (?, ?, ?, ?)').run(e.runId ?? null, e.ts, e.type, JSON.stringify(e));
  }

  /** A run's events in order; `types` limits them to those kinds (agent.log alone is most of the table). */
  events(runId: string, types?: readonly OrchestrateEvent['type'][]): OrchestrateEvent[] {
    const rows = (
      types
        ? this.db.prepare(`SELECT body FROM events WHERE run_id = ? AND type IN (${types.map(() => '?').join(', ')}) ORDER BY seq`).all(runId, ...types)
        : this.db.prepare('SELECT body FROM events WHERE run_id = ? ORDER BY seq').all(runId)
    ) as { body: string }[];
    return rows.map((r) => JSON.parse(r.body) as OrchestrateEvent);
  }

  close(): void {
    this.db.close();
  }
}
