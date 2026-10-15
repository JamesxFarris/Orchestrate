import { spawn } from 'node:child_process';
import type { GateConfig } from '@orchestrate/shared';
import { matcher } from '../scope/paths.ts';

export interface CommandResult {
  ok: boolean;
  code: number | null;
  output: string;
  timedOut: boolean;
}

const MAX_OUTPUT = 8_000;

function tail(s: string, n = MAX_OUTPUT): string {
  return s.length > n ? `…${s.slice(-n)}` : s;
}

/** Variables that look like credentials: provider keys, tokens, secrets, passwords. */
const SECRET_ENV = /^(ANTHROPIC|CLAUDE|OPENAI|AWS|AZURE|GOOGLE|GCP)_|(_TOKEN|_KEY|_SECRET|_PASSWORD|_CREDENTIALS?)$|^(GH_TOKEN|GITHUB_TOKEN|NPM_TOKEN)$/i;

/**
 * The environment gate commands run with. They execute code agents wrote (tests, setup scripts),
 * so credentials are left out: an agent could otherwise read the API key from inside a test.
 * `ORCH_GATE_ENV_KEEP=NAME,NAME` lets named variables through (e.g. a private registry token).
 */
export function gateEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const keep = new Set((env.ORCH_GATE_ENV_KEEP ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (keep.has(k) || !SECRET_ENV.test(k)) out[k] = v;
  return { ...out, CI: '1', FORCE_COLOR: '0' };
}

/** Run a shell command; output is stdout+stderr interleaved, tail-truncated. */
export function runCommand(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<CommandResult> {
  // an abort listener added to an already-aborted signal never fires, so the command would run to its timeout
  if (signal?.aborted) return Promise.resolve({ ok: false, code: null, output: 'cancelled before it started', timedOut: false });
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true, env: gateEnv() });
    let out = '';
    let timedOut = false;
    const onData = (b: Buffer) => {
      out += b.toString();
      if (out.length > MAX_OUTPUT * 4) out = out.slice(-MAX_OUTPUT * 2);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const kill = () => {
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
      else child.kill('SIGKILL');
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    signal?.addEventListener('abort', kill, { once: true });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, output: String(err), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', kill);
      resolve({ ok: code === 0 && !timedOut, code, output: tail(out), timedOut });
    });
  });
}

/**
 * A path that is safe to paste into a shell command on any platform: no spaces, quotes, `$`, `&`,
 * `;`, `|`, `%`, globs or `..`, and no leading `-` (it would be read as a flag).
 */
export function isShellSafePath(p: string): boolean {
  return /^[A-Za-z0-9_@./-]+$/.test(p) && !p.startsWith('-') && !p.split('/').includes('..');
}

/** The test command for a task's own test files. Plan validation already refuses unsafe paths; this refuses them again. */
export function testFilesCommand(gates: GateConfig, files: readonly string[]): string {
  if (!gates.testFiles) return gates.test;
  const unsafe = files.find((f) => !isShellSafePath(f));
  if (unsafe !== undefined) throw new Error(`refusing to run tests: unsafe test file path ${JSON.stringify(unsafe)}`);
  return gates.testFiles.replace('{files}', () => files.join(' '));
}

export interface AuditInput {
  changed: readonly string[];
  allowed: readonly string[];
  /** Files that must not appear in `changed`. */
  forbidden?: readonly string[];
  changedLines?: number;
  maxChangedLines?: number;
}

/** Post-hoc check of what actually changed on disk, independent of what the agent's tools claimed. */
export function auditChanges(a: AuditInput): string[] {
  const problems: string[] = [];
  const allowed = matcher(a.allowed);
  const forbidden = matcher(a.forbidden ?? []);
  for (const f of a.changed) {
    if (forbidden(f)) problems.push(`modified protected file ${f}`);
    else if (!allowed(f)) problems.push(`modified ${f}, which is outside the write scope`);
  }
  if (a.maxChangedLines !== undefined && a.changedLines !== undefined && a.changedLines > a.maxChangedLines) {
    problems.push(`changed ${a.changedLines} lines; the cap for this task is ${a.maxChangedLines}`);
  }
  return problems;
}
