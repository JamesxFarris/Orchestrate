import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { SdkRunner } from '@orchestrate/core';
import { scorecard, type EvalReport } from './report.ts';
import { runScenario, type ScenarioResult } from './run.ts';
import { loadScenarios } from './scenario.ts';
import { scriptedTeam } from './scriptedTeam.ts';

/**
 * npm run eval                         scripted team, free: checks the bench itself
 * npm run eval -- --live               real agents (costs API money, a few dollars per scenario)
 * npm run eval -- --live --repeat 3    each scenario three times (agents vary run to run)
 * npm run eval -- --only slugify       one scenario
 * npm run eval -- --live --budget     the budget preset's models and limits (cheapest live check)
 * Options: --model <id>, --keep (keep temp repos), --no-compare
 * Results go to .orchestrate/evals/; each scorecard compares with the previous run in the same mode.
 */
const { values } = parseArgs({
  options: {
    live: { type: 'boolean', default: false },
    model: { type: 'string', default: process.env.ORCH_EVAL_MODEL ?? 'claude-opus-5-5' },
    repeat: { type: 'string', default: '1' },
    only: { type: 'string', multiple: true },
    keep: { type: 'boolean', default: false },
    budget: { type: 'boolean', default: false },
    'no-compare': { type: 'boolean', default: false },
  },
});

const HOME = path.resolve(import.meta.dirname, '../../..');
const OUT = path.join(HOME, '.orchestrate', 'evals');
const mode = values.live ? 'live' : 'scripted';
const repeat = Math.max(1, Number(values.repeat) || 1);
const scenarios = loadScenarios(values.only);
if (!scenarios.length) throw new Error(`no scenarios match ${values.only?.join(', ')}`);

const commit = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: HOME, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();

console.log(`[eval] ${mode}${values.live ? ` with ${values.budget ? 'the budget team' : values.model}` : ''}: ${scenarios.map((s) => s.id).join(', ')} x${repeat}`);
const results: ScenarioResult[] = [];
for (const scenario of scenarios) {
  for (let i = 0; i < repeat; i++) {
    const runner = values.live ? new SdkRunner() : scriptedTeam(scenario);
    const r = await runScenario(scenario, { runner, model: values.model!, budget: values.budget, keep: values.keep });
    results.push(r);
    console.log(`[eval] ${scenario.id}${repeat > 1 ? ` #${i + 1}` : ''}: ${r.correct ? 'correct' : 'NOT correct'} (${r.judge.passed}/${r.judge.total}), ${r.status}, $${r.costUsd.toFixed(2)}, ${r.seconds}s`);
  }
}

const report: EvalReport = { at: new Date().toISOString(), commit, mode, model: values.model!, repeat, results };
mkdirSync(OUT, { recursive: true });
const previous = values['no-compare']
  ? undefined
  : readdirSync(OUT)
      .filter((f) => f.endsWith(`-${mode}.json`))
      .sort()
      .map((f) => JSON.parse(readFileSync(path.join(OUT, f), 'utf8')) as EvalReport)
      .at(-1);
const file = path.join(OUT, `${report.at.replace(/[:.]/g, '-')}-${commit}-${mode}.json`);
writeFileSync(file, JSON.stringify(report, null, 2));
const card = scorecard(report, previous);
writeFileSync(file.replace(/\.json$/, '.md'), card + '\n');
console.log(`\n${card}\n\nSaved ${path.relative(HOME, file)}`);
if (existsSync(file) && results.some((r) => !r.correct) && !values.live) process.exitCode = 1; // a scripted run must be perfect
