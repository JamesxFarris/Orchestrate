import path from 'node:path';
import picomatch from 'picomatch';

const caseInsensitiveFs = process.platform === 'win32' || process.platform === 'darwin';

/**
 * Resolve `p` (absolute or relative to `root`, either slash style) to a posix repo-relative path.
 * Returns null when it escapes the root. Returns '' for the root itself.
 */
export function toRepoRelative(root: string, p: string): string | null {
  const absRoot = path.resolve(root);
  const abs = path.resolve(absRoot, p.replace(/\\/g, '/'));
  const rel = path.relative(absRoot, abs);
  if (rel === '') return '';
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

export type PathMatcher = (repoRelative: string) => boolean;

export function matcher(globs: readonly string[], opts: { nocase?: boolean } = {}): PathMatcher {
  if (globs.length === 0) return () => false;
  const isMatch = picomatch([...globs], { dot: true, nocase: opts.nocase ?? caseInsensitiveFs });
  return (rel) => isMatch(rel);
}

/** The literal directory prefix of a glob ("src/game/**\/*.ts" -> "src/game"). */
export function globBase(glob: string): string {
  const { base, isGlob } = picomatch.scan(glob);
  return isGlob ? base : glob;
}

function isGlob(glob: string): boolean {
  return picomatch.scan(glob).isGlob;
}

/** True when `child` is `parent` or sits beneath it (posix, repo-relative; '' is the root). */
export function pathWithin(child: string, parent: string): boolean {
  if (parent === '' || child === parent) return true;
  return child.startsWith(parent.endsWith('/') ? parent : `${parent}/`);
}

/**
 * Conservative check that every path matched by `inner` is also matched by one of `outers`.
 * Exact for literal paths; for globs it requires an outer "dir/**" whose dir contains inner's base.
 */
export function globWithin(inner: string, outers: readonly string[]): boolean {
  if (!isGlob(inner)) return matcher(outers)(inner);
  const innerBase = globBase(inner);
  return outers.some((outer) => {
    if (outer === inner) return true;
    const { base, glob } = picomatch.scan(outer);
    return glob === '**' && pathWithin(innerBase, base);
  });
}

/** Conservative overlap test between two scope lists: any pair whose literal bases nest. */
export function scopesOverlap(a: readonly string[], b: readonly string[]): boolean {
  for (const x of a) {
    for (const y of b) {
      const bx = globBase(x);
      const by = globBase(y);
      if (pathWithin(bx, by) || pathWithin(by, bx)) return true;
    }
  }
  return false;
}
