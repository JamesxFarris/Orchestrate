import picomatch from 'picomatch';
import { matcher, pathWithin, toRepoRelative, type PathMatcher } from './paths.ts';

export const ORCH_MCP_SERVER = 'orch';
export const orchTool = (name: string) => `mcp__${ORCH_MCP_SERVER}__${name}`;

export interface ScopeGuardConfig {
  /** Absolute path of the checkout the agent works in. */
  root: string;
  /** Globs the agent may create or modify. Empty = read-only agent. */
  write: readonly string[];
  /** Globs the agent may read (write and protected paths are implicitly readable). */
  read: readonly string[];
  /** Readable but never writable, even when matched by `write` (e.g. QA's tests during implementation). */
  protected: readonly string[];
  /** Full-match allowlist for Bash commands. Empty = no Bash. */
  bash: readonly RegExp[];
  /** Absolute directories outside the repo that are readable (never writable). */
  externalRead?: readonly string[];
}

export type GuardDecision = { allow: true } | { allow: false; reason: string };

const WRITE_TOOLS: Record<string, string> = {
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
};
const READ_TOOLS: Record<string, string> = { Read: 'file_path', NotebookRead: 'notebook_path' };
/** Tools that list file names. They may look anywhere in the repo: names are not contents. */
const LIST_TOOLS: Record<string, string> = { Glob: 'path', LS: 'path' };
const HARMLESS = new Set(['TodoWrite', 'TodoRead']);

