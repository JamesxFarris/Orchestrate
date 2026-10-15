import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectShipped, shipRun, type ShipRequest } from '../src/ship/ship.ts';
import { makeFixtureRepo, sh } from './helpers.ts';

let roots: string[] = [];
afterEach(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
  roots = [];
});

const PASS = 'node -e "process.exit(0)"';
const FAIL = 'node -e "process.exit(1)"';

function setup() {
  const fx = makeFixtureRepo();
  roots.push(fx.root);
  sh(fx.repo, 'config', 'user.name', 'Tester');
  sh(fx.repo, 'config', 'user.email', 'tester@example.com');
  return fx;
}

function commit(repo: string, files: Record<string, string>, message: string) {
  for (const [file, content] of Object.entries(files)) writeFileSync(path.join(repo, file), content);
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-q', '-m', message);
}

/** What a finished run leaves behind: orch/run-<id> plus a per-task branch, with main checked out again. */
function runBranch(repo: string, runId: string, files: Record<string, string>) {
  sh(repo, 'checkout', '-q', '-b', `orch/run-${runId}`);
  commit(repo, files, `task work for ${runId}`);
  sh(repo, 'branch', `orch/${runId}/t1`);
  sh(repo, 'checkout', '-q', 'main');
}

const request = (fx: { repo: string; work: string }, runId: string, over: Partial<ShipRequest> = {}): ShipRequest => ({
  repoRoot: fx.repo,
  runId,
  branch: `orch/run-${runId}`,
  target: 'main',
  workDir: fx.work,
  links: [],
  timeoutMs: 60_000,
  message: `Ship orch/run-${runId}`,
  ...over,
});

const branches = (repo: string) => sh(repo, 'branch', '--format=%(refname:short)').split('\n').filter(Boolean).sort();
const worktrees = (repo: string) => sh(repo, 'worktree', 'list').split('\n').filter(Boolean).length;
const read = (repo: string, file: string) => readFileSync(path.join(repo, file), 'utf8');

