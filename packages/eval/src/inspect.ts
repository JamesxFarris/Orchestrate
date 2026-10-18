import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { filesIn, type Scenario } from './scenario.ts';

/**
 * What a result did besides passing the judge, read from its diff against the starting commit:
 * whether it broke what already worked, whether it stayed on task, how much it changed, and
 * whether it left tests behind. Free: no model is involved.
 */
export interface Quality {
  /** The starting repo's own tests, restored as they were and run against the result. 0 of 0: nothing to run. */
  visible: { passed: number; total: number };
  /** Code files (not tests) the result changed. */
  changedFiles: number;
  /** Changed code files no task needed: the reference plan's write scopes are the yardstick. */
  offScopeFiles: string[];
  /** Lines added plus removed in code files. */
  linesChanged: number;
  /** Test cases added (each new `test(` or `it(` line under test/). */
  testsAdded: number;
}

const GIT = ['-c', 'user.name=eval', '-c', 'user.email=eval@orchestrate.local', '-c', 'core.autocrlf=false'];
const git = (cwd: string, ...args: string[]) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const isTest = (file: string) => file.startsWith('test/');

export function inspect(scenario: Scenario, repo: string, start: string, ref: string | undefined): Quality {
  // a run that produced no code has nothing to inspect
  if (!ref) return { visible: { passed: 0, total: 0 }, changedFiles: 0, offScopeFiles: [], linesChanged: 0, testsAdded: 0 };

  const needed = new Set(scenario.plan.tasks.flatMap((t) => t.writeScope));
  let changedFiles = 0;
  let linesChanged = 0;
  const offScopeFiles: string[] = [];
  for (const line of git(repo, 'diff', '--numstat', start, ref).split('\n').filter(Boolean)) {
    const [added, removed, file] = line.split('\t') as [string, string, string];
    if (isTest(file)) continue;
    changedFiles++;
    linesChanged += (Number(added) || 0) + (Number(removed) || 0);
    if (!needed.has(file)) offScopeFiles.push(file);
  }
  const testsAdded = git(repo, 'diff', '-U0', start, ref, '--', 'test')
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++') && /\b(test|it)\(/.test(l)).length;

  return { visible: visibleAt(scenario, repo, ref, filesIn(path.join(scenario.dir, 'repo', 'test'))), changedFiles, offScopeFiles, linesChanged, testsAdded };
}

/** Run the starting repo's tests, as they were before the run, against the code at `ref`. */
function visibleAt(scenario: Scenario, repo: string, ref: string, tests: string[]): { passed: number; total: number } {
  if (!tests.length) return { passed: 0, total: 0 };
  const dir = path.join(path.dirname(repo), 'visible');
  try {
    git(repo, 'worktree', 'add', '-q', '--detach', dir, ref);
    // a run may have edited or deleted these; put the originals back so they judge the new code
    for (const f of tests) {
      mkdirSync(path.dirname(path.join(dir, 'test', f)), { recursive: true });
      cpSync(path.join(scenario.dir, 'repo', 'test', f), path.join(dir, 'test', f));
    }
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...tests.map((f) => `test/${f}`)], { cwd: dir, encoding: 'utf8', timeout: 120_000 });
    const count = (key: string) => Number(new RegExp(`^# ${key} (\\d+)`, 'm').exec(r.stdout ?? '')?.[1] ?? 0);
    return { passed: count('pass'), total: count('tests') };
  } catch {
    return { passed: 0, total: 0 };
  } finally {
    try {
      git(repo, 'worktree', 'remove', '--force', dir);
    } catch {
      /* already gone */
    }
  }
}
