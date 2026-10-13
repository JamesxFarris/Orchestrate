import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addWorktree, changedFiles, commitAll, removeWorktree } from '../src/git/git.ts';
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