describe('shipRun', () => {
  it('merges the run into main as a merge commit by the user, then deletes the run branches', async () => {
    const fx = setup();
    runBranch(fx.repo, 'r1', { 'src/feature.js': 'export const feature = true;\n' });

    const res = await shipRun(request(fx, 'r1'));

    expect(res).toMatchObject({ ok: true, alreadyShipped: false, tested: false });
    const main = sh(fx.repo, 'rev-parse', 'main');
    expect(res.ok && res.sha).toBe(main);
    expect(sh(fx.repo, 'rev-list', '--parents', '-n', '1', 'main').split(' ')).toHaveLength(3); // a real merge: two parents
    expect(sh(fx.repo, 'log', '-1', '--format=%an <%ae>', 'main')).toBe('Tester <tester@example.com>');
    expect(read(fx.repo, 'src/feature.js')).toContain('feature'); // the checked-out working copy moved too
    expect(branches(fx.repo)).toEqual(['main']);
    expect(worktrees(fx.repo)).toBe(1); // scratch copy cleaned up
  });

  it('keeps uncommitted edits to files the run did not touch', async () => {
    const fx = setup();
    runBranch(fx.repo, 'r1', { 'src/feature.js': 'export const feature = true;\n' });
    writeFileSync(path.join(fx.repo, 'package.json'), '{ "name": "game", "edited": true }\n');

    expect(await shipRun(request(fx, 'r1'))).toMatchObject({ ok: true });
    expect(read(fx.repo, 'package.json')).toContain('"edited": true');
    expect(read(fx.repo, 'src/feature.js')).toContain('feature');
  });

  it('refuses, changing nothing, when uncommitted edits touch files the run changed', async () => {
    const fx = setup();
    runBranch(fx.repo, 'r1', { 'src/core.js': 'export const VERSION = 2;\n' });
    const before = sh(fx.repo, 'rev-parse', 'main');
    writeFileSync(path.join(fx.repo, 'src', 'core.js'), 'export const VERSION = 99; // mine\n');

    expect(await shipRun(request(fx, 'r1'))).toMatchObject({ ok: false, reason: 'local-changes' });
    expect(sh(fx.repo, 'rev-parse', 'main')).toBe(before);
    expect(read(fx.repo, 'src/core.js')).toContain('99; // mine');
    expect(branches(fx.repo)).toContain('orch/run-r1');
    expect(worktrees(fx.repo)).toBe(1);
  });

  it('refuses on a merge conflict without touching main or leaving scratch behind', async () => {
    const fx = setup();
    runBranch(fx.repo, 'r1', { 'src/core.js': 'export const VERSION = 2;\n' });
    commit(fx.repo, { 'src/core.js': 'export const VERSION = 3;\n' }, 'meanwhile on main');
    const before = sh(fx.repo, 'rev-parse', 'main');

    const res = await shipRun(request(fx, 'r1'));

    expect(res).toMatchObject({ ok: false, reason: 'conflict' });
    expect(sh(fx.repo, 'rev-parse', 'main')).toBe(before);
    expect(branches(fx.repo)).toEqual(['main', 'orch/r1/t1', 'orch/run-r1']);
    expect(worktrees(fx.repo)).toBe(1);
  });

  it('re-runs the full suite when main moved, and ships only if it passes', async () => {
    const fx = setup();
    runBranch(fx.repo, 'r1', { 'src/feature.js': 'export const feature = true;\n' });
    commit(fx.repo, { 'src/other.js': 'export const other = 1;\n' }, 'meanwhile on main');
    const before = sh(fx.repo, 'rev-parse', 'main');

    expect(await shipRun(request(fx, 'r1', { fullGate: FAIL }))).toMatchObject({ ok: false, reason: 'tests-failed' });
    expect(sh(fx.repo, 'rev-parse', 'main')).toBe(before);

    expect(await shipRun(request(fx, 'r1', { fullGate: PASS }))).toMatchObject({ ok: true, tested: true });
    expect(read(fx.repo, 'src/feature.js')).toContain('feature');
  });

  it('skips the re-test when main has not moved: the merged result is exactly what was tested', async () => {
    const fx = setup();
    runBranch(fx.repo, 'r1', { 'src/feature.js': 'export const feature = true;\n' });
    expect(await shipRun(request(fx, 'r1', { fullGate: FAIL }))).toMatchObject({ ok: true, tested: false });
  });

  it('moves main safely when it is not checked out anywhere', async () => {
    const fx = setup();
    runBranch(fx.repo, 'r1', { 'src/feature.js': 'export const feature = true;\n' });
    sh(fx.repo, 'checkout', '-q', '-b', 'elsewhere');

    const res = await shipRun(request(fx, 'r1'));

    expect(res).toMatchObject({ ok: true });
    expect(sh(fx.repo, 'rev-parse', 'main')).toBe(res.ok ? res.sha : '');
    expect(sh(fx.repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('elsewhere');
  });

  it('reports a run that is already in main as shipped, and still tidies its branches', async () => {
    const fx = setup();
    runBranch(fx.repo, 'r1', { 'src/feature.js': 'export const feature = true;\n' });
    sh(fx.repo, 'merge', '-q', '--no-ff', '-m', 'merged by hand', 'orch/run-r1');

    expect(await shipRun(request(fx, 'r1'))).toMatchObject({ ok: true, alreadyShipped: true });
    expect(branches(fx.repo)).toEqual(['main']);
  });

  it('recovers from a ship that crashed part-way and left its scratch worktree behind', async () => {
    const fx = setup();
    runBranch(fx.repo, 'r1', { 'src/feature.js': 'export const feature = true;\n' });
    sh(fx.repo, 'worktree', 'add', '-q', '-b', 'orch/ship-r1', path.join(fx.work, 'r1', '_ship'), 'main');

    const res = await shipRun(request(fx, 'r1'));
    expect(res).toMatchObject({ ok: true });
    expect(worktrees(fx.repo)).toBe(1);
    expect(branches(fx.repo)).toEqual(['main']);
  });

  it('explains a missing branch', async () => {
    const fx = setup();
    expect(await shipRun(request(fx, 'nope'))).toMatchObject({ ok: false, reason: 'missing-branch' });
  });
});

describe('detectShipped', () => {
  it('spots runs merged by hand, but not squashed ones', async () => {
    const fx = setup();
    runBranch(fx.repo, 'merged', { 'src/a.js': 'a\n' });
    runBranch(fx.repo, 'squashed', { 'src/b.js': 'b\n' });
    runBranch(fx.repo, 'waiting', { 'src/c.js': 'c\n' });
    const head = (runId: string) => sh(fx.repo, 'rev-parse', `orch/run-${runId}`);
    const candidates = ['merged', 'squashed', 'waiting'].map((runId) => ({ runId, head: head(runId) }));

    sh(fx.repo, 'merge', '-q', '--no-ff', '-m', 'merge', 'orch/run-merged');
    sh(fx.repo, 'merge', '-q', '--squash', 'orch/run-squashed');
    sh(fx.repo, 'commit', '-q', '-m', 'squash');

    expect(await detectShipped(fx.repo, 'main', candidates)).toEqual(['merged']);
  });
});
