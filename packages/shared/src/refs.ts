/**
 * A git ref a caller may name as the base of a run: a branch, tag, commit or `HEAD~2`-style
 * expression. It ends up as a git argument, so it must never start with `-` (git would read it as an
 * option, e.g. `--output=<file>` on `git show`), and it carries no whitespace, `:` (git show's
 * path separator), `..` or other characters git refuses in ref names.
 */
export const SAFE_REF = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/@{}~^-]{1,200}$/;

export const isSafeRef = (ref: string): boolean => SAFE_REF.test(ref);
