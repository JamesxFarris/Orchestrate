import { execFile } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { isSafeRef } from '@orchestrate/shared';

const execFileP = promisify(execFile);

const IDENTITY = ['-c', 'user.name=Orchestrate', '-c', 'user.email=orchestrate@localhost', '-c', 'commit.gpgsign=false'];

export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly output: string,
  ) {
    super(`git ${args.join(' ')} failed: ${output.trim().slice(0, 2000)}`);
  }
}

export async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileP('git', [...IDENTITY, ...args], { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    return stdout;
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    throw new GitError(args, `${e.stderr ?? ''}${e.stdout ?? ''}` || e.message);
  }
}

export async function head(cwd: string): Promise<string> {
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim();
}

/** Refuses a ref git would read as an option or a path; see SAFE_REF. */
export function assertSafeRef(ref: string): string {
  if (!isSafeRef(ref)) throw new GitError(['rev-parse', ref], `not a valid ref: ${JSON.stringify(ref.slice(0, 80))}`);
  return ref;
}

export async function revParse(cwd: string, ref: string): Promise<string> {
  assertSafeRef(ref);
  return (await git(cwd, ['rev-parse', '--verify', `${ref}^{commit}`])).trim();
}

export async function isClean(cwd: string): Promise<boolean> {
  return (await git(cwd, ['status', '--porcelain'])).trim() === '';
}

/** True when `ancestor` is reachable from `descendant`, i.e. that work is already in it. */
export async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  try {
    await git(cwd, ['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

export async function mergeBase(cwd: string, a: string, b: string): Promise<string> {
  return (await git(cwd, ['merge-base', a, b])).trim();
}

/** The directory of the worktree that has `branch` checked out, if any. */
export async function checkoutOf(repoRoot: string, branch: string): Promise<string | undefined> {
  const out = await git(repoRoot, ['worktree', 'list', '--porcelain']);
  for (const block of out.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const dir = lines.find((l) => l.startsWith('worktree '))?.slice('worktree '.length);
    if (dir && lines.includes(`branch refs/heads/${branch}`)) return dir;
  }
  return undefined;
}

/**
 * `-c` flags that make a commit carry the user's own git identity, for actions the user takes (like
 * shipping). Read without IDENTITY, which would otherwise answer "Orchestrate". Empty if unset.
 */
export async function userIdentity(cwd: string): Promise<string[]> {
  const read = (key: string) =>
    execFileP('git', ['config', '--get', key], { cwd, windowsHide: true }).then(
      (r) => r.stdout.trim(),
      () => '',
    );
  const [name, email] = await Promise.all([read('user.name'), read('user.email')]);
  return name && email ? ['-c', `user.name=${name}`, '-c', `user.email=${email}`] : [];
}

/** Junction (Windows) / symlink shared directories like node_modules into a worktree. */
export function linkDirs(repoRoot: string, worktree: string, dirs: readonly string[]): void {
  for (const d of dirs) {
    const src = path.join(repoRoot, d);
    const dst = path.join(worktree, d);
    if (!existsSync(src) || existsSync(dst)) continue;
    mkdirSync(path.dirname(dst), { recursive: true });
    symlinkSync(src, dst, process.platform === 'win32' ? 'junction' : 'dir');
  }
}

/** Remove only the links, never their targets. */
export function unlinkDirs(worktree: string, dirs: readonly string[]): void {
  for (const d of dirs) {
    const dst = path.join(worktree, d);
    try {
      if (lstatSync(dst).isSymbolicLink()) unlinkSync(dst);
    } catch {
      /* not present */
    }
  }
}

export interface Worktree {
  dir: string;
  branch: string;
}

/** Create a worktree on a new branch starting at `from`. */
export async function addWorktree(repoRoot: string, dir: string, branch: string, from: string, links: readonly string[]): Promise<Worktree> {
  mkdirSync(path.dirname(dir), { recursive: true });
  await git(repoRoot, ['worktree', 'add', '-B', branch, dir, from]);
  linkDirs(repoRoot, dir, links);
  return { dir, branch };
}

export async function removeWorktree(repoRoot: string, wt: Worktree, links: readonly string[]): Promise<void> {
  unlinkDirs(wt.dir, links);
  try {
    await git(repoRoot, ['worktree', 'remove', '--force', wt.dir]);
  } catch {
    rmSync(wt.dir, { recursive: true, force: true });
    await git(repoRoot, ['worktree', 'prune']).catch(() => undefined);
  }
}

/** Stage everything and commit. Returns false when there was nothing to commit. */
export async function commitAll(cwd: string, message: string, exclude: readonly string[] = []): Promise<boolean> {
  await git(cwd, ['add', '-A', '--', '.', ...exclude.map((d) => `:(exclude)${d}`)]);
  if ((await git(cwd, ['diff', '--cached', '--name-only'])).trim() === '') return false;
  await git(cwd, ['commit', '--no-verify', '-m', message]);
  return true;
}

export async function changedFiles(cwd: string, base: string, headRef = 'HEAD'): Promise<string[]> {
  const out = await git(cwd, ['diff', '--name-only', '--no-renames', `${base}..${headRef}`]);
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

export async function changedLines(cwd: string, base: string, headRef = 'HEAD', exclude: readonly string[] = []): Promise<number> {
  const out = await git(cwd, ['diff', '--numstat', '--no-renames', `${base}..${headRef}`]);
  let total = 0;
  for (const line of out.split('\n')) {
    const [add, del, file] = line.split('\t');
    if (!file || exclude.includes(file)) continue;
    total += (Number(add) || 0) + (Number(del) || 0);
  }
  return total;
}

export async function diffText(cwd: string, base: string, maxChars = 60_000): Promise<string> {
  const out = await git(cwd, ['diff', '--no-renames', `${base}..HEAD`]);
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n… [diff truncated at ${maxChars} chars]` : out;
}

export async function resetHard(cwd: string, ref: string): Promise<void> {
  await git(cwd, ['reset', '--hard', ref]);
  await git(cwd, ['clean', '-fd']);
}

/** Merge `branch` into the worktree's current branch. On conflict the merge is aborted and false returned. */
export async function merge(cwd: string, branch: string, message: string): Promise<{ ok: true } | { ok: false; output: string }> {
  try {
    await git(cwd, ['merge', '--no-ff', '-m', message, branch]);
    return { ok: true };
  } catch (err) {
    await git(cwd, ['merge', '--abort']).catch(() => undefined);
    return { ok: false, output: err instanceof GitError ? err.output : String(err) };
  }
}