/** Shell control characters that could chain or redirect past the allowlist. */
const SHELL_META = /[;&|`<>\r\n]|\$\(|\$\{/;

export interface ScopeGuard {
  check(toolName: string, input: unknown): GuardDecision;
  readonly config: ScopeGuardConfig;
}

export function createScopeGuard(config: ScopeGuardConfig): ScopeGuard {
  const canWrite = matcher(config.write);
  const isProtected = matcher(config.protected);
  const canRead: PathMatcher = (() => {
    const m = matcher([...config.read, ...config.write, ...config.protected]);
    return (rel) => m(rel);
  })();

  const roots = searchRoots([...config.read, ...config.write, ...config.protected]);
  const inExternal = (raw: string) => (config.externalRead ?? []).some((dir) => toRepoRelative(dir, raw) !== null);
  const writeHint = config.write.length ? config.write.join(', ') : '(nothing — you are read-only)';
  const escalate = `If the task genuinely requires this, call ${orchTool('request_scope_change')} with the paths and your reason, then stop working.`;

  function deny(reason: string): GuardDecision {
    return { allow: false, reason: `DENIED by scope guard: ${reason}` };
  }

  function check(toolName: string, input: unknown): GuardDecision {
    const args = (input ?? {}) as Record<string, unknown>;

    if (toolName.startsWith(`mcp__${ORCH_MCP_SERVER}__`) || HARMLESS.has(toolName)) return { allow: true };

    const writeKey = WRITE_TOOLS[toolName];
    if (writeKey) {
      const raw = args[writeKey];
      if (typeof raw !== 'string' || !raw) return deny(`${toolName} without a path.`);
      const rel = toRepoRelative(config.root, raw);
      if (rel === null || rel === '') return deny(`"${raw}" is outside the repository.`);
      if (isProtected(rel)) {
        return deny(`"${rel}" is protected (acceptance tests or other owned files). Make the code satisfy the tests; do not edit them. ${escalate}`);
      }
      if (!canWrite(rel)) return deny(`"${rel}" is outside your write scope. You may only write: ${writeHint}. ${escalate}`);
      return { allow: true };
    }

    const readKey = READ_TOOLS[toolName];
    if (readKey) {
      const raw = args[readKey];
      if (typeof raw !== 'string' || !raw) return deny(`${toolName} without a path.`);
      const rel = toRepoRelative(config.root, raw);
      if (rel === null) return inExternal(raw) ? { allow: true } : deny(`"${raw}" is outside the repository.`);
      if (!canRead(rel)) return deny(`"${rel}" is outside your read scope (${config.read.join(', ') || 'none'}). ${escalate}`);
      return { allow: true };
    }

    const listKey = LIST_TOOLS[toolName];
    if (listKey) {
      const raw = args[listKey];
      if (raw === undefined || raw === null || raw === '') return { allow: true }; // defaults to cwd = root
      if (typeof raw !== 'string') return deny(`${toolName} with a non-string path.`);
      if (toRepoRelative(config.root, raw) === null && !inExternal(raw)) return deny(`"${raw}" is outside the repository.`);
      return { allow: true };
    }

    // Grep returns file contents, so it gets the read scope: it may search a directory the scope
    // covers entirely, or one readable file.
    if (toolName === 'Grep') {
      const raw = args.path ?? '';
      if (typeof raw !== 'string') return deny('Grep with a non-string path.');
      const rel = toRepoRelative(config.root, raw || '.');
      if (rel === null) return inExternal(raw) ? { allow: true } : deny(`"${raw}" is outside the repository.`);
      if (roots.some((r) => pathWithin(rel, r)) || (rel !== '' && canRead(rel))) return { allow: true };
      const where = roots.length ? roots.map((r) => r || '.').join(', ') : '(no whole directories; Grep single readable files)';
      return deny(`Grep searches file contents, so it must stay in your read scope. Pass path= one of: ${where}. ${escalate}`);
    }

    if (toolName === 'Bash') {
      const command = typeof args.command === 'string' ? args.command.trim() : '';
      if (!command) return deny('empty Bash command.');
      if (config.bash.length === 0) return deny('Bash is not available to your role.');
      if (SHELL_META.test(command)) {
        return deny('command chaining, pipes, redirects and substitutions are not allowed. Run one allowlisted command at a time.');
      }
      if (!config.bash.some((re) => re.test(command))) {
        return deny(`"${command}" is not an allowlisted command. Allowed: ${config.bash.map((r) => r.source).join(' | ')}`);
      }
      return { allow: true };
    }

    return deny(`the ${toolName} tool is not available to your role. Stay within your task contract.`);
  }

  return { check, config };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PATH_ARG = String.raw`[\w@.\/\\:-]+`;

/**
 * Turn a configured gate command into a full-match regex. `{files}` accepts one or more plain path
 * arguments; anything else must match exactly.
 */
export function commandPattern(command: string): RegExp {
  const parts = command.trim().split('{files}').map(escapeRegex);
  const body = parts.join(`${PATH_ARG}(?: ${PATH_ARG})*`);
  return new RegExp(`^${body}$`);
}

/** A path argument for git: plain characters, no ":" (that names a file inside a commit), no "..", no leading "-". */
const GIT_PATH = String.raw`(?!-)(?!(?:[^ ]*/)?\.\.(?:/| |$))[\w@./-]+`;
/** A commit: HEAD, HEAD~n, or a hash. Branch names are left out: they would diff other people's work. */
const GIT_REV = String.raw`(?:HEAD(?:~\d{1,3})?|[0-9a-f]{7,40})`;

/**
 * Read-only git commands every agent may run. None can print file contents beyond the agent's own
 * uncommitted changes: no "git show <rev>:<path>", no "git log -p", no
 * "git diff --no-index <any file> <any file>", no "--output=" writes.
 */
export const GIT_READONLY: readonly RegExp[] = [
  /^git status(?: (?:-s|-sb|--short|--branch|--porcelain))*$/,
  // your own changes, optionally limited to paths after "--"
  new RegExp(String.raw`^git diff(?: (?:--stat|--shortstat|--name-only|--name-status|--cached|--staged|HEAD))*(?: --(?: ${GIT_PATH})+)?$`),
  // history as names and stats, never patches
  /^git log(?: (?:--oneline|--stat|--name-only|--name-status|--no-color|-n ?\d{1,3}|-\d{1,3}))*$/,
  // a commit's summary: --stat or --name-only is required, or it prints the whole patch
  new RegExp(String.raw`^git show(?=.* --(?:stat|name-only)(?: |$))(?: (?:--stat|--name-only|--name-status|--oneline|--no-color))+(?: ${GIT_REV})?$`),
];

/**
 * Directories a scope covers entirely ("src/game/**" -> "src/game", "**" -> the repo root ''), so
 * every file a search there could return is readable. Narrower globs ("src/**\/*.ts") are not roots.
 */
export function searchRoots(globs: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const g of globs) {
    const { base, glob, isGlob } = picomatch.scan(g);
    if (isGlob && (glob === '**' || glob === '**/*')) roots.add(base);
  }
  return [...roots];
}
