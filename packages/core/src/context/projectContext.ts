import * as g from '../git/git.ts';

/**
 * Reading the project as committed at a ref, never the working copy: what agents are told about the
 * project (its guide, its decision records) is what they will actually build on, and an uncommitted
 * edit in the user's checkout cannot leak into a run.
 */

/** A file's contents at `ref`, or undefined when it does not exist there. */
export async function gitShow(repoRoot: string, ref: string, file: string): Promise<string | undefined> {
  try {
    return await g.git(repoRoot, ['show', `${ref}:${file}`]);
  } catch {
    return undefined;
  }
}

/** File names directly inside `dir` at `ref` (not recursive); empty when the directory does not exist. */
export async function lsTree(repoRoot: string, ref: string, dir: string): Promise<string[]> {
  const out = await g.git(repoRoot, ['ls-tree', '--name-only', ref, `${dir.replace(/\/+$/, '')}/`]).catch(() => '');
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => p.slice(p.lastIndexOf('/') + 1));
}

/** The project guide agents should follow: `configured` if given ('' turns it off), else AGENTS.md, else CLAUDE.md. */
export async function loadAgentDoc(repoRoot: string, ref: string, configured: string | undefined, maxChars: number): Promise<{ path: string; text: string } | undefined> {
  if (configured === '') return undefined;
  for (const file of configured ? [configured] : ['AGENTS.md', 'CLAUDE.md']) {
    const text = await gitShow(repoRoot, ref, file);
    if (text?.trim()) {
      const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}\n… (truncated; read ${file} for the rest)` : text;
      return { path: file, text: clipped };
    }
  }
  return undefined;
}

/**
 * The decision log for the planner: the newest ADR titles and the next free number, so a design
 * task names its ADR correctly instead of guessing. ADRs are files like 0007-event-bus.md.
 */
export async function adrDigest(repoRoot: string, ref: string, adrDir: string, limit = 20, maxChars = 1200): Promise<{ next: string; lines: string[] }> {
  const adrs = (await lsTree(repoRoot, ref, adrDir)).filter((f) => /^\d{4}-.+\.md$/.test(f)).sort();
  const last = adrs.at(-1);
  const next = String((last ? Number(last.slice(0, 4)) : 0) + 1).padStart(4, '0');
  const lines: string[] = [];
  let used = 0;
  for (const f of adrs.slice(-limit).reverse()) {
    const line = `- ${adrDir}/${f}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return { next, lines };
}
