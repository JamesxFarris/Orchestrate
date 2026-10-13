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

/** Run a shell command; output is stdout+stderr interleaved, tail-truncated. */
export function runCommand(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } });
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

export function testFilesCommand(gates: GateConfig, files: readonly string[]): string {
  return gates.testFiles ? gates.testFiles.replace('{files}', files.join(' ')) : gates.test;
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
