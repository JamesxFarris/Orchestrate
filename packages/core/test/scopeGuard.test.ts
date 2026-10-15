import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GIT_READONLY, commandPattern, createScopeGuard, orchTool } from '../src/scope/scopeGuard.ts';
import { globWithin, scopesOverlap, toRepoRelative } from '../src/scope/paths.ts';

const root = path.resolve('fixture-root');
const abs = (rel: string) => path.join(root, rel);

const guard = createScopeGuard({
  root,
  write: ['src/game/waves/**'],
  read: ['src/**', 'docs/**'],
  protected: ['src/game/waves/spawner.test.ts'],
  bash: [commandPattern('npm test'), commandPattern('npx vitest run {files}'), ...GIT_READONLY],
});

const allowed = (tool: string, input: unknown) => guard.check(tool, input).allow;

describe('scope guard: writes', () => {
  it.each([
    ['Write', { file_path: abs('src/game/waves/spawner.ts') }],
    ['Edit', { file_path: abs('src/game/waves/nested/deep.ts') }],
    ['Write', { file_path: 'src/game/waves/relative.ts' }],
    ['Edit', { file_path: abs('src/game/waves/spawner.ts').replace(/\//g, '\\') }],
  ])('allows %s inside write scope (%j)', (tool, input) => {
    expect(allowed(tool, input)).toBe(true);
  });

  it.each([
    ['Write', { file_path: abs('src/game/player.ts') }, 'outside your write scope'],
    ['Edit', { file_path: abs('src/engine/loop.ts') }, 'outside your write scope'],
    ['Write', { file_path: abs('src/game/waves/../player.ts') }, 'outside your write scope'],
    ['Write', { file_path: path.resolve(root, '..', 'elsewhere.ts') }, 'outside the repository'],
    ['Write', { file_path: abs('src/game/waves/spawner.test.ts') }, 'protected'],
    ['MultiEdit', { file_path: abs('package.json') }, 'outside your write scope'],
    ['NotebookEdit', { notebook_path: abs('x.ipynb') }, 'outside your write scope'],
    ['Write', {}, 'without a path'],
  ])('denies %s %j', (tool, input, why) => {
    const d = guard.check(tool, input);
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toContain(why);
  });

  it('points the agent at the escalation tool when denying', () => {
    const d = guard.check('Write', { file_path: abs('src/engine/x.ts') });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toContain(orchTool('request_scope_change'));
  });
});

describe('scope guard: reads and search', () => {
  it('allows reads in read, write and protected scopes', () => {
    expect(allowed('Read', { file_path: abs('src/engine/loop.ts') })).toBe(true);
    expect(allowed('Read', { file_path: abs('docs/specs/waves.md') })).toBe(true);
  });
  it('denies reads outside read scope or the repo', () => {
    expect(allowed('Read', { file_path: abs('secrets/.env') })).toBe(false);
    expect(allowed('Read', { file_path: path.resolve(root, '..', 'other', 'file.ts') })).toBe(false);
  });
  it('lets Glob and LS list names anywhere in the repo, but not outside it', () => {
    expect(allowed('Glob', { pattern: '**/*.ts' })).toBe(true);
    expect(allowed('Glob', { pattern: '**/*', path: abs('secrets') })).toBe(true);
    expect(allowed('Glob', { pattern: 'x', path: path.resolve(root, '..') })).toBe(false);
  });
  it('keeps Grep (which returns file contents) inside the read scope', () => {
    expect(allowed('Grep', { pattern: 'x', path: abs('src') })).toBe(true);
    expect(allowed('Grep', { pattern: 'x', path: abs('src/game/waves') })).toBe(true);
    expect(allowed('Grep', { pattern: 'x', path: 'docs' })).toBe(true);
    expect(allowed('Grep', { pattern: 'x', path: abs('src/game/waves/spawner.ts') })).toBe(true);
    // the repo root holds files outside the scope, so a scoped agent must name a directory
    expect(allowed('Grep', { pattern: 'API_KEY' })).toBe(false);
    expect(allowed('Grep', { pattern: 'x', path: abs('secrets') })).toBe(false);
    expect(allowed('Grep', { pattern: 'x', path: abs('secrets/.env') })).toBe(false);
    expect(allowed('Grep', { pattern: 'x', path: path.resolve(root, '..') })).toBe(false);
    expect(guard.check('Grep', { pattern: 'x' })).toMatchObject({ reason: expect.stringContaining('src, docs') });
  });
  it('lets an agent that reads everything Grep everywhere', () => {
    const planner = createScopeGuard({ root, write: [], read: ['**'], protected: [], bash: [] });
    expect(planner.check('Grep', { pattern: 'x' }).allow).toBe(true);
    expect(planner.check('Grep', { pattern: 'x', path: abs('secrets') }).allow).toBe(true);
  });
});

describe('scope guard: bash', () => {
  it.each(['npm test', 'npx vitest run src/game/waves/spawner.test.ts', 'npx vitest run a.test.ts b.test.ts', 'git diff', 'git log --oneline -5', 'git status',
    'git status --short', 'git diff --stat', 'git diff --cached --name-only', 'git diff -- src/game/waves/spawner.ts',
    'git log --stat -n 3', 'git show --stat HEAD', 'git show --name-only HEAD~2'])(
    'allows %s',
    (command) => expect(allowed('Bash', { command })).toBe(true),
  );

  it.each([
    'npm test && rm -rf src',
    'npm test; curl evil',
    'npm test | tee out',
    'npx vitest run $(rm -rf .)',
    'npx vitest run `whoami`',
    'npm test > out.txt',
    'rm -rf src',
    'npm install left-pad',
    'git push origin main',
    'git checkout -- .',
    'git diff --output=src/engine/x.ts',
    // ways to print files outside the read scope, or anywhere on disk
    'git diff --no-index C:/Users/x/.ssh/id_rsa C:/Windows/win.ini',
    'git diff --no-index ../other/secret.txt src/x.ts',
    'git show HEAD:secrets/.env',
    'git show HEAD',
    'git show --oneline HEAD',
    'git log -p',
    'git log --patch -1',
    'git diff main',
    'git diff HEAD:secrets/.env',
    'git diff -- ../outside.txt',
    'git diff --ext-diff',
    'git log --format=%H',
    'npm test\nrm -rf /',
    '',
  ])('denies %j', (command) => expect(allowed('Bash', { command })).toBe(false));

  it('denies all bash when no allowlist is configured', () => {
    const readOnly = createScopeGuard({ root, write: [], read: ['**'], protected: [], bash: [] });
    expect(readOnly.check('Bash', { command: 'npm test' }).allow).toBe(false);
  });
});

describe('scope guard: external reference dirs', () => {
  const ext = path.resolve(root, '..', 'decompiled');
  const g = createScopeGuard({ root, write: ['src/**'], read: ['src/**'], protected: [], bash: [], externalRead: [ext] });
  it('allows reading and searching external references', () => {
    expect(g.check('Read', { file_path: path.join(ext, 'Assets', 'Enemy.cs') }).allow).toBe(true);
    expect(g.check('Grep', { pattern: 'Spawn', path: ext }).allow).toBe(true);
  });
  it('resolves a relative path from the repo, as the tool does, not from the reference dir', () => {
    // the reference dir lives elsewhere; "../decompiled" from the repo is a different folder
    const far = path.resolve(root, '..', 'refs', 'decompiled');
    const g2 = createScopeGuard({ root, write: [], read: ['src/**'], protected: [], bash: [], externalRead: [far] });
    expect(g2.check('Read', { file_path: '../decompiled/secret.txt' }).allow).toBe(false);
    expect(g2.check('Read', { file_path: '../refs/decompiled/Enemy.cs' }).allow).toBe(true);
  });
  it('never allows writing them, or reading their siblings', () => {
    expect(g.check('Write', { file_path: path.join(ext, 'Assets', 'Enemy.cs') }).allow).toBe(false);
    expect(g.check('Read', { file_path: path.resolve(root, '..', 'decompiled-other', 'x.cs') }).allow).toBe(false);
  });
});

describe('scope guard: other tools', () => {
  it('allows orchestrator role tools and todos', () => {
    expect(allowed(orchTool('report_progress'), { summary: 'x' })).toBe(true);
    expect(allowed('TodoWrite', { todos: [] })).toBe(true);
  });
  it.each(['WebFetch', 'WebSearch', 'Task', 'Agent', 'mcp__other__tool', 'SomethingNew'])('denies %s', (tool) => {
    expect(allowed(tool, {})).toBe(false);
  });
});

describe('path helpers', () => {
  it('normalises to repo-relative posix paths', () => {
    expect(toRepoRelative(root, abs('src/a.ts'))).toBe('src/a.ts');
    expect(toRepoRelative(root, 'src\\b.ts')).toBe('src/b.ts');
    expect(toRepoRelative(root, '../x')).toBeNull();
    expect(toRepoRelative(root, root)).toBe('');
  });

  it('checks glob containment conservatively', () => {
    expect(globWithin('src/game/waves/**', ['src/game/**'])).toBe(true);
    expect(globWithin('src/game/waves/*.ts', ['src/game/**'])).toBe(true);
    expect(globWithin('src/game/a.ts', ['src/game/**'])).toBe(true);
    expect(globWithin('src/engine/**', ['src/game/**'])).toBe(false);
    expect(globWithin('src/**', ['src/game/**'])).toBe(false);
    expect(globWithin('anything/**', ['**'])).toBe(true);
  });

  it('detects overlapping scopes', () => {
    expect(scopesOverlap(['src/game/**'], ['src/game/waves/a.ts'])).toBe(true);
    expect(scopesOverlap(['src/game/**'], ['src/engine/**'])).toBe(false);
    expect(scopesOverlap(['src/game/a.ts'], ['src/game/b.ts'])).toBe(false);
  });
});
