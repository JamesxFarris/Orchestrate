import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addWorktree, changedFiles, commitAll, removeWorktree } from '../src/git/git.ts';
import { Integration } from '../src/pipeline/context.ts';
import { makeFixtureRepo, sh } from './helpers.ts';

let roots: string[] = [];
afterEach(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
  roots = [];
});

describe('worktrees with linked dirs', () => {
  it('shares node_modules into a worktree and never deletes through the link', async () => {
    const fx = makeFixtureRepo();
    roots.push(fx.root);
    writeFileSync(path.join(fx.repo, '.gitignore'), 'node_modules/\n');
    sh(fx.repo, 'add', '.gitignore');
    sh(fx.repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'ignore');
    const dep = path.join(fx.repo, 'node_modules', 'dep');
    mkdirSync(dep, { recursive: true });
    writeFileSync(path.join(dep, 'index.js'), 'precious');

    const wt = await addWorktree(fx.repo, path.join(fx.work, 'wt'), 'orch/test', 'main', ['node_modules']);
    expect(readFileSync(path.join(wt.dir, 'node_modules', 'dep', 'index.js'), 'utf8')).toBe('precious');

    // the link is gitignored, so it never shows up as a change
    writeFileSync(path.join(wt.dir, 'src', 'new.js'), 'x');
    await commitAll(wt.dir, 'add');
    expect(await changedFiles(wt.dir, 'main')).toEqual(['src/new.js']);

    await removeWorktree(fx.repo, wt, ['node_modules']);
    expect(existsSync(wt.dir)).toBe(false);
    expect(readFileSync(path.join(dep, 'index.js'), 'utf8')).toBe('precious');
  });
});

describe('integration branch', () => {
  it('never hands out an unverified merge as the base for a new task', async () => {
    const fx = makeFixtureRepo();
    roots.push(fx.root);
    const integration = new Integration(fx.repo, 'r1', fx.work, []);
    await integration.init('main', { test: 'true', timeoutMs: 10_000 }, new AbortController().signal);
    const verified = await integration.head();

    // a task branch whose merge will fail the full suite
    sh(fx.repo, 'switch', '-q', '-c', 'orch/task-a', 'main');
    writeFileSync(path.join(fx.repo, 'src', 'broken.js'), 'oops');
    sh(fx.repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
    sh(fx.repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'broken');
    sh(fx.repo, 'switch', '-q', 'main');

    let finishSuite!: () => void;
    const suite = new Promise<void>((r) => (finishSuite = r));
    const merging = integration.mergeVerified('orch/task-a', 'merge a', async () => {
      await suite;
      return { ok: false, code: 1, output: 'regression', timedOut: false };
    });

    // another task asks for its base while the suite is still running
    let base: string | undefined;
    const asking = integration.head().then((h) => (base = h));
    await new Promise((r) => setTimeout(r, 300));
    expect(base).toBeUndefined(); // it waits rather than branching from the unverified merge

    finishSuite();
    expect(await merging).toMatchObject({ ok: false, reason: 'regression' });
    await asking;
    expect(base).toBe(verified); // the rolled-back, verified commit
    await integration.dispose();
  });
});
