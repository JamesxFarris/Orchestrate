import path from 'node:path';
import { runCommand } from '../gates/gates.ts';
import * as g from '../git/git.ts';

/**
 * Shipping lands a finished run's branch on the default branch. All the risky work (the merge, and a
 * re-test when the target moved) happens in a scratch worktree; the target then moves in one step
 * that cannot half-happen: a fast-forward where it is checked out, a compare-and-swap ref update
 * where it is not. Any refusal leaves the target, the user's working copy and the run branch as
 * they were.
 */

export interface ShipRequest {
  repoRoot: string;
  runId: string;
  /** orch/run-<id> */
  branch: string;
  /** The default branch, e.g. main. */
  target: string;
  /** Where the scratch worktree goes. */
  workDir: string;
  /** Dirs (node_modules…) linked into the scratch worktree so the full suite can run there. */
  links: readonly string[];
  /** The team's full-suite command; run only when the target moved since the run started. */
  fullGate?: string;
  timeoutMs: number;
  message: string;
  signal?: AbortSignal;
}

export type ShipFailure = 'not-ready' | 'incomplete' | 'missing-branch' | 'conflict' | 'tests-failed' | 'target-moved' | 'local-changes';

export type ShipResult =
  | { ok: true; sha: string; alreadyShipped: boolean; tested: boolean }
  | { ok: false; reason: ShipFailure; message: string; output?: string };

const fail = (reason: ShipFailure, message: string, output?: string): ShipResult => ({ ok: false, reason, message, output });
const outputOf = (err: unknown) => (err instanceof g.GitError ? err.output : String(err));

export async function shipRun(req: ShipRequest): Promise<ShipResult> {
  const { repoRoot, branch, target } = req;
  let tip: string;
  try {
    tip = await g.revParse(repoRoot, branch);
  } catch {
    return fail('missing-branch', `The branch ${branch} no longer exists. If you merged it some other way, mark the project as shipped instead.`);
  }

  const before = await g.revParse(repoRoot, target);
  if (await g.isAncestor(repoRoot, tip, before)) {
    await deleteRunBranches(repoRoot, req.runId, branch);
    return { ok: true, sha: before, alreadyShipped: true, tested: false };
  }
  // If the target has not moved since the run branched off, the merge result is exactly what the
  // run's gates already tested.
  const moved = (await g.mergeBase(repoRoot, tip, before)) !== before;

  const scratch: g.Worktree = { dir: path.join(req.workDir, req.runId, '_ship'), branch: `orch/ship-${req.runId}` };
  // A ship that crashed part-way leaves its scratch worktree and branch behind; clear them, or
  // every retry fails with "already exists".
  await cleanUp(repoRoot, scratch, req.links);
  try {
    await g.addWorktree(repoRoot, scratch.dir, scratch.branch, before, req.links);
    try {
      await g.git(scratch.dir, [...(await g.userIdentity(repoRoot)), 'merge', '--no-ff', '-m', req.message, tip]);
    } catch (err) {
      await g.git(scratch.dir, ['merge', '--abort']).catch(() => undefined);
      return fail('conflict', `${branch} conflicts with changes made on ${target} since the project started. Nothing was changed.`, outputOf(err));
    }

    if (moved && req.fullGate) {
      const r = await runCommand(req.fullGate, scratch.dir, req.timeoutMs, req.signal);
      if (!r.ok) return fail('tests-failed', `${target} changed since the project started, and the combined code fails the full test suite. Nothing was changed.`, r.output);
    }
    const merged = await g.head(scratch.dir);

    if ((await g.revParse(repoRoot, target)) !== before) return fail('target-moved', `${target} changed while shipping. Try again.`);
    const checkout = await g.checkoutOf(repoRoot, target);
    if (checkout) {
      try {
        // A fast-forward never combines anything, and git refuses rather than overwrite local edits.
        await g.git(checkout, ['merge', '--ff-only', merged]);
      } catch (err) {
        return fail('local-changes', `You have uncommitted changes in ${checkout} to files this project changes. Commit or stash them, then ship again.`, outputOf(err));
      }
    } else {
      try {
        await g.git(repoRoot, ['update-ref', `refs/heads/${target}`, merged, before]);
      } catch (err) {
        return fail('target-moved', `${target} changed while shipping. Try again.`, outputOf(err));
      }
    }

    await deleteRunBranches(repoRoot, req.runId, branch);
    return { ok: true, sha: merged, alreadyShipped: false, tested: moved && !!req.fullGate };
  } finally {
    // Never let cleanup turn the result around: by now the target may already have moved, and on
    // Windows a file still held open (a test process) makes removing the folder throw.
    await cleanUp(repoRoot, scratch, req.links);
  }
}

async function cleanUp(repoRoot: string, scratch: g.Worktree, links: readonly string[]): Promise<void> {
  await g.removeWorktree(repoRoot, scratch, links).catch(() => undefined);
  await g.git(repoRoot, ['branch', '-D', scratch.branch]).catch(() => undefined);
}

/** Every commit is in the target's history now, so the run's branches are just clutter. */
async function deleteRunBranches(repoRoot: string, runId: string, branch: string): Promise<void> {
  const tasks = await g.git(repoRoot, ['branch', '--list', `orch/${runId}/*`, '--format=%(refname:short)']).catch(() => '');
  for (const b of [branch, ...tasks.split('\n').map((s) => s.trim()).filter(Boolean)]) {
    await g.git(repoRoot, ['branch', '-D', b]).catch(() => undefined);
  }
}

/**
 * Runs whose final commit is already in the target: merged outside Orchestrate. Squash and rebase
 * merges rewrite commits, so they are not seen here; those get marked as shipped by hand.
 */
export async function detectShipped(repoRoot: string, target: string, candidates: readonly { runId: string; head: string }[]): Promise<string[]> {
  const shipped: string[] = [];
  for (const c of candidates) if (await g.isAncestor(repoRoot, c.head, target)) shipped.push(c.runId);
  return shipped;
}
