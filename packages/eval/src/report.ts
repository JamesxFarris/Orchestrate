import type { ScenarioResult } from './run.ts';

/** A saved eval run: what was measured, under which harness version and model. */
export interface EvalReport {
  at: string;
  commit: string;
  mode: 'scripted' | 'live';
  model: string;
  repeat: number;
  results: ScenarioResult[];
}

export interface Totals {
  runs: number;
  /** Fraction of runs whose judge tests all passed. */
  correctRate: number;
  /** Judge tests passed over all runs, as a fraction. */
  judgeRate: number;
  completedRate: number;
  /** Merged-first-try tasks over all planned tasks. */
  firstTryRate: number;
  escalations: number;
  retries: number;
  denials: number;
  neededHuman: number;
  costUsd: number;
  seconds: number;
}

export function totals(results: ScenarioResult[]): Totals {
  const sum = (f: (r: ScenarioResult) => number) => results.reduce((n, r) => n + f(r), 0);
  const tasks = sum((r) => r.tasks.total);
  const judgeTotal = sum((r) => r.judge.total);
  return {
    runs: results.length,
    correctRate: results.length ? sum((r) => (r.correct ? 1 : 0)) / results.length : 0,
    judgeRate: judgeTotal ? sum((r) => r.judge.passed) / judgeTotal : 0,
    completedRate: results.length ? sum((r) => (r.completed ? 1 : 0)) / results.length : 0,
    firstTryRate: tasks ? sum((r) => r.tasks.firstTry) / tasks : 0,
    escalations: sum((r) => r.tasks.escalated),
    retries: sum((r) => r.retries),
    denials: sum((r) => r.denials),
    neededHuman: sum((r) => (r.neededHuman ? 1 : 0)),
    costUsd: Math.round(sum((r) => r.costUsd) * 100) / 100,
    seconds: sum((r) => r.seconds),
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const gates = (g: Record<string, number>) => Object.entries(g).map(([k, v]) => `${k}×${v}`).join(' ') || '–';

/** The scorecard as markdown: one row per run, a totals line, and the change since `previous`. */
export function scorecard(report: EvalReport, previous?: EvalReport): string {
  const lines = [
    `## Eval scorecard: ${report.mode}${report.mode === 'live' ? ` (${report.model})` : ''}, commit ${report.commit}`,
    '',
    '| Scenario | Correct (judge) | Status | Tasks merged | First try | Escalated | Retries | Gate failures | Guard denials | Needed a person | Cost | Time |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...report.results.map(
      (r) =>
        `| ${r.scenario} | ${r.correct ? 'yes' : 'NO'} (${r.judge.passed}/${r.judge.total}) | ${r.status} | ${r.tasks.merged}/${r.tasks.total} | ${r.tasks.firstTry} | ${r.tasks.escalated} | ${r.retries} | ${gates(r.gateFailures)} | ${r.denials} | ${r.neededHuman ? 'yes' : 'no'} | $${r.costUsd.toFixed(2)} | ${r.seconds}s |`,
    ),
  ];
  const t = totals(report.results);
  lines.push('', `**Totals over ${t.runs} runs:** correct ${pct(t.correctRate)}, judge tests ${pct(t.judgeRate)}, completed ${pct(t.completedRate)}, first-try tasks ${pct(t.firstTryRate)}, ${t.escalations} escalations, ${t.retries} retries, ${t.denials} guard denials, ${t.neededHuman} needed a person, $${t.costUsd.toFixed(2)}, ${t.seconds}s.`);
  if (previous) {
    const p = totals(previous.results);
    const delta = (now: number, was: number, asPct = true, betterUp = true) => {
      const d = now - was;
      if (Math.abs(d) < 1e-9) return 'same';
      const shown = asPct ? `${d > 0 ? '+' : ''}${Math.round(d * 100)} pts` : `${d > 0 ? '+' : ''}${Math.round(d * 100) / 100}`;
      return `${shown} ${(d > 0) === betterUp ? '(better)' : '(worse)'}`;
    };
    lines.push(
      '',
      `**Since ${previous.commit} (${previous.at.slice(0, 16).replace('T', ' ')}):** correct ${delta(t.correctRate, p.correctRate)}, judge tests ${delta(t.judgeRate, p.judgeRate)}, first-try ${delta(t.firstTryRate, p.firstTryRate)}, escalations ${delta(t.escalations, p.escalations, false, false)}, retries ${delta(t.retries, p.retries, false, false)}, cost ${delta(t.costUsd, p.costUsd, false, false)}.`,
    );
  }
  return lines.join('\n');
}
