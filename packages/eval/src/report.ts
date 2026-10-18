import type { Arm, ScenarioResult } from './run.ts';

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

/** Results from one arm; reports saved before the solo baseline existed hold only Orchestrate runs. */
export const armOf = (r: ScenarioResult): Arm => r.arm ?? 'orchestrate';
export const byArm = (results: ScenarioResult[], arm: Arm) => results.filter((r) => armOf(r) === arm);

/**
 * The scorecard as markdown: one row per Orchestrate run, a totals line, the change since
 * `previous`, and, when the report has solo runs, how Orchestrate compares with Claude alone.
 */
export function scorecard(report: EvalReport, previous?: EvalReport): string {
  const team = byArm(report.results, 'orchestrate');
  const lines = [
    `## Eval scorecard: ${report.mode}${report.mode === 'live' ? ` (${report.model})` : ''}, commit ${report.commit}`,
    '',
    '| Scenario | Correct (judge) | Status | Tasks merged | First try | Escalated | Retries | Gate failures | Guard denials | Needed a person | Cost | Time |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...team.map(
      (r) =>
        `| ${r.scenario} | ${r.correct ? 'yes' : 'NO'} (${r.judge.passed}/${r.judge.total}) | ${r.status} | ${r.tasks.merged}/${r.tasks.total} | ${r.tasks.firstTry} | ${r.tasks.escalated} | ${r.retries} | ${gates(r.gateFailures)} | ${r.denials} | ${r.neededHuman ? 'yes' : 'no'} | $${r.costUsd.toFixed(2)} | ${r.seconds}s |`,
    ),
  ];
  const t = totals(team);
  lines.push('', `**Totals over ${t.runs} runs:** correct ${pct(t.correctRate)}, judge tests ${pct(t.judgeRate)}, completed ${pct(t.completedRate)}, first-try tasks ${pct(t.firstTryRate)}, ${t.escalations} escalations, ${t.retries} retries, ${t.denials} guard denials, ${t.neededHuman} needed a person, $${t.costUsd.toFixed(2)}, ${t.seconds}s.`);
  if (previous && byArm(previous.results, 'orchestrate').length) {
    const p = totals(byArm(previous.results, 'orchestrate'));
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
  const solo = byArm(report.results, 'solo');
  if (solo.length) lines.push('', comparison(team, solo));
  return lines.join('\n');
}

/** One arm's results, summed over runs. */
export interface ArmSummary {
  runs: number;
  correct: number;
  judgePassed: number;
  judgeTotal: number;
  costUsd: number;
  seconds: number;
}

export function summarize(results: ScenarioResult[]): ArmSummary {
  return results.reduce(
    (a, r) => ({ runs: a.runs + 1, correct: a.correct + (r.correct ? 1 : 0), judgePassed: a.judgePassed + r.judge.passed, judgeTotal: a.judgeTotal + r.judge.total, costUsd: a.costUsd + r.costUsd, seconds: a.seconds + r.seconds }),
    { runs: 0, correct: 0, judgePassed: 0, judgeTotal: 0, costUsd: 0, seconds: 0 },
  );
}

/** Below this many runs per scenario per arm, a gap of a run or two is as likely chance as skill. */
const FEW_RUNS = 3;

/**
 * Orchestrate against Claude alone, scenario by scenario: how often each got everything right,
 * how many judge tests it passed, and what it cost. Ends with a plain-language verdict.
 */
export function comparison(team: ScenarioResult[], solo: ScenarioResult[]): string {
  const scenarios = [...new Set([...team, ...solo].map((r) => r.scenario))];
  const cell = (a: ArmSummary) => `${a.correct}/${a.runs} (${a.judgePassed}/${a.judgeTotal})`;
  const money = (a: ArmSummary) => `$${(a.costUsd / Math.max(a.runs, 1)).toFixed(2)}`;
  const time = (a: ArmSummary) => `${Math.round(a.seconds / Math.max(a.runs, 1))}s`;
  const lines = [
    '## Orchestrate vs Claude alone',
    '',
    'Correct is runs where every hidden judge test passed; judge tests passed are in brackets. Cost and time are per run.',
    '',
    '| Scenario | Orchestrate correct | Claude alone correct | Orchestrate cost | Claude alone cost | Orchestrate time | Claude alone time |',
    '|---|---|---|---|---|---|---|',
    ...scenarios.map((id) => {
      const t = summarize(team.filter((r) => r.scenario === id));
      const s = summarize(solo.filter((r) => r.scenario === id));
      return `| ${id} | ${cell(t)} | ${cell(s)} | ${money(t)} | ${money(s)} | ${time(t)} | ${time(s)} |`;
    }),
  ];
  const t = summarize(team);
  const s = summarize(solo);
  lines.push(
    '',
    `**Totals:** Orchestrate ${t.correct}/${t.runs} correct, ${t.judgePassed}/${t.judgeTotal} judge tests, $${t.costUsd.toFixed(2)}, ${t.seconds}s. Claude alone ${s.correct}/${s.runs} correct, ${s.judgePassed}/${s.judgeTotal} judge tests, $${s.costUsd.toFixed(2)}, ${s.seconds}s.`,
    '',
    `**Verdict:** ${verdict(t, s, scenarios.length)}`,
  );
  return lines.join('\n');
}

/** The comparison in one sentence: accuracy first, then cost, then how far to trust it. */
export function verdict(team: ArmSummary, solo: ArmSummary, scenarios: number): string {
  const rate = (a: ArmSummary) => (a.judgeTotal ? a.judgePassed / a.judgeTotal : 0);
  const gap = Math.round((rate(team) - rate(solo)) * 100);
  const accuracy = gap === 0 ? 'passed the same share of judge tests as' : `passed ${Math.abs(gap)} points ${gap > 0 ? 'more' : 'fewer'} of the judge tests than`;
  const cost = solo.costUsd > 0 ? ` at ${(team.costUsd / solo.costUsd).toFixed(1)}x the cost` : '';
  const few = Math.min(team.runs, solo.runs) < FEW_RUNS * scenarios ? ` Fewer than ${FEW_RUNS} runs per scenario on each side, so treat a small gap as chance; rerun with --repeat ${FEW_RUNS}.` : '';
  return `Orchestrate ${accuracy} Claude alone${cost}.${few}`;
}
