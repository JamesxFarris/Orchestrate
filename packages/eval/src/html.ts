import type { ScenarioResult } from './run.ts';
import { beyondCorrectness, byArm, summarize, verdict, type ArmSummary, type EvalReport } from './report.ts';

/**
 * The comparison as a page you can open in a browser: headline numbers, then one bar chart per
 * measure (judge tests passed, cost, time), each with Orchestrate and Claude alone side by side,
 * and the same numbers as a table. Self-contained: inline SVG and CSS, no scripts fetched.
 * Colours are the dataviz reference palette's first two categorical slots, validated for colour
 * blindness in light and dark mode.
 */
export function htmlReport(report: EvalReport): string {
  const team = byArm(report.results, 'orchestrate');
  const solo = byArm(report.results, 'solo');
  const scenarios = [...new Set(report.results.map((r) => r.scenario))];
  const t = summarize(team);
  const s = summarize(solo);
  const of = (rs: ScenarioResult[], id: string) => summarize(rs.filter((r) => r.scenario === id));
  const rows = scenarios.map((id) => ({ id, team: of(team, id), solo: of(solo, id) }));
  const judgeRate = (a: ArmSummary) => (a.judgeTotal ? (a.judgePassed / a.judgeTotal) * 100 : 0);
  const perRun = (a: ArmSummary, v: number) => (a.runs ? v / a.runs : 0);

  const charts = [
    chart('Judge tests passed', '%', 100, rows, (a) => judgeRate(a), (v) => `${Math.round(v)}%`, (a) => `${a.judgePassed} of ${a.judgeTotal} judge tests, ${a.correct} of ${a.runs} runs fully correct`),
    chart('Cost per run', '$', 0, rows, (a) => perRun(a, a.costUsd), (v) => `$${v.toFixed(2)}`, (a) => `$${a.costUsd.toFixed(2)} over ${a.runs} run${a.runs === 1 ? '' : 's'}`),
    chart('Time per run', 's', 0, rows, (a) => perRun(a, a.seconds), (v) => `${Math.round(v)}s`, (a) => `${a.seconds}s over ${a.runs} run${a.runs === 1 ? '' : 's'}`),
  ];
  // context charts read per-scenario averages straight from the results (ArmSummary doesn't carry tokens)
  const ctx = (rs: ScenarioResult[], id: string, f: (r: ScenarioResult) => number) => {
    const xs = rs.filter((r) => r.scenario === id && r.context).map(f);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  };
  const hasContext = report.results.some((r) => r.context && r.context.total > 0);
  if (hasContext) {
    const ctxRows = scenarios.map((id) => ({ id, team: { ...of(team, id), v: ctx(team, id, (r) => r.context!.peak) }, solo: { ...of(solo, id), v: ctx(solo, id, (r) => r.context!.peak) } }));
    const tokRows = scenarios.map((id) => ({ id, team: { ...of(team, id), v: ctx(team, id, (r) => r.context!.total) }, solo: { ...of(solo, id), v: ctx(solo, id, (r) => r.context!.total) } }));
    const k = (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${Math.round(v)}`);
    charts.push(
      chart('Largest context in one session (tokens)', 'tok', 0, ctxRows, (a) => (a as ArmSummary & { v: number }).v, k, () => 'the biggest prompt any single model request carried, averaged over runs'),
      chart('Tokens over all sessions, per run', 'tok', 0, tokRows, (a) => (a as ArmSummary & { v: number }).v, k, () => 'every token read or written by every agent session, averaged over runs'),
    );
  }
  const beyond = beyondCorrectness(team, solo);
  const beyondTable = beyond.length
    ? `<h2>Beyond correctness</h2><p class="meta">Averages per run unless noted. Existing tests are the starting repo's own, restored and re-run on the result. Off-task files are code files no task needed. Context is the largest prompt any single model request carried.</p><table class="beyond"><thead><tr><th>Measure</th><th>Orchestrate</th><th>Claude alone</th></tr></thead><tbody>${beyond.map(([l, a, b]) => `<tr><td>${esc(l)}</td><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</tbody></table>`
    : '';

  const tile = (label: string, team: string, solo: string) => `<div class="tile"><div class="tile-label">${label}</div><div class="tile-row"><span class="key k1"></span><span class="tile-name">Orchestrate</span><span class="tile-value">${team}</span></div><div class="tile-row"><span class="key k2"></span><span class="tile-name">Claude alone</span><span class="tile-value">${solo}</span></div></div>`;
  const table = `<table><thead><tr><th>Scenario</th><th>Orchestrate correct</th><th>Claude alone correct</th><th>Orchestrate judge tests</th><th>Claude alone judge tests</th><th>Orchestrate cost / run</th><th>Claude alone cost / run</th><th>Orchestrate time / run</th><th>Claude alone time / run</th></tr></thead><tbody>${rows
    .map((r) => `<tr><td>${esc(r.id)}</td><td>${r.team.correct}/${r.team.runs}</td><td>${r.solo.correct}/${r.solo.runs}</td><td>${r.team.judgePassed}/${r.team.judgeTotal}</td><td>${r.solo.judgePassed}/${r.solo.judgeTotal}</td><td>$${perRun(r.team, r.team.costUsd).toFixed(2)}</td><td>$${perRun(r.solo, r.solo.costUsd).toFixed(2)}</td><td>${Math.round(perRun(r.team, r.team.seconds))}s</td><td>${Math.round(perRun(r.solo, r.solo.seconds))}s</td></tr>`)
    .join('')}</tbody></table>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Orchestrate vs Claude alone</title>
<style>${CSS}</style>
</head>
<body>
<main class="viz-root">
  <header>
    <h1>Orchestrate vs Claude alone</h1>
    <p class="meta">${report.mode === 'live' ? `Live, ${esc(report.model)}` : 'Scripted (free self-check, not a real comparison)'} · commit ${esc(report.commit)} · ${esc(report.at.slice(0, 16).replace('T', ' '))} UTC · ${scenarios.length} scenario${scenarios.length === 1 ? '' : 's'}, ${report.repeat} run${report.repeat === 1 ? '' : 's'} each</p>
  </header>
  <p class="verdict">${esc(verdict(t, s, scenarios.length))}</p>
  <section class="tiles">
    ${tile('Judge tests passed', `${Math.round(judgeRate(t))}%`, `${Math.round(judgeRate(s))}%`)}
    ${tile('Runs fully correct', `${t.correct}/${t.runs}`, `${s.correct}/${s.runs}`)}
    ${tile('Total cost', `$${t.costUsd.toFixed(2)}`, `$${s.costUsd.toFixed(2)}`)}
    ${tile('Total time', `${t.seconds}s`, `${s.seconds}s`)}
  </section>
  <div class="legend" aria-hidden="true"><span><span class="key k1"></span>Orchestrate</span><span><span class="key k2"></span>Claude alone</span></div>
  ${charts.join('\n  ')}
  ${beyondTable}
  <details>
    <summary>Show as a table</summary>
    ${table}
  </details>
  <p class="note">Judge tests are hidden tests neither side sees; "correct" means every one passed. Both sides get the same request, model and starting repo. See docs/eval.md.</p>
</main>
<div class="tip" role="tooltip" hidden></div>
<script>${TOOLTIP}</script>
</body>
</html>
`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Chart geometry, in SVG user units. */
const LABEL_W = 120;
const PLOT_W = 420;
const VALUE_W = 56;
const BAR_H = 14;
const BAR_GAP = 2;
const GROUP_GAP = 14;

/**
 * Horizontal grouped bars: one group per scenario, Orchestrate above Claude alone. `max` fixes the
 * axis (100 for a percentage); 0 scales it to the largest value.
 */
function chart(
  title: string,
  unit: string,
  max: number,
  rows: { id: string; team: ArmSummary; solo: ArmSummary }[],
  value: (a: ArmSummary) => number,
  show: (v: number) => string,
  detail: (a: ArmSummary) => string,
): string {
  const top = Math.max(max, ...rows.flatMap((r) => [value(r.team), value(r.solo)]), unit === '%' ? 100 : 1e-9);
  const groupH = BAR_H * 2 + BAR_GAP;
  const height = rows.length * groupH + (rows.length - 1) * GROUP_GAP + 24;
  const x = (v: number) => LABEL_W + (top > 0 ? (v / top) * PLOT_W : 0);
  const bar = (y: number, v: number, cls: string, name: string, a: ArmSummary, scenario: string) => {
    const w = Math.max(x(v) - LABEL_W, 0);
    const r = Math.min(4, w / 2, BAR_H / 2);
    // flat at the baseline, rounded at the data end
    const d = w <= 0 ? '' : `M${LABEL_W},${y} h${w - r} a${r},${r} 0 0 1 ${r},${r} v${BAR_H - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${w - r} z`;
    const tip = esc(`${scenario} · ${name}: ${show(v)} (${detail(a)})`);
    return `<g class="hit" data-tip="${tip}" tabindex="0"><rect x="${LABEL_W}" y="${y - 1}" width="${PLOT_W + VALUE_W}" height="${BAR_H + 2}" fill="transparent"/>${d ? `<path class="${cls}" d="${d}"/>` : ''}<text class="value" x="${x(v) + 6}" y="${y + BAR_H - 3}">${show(v)}</text></g>`;
  };
  // all zero (a free scripted run costs nothing): one tick, not three identical ones
  const ticks = (top > 1e-6 ? [0, 0.5, 1] : [0]).map((f) => `<line class="grid" x1="${x(top * f)}" x2="${x(top * f)}" y1="0" y2="${height - 18}"/><text class="axis" x="${x(top * f)}" y="${height - 4}" text-anchor="middle">${show(top * f)}</text>`).join('');
  const groups = rows
    .map((r, i) => {
      const y = i * (groupH + GROUP_GAP);
      return `<text class="label" x="${LABEL_W - 10}" y="${y + groupH / 2 + 4}" text-anchor="end">${esc(r.id)}</text>${bar(y, value(r.team), 's1', 'Orchestrate', r.team, r.id)}${bar(y + BAR_H + BAR_GAP, value(r.solo), 's2', 'Claude alone', r.solo, r.id)}`;
    })
    .join('');
  return `<figure class="chart"><figcaption>${title}</figcaption><div class="scroll"><svg viewBox="0 0 ${LABEL_W + PLOT_W + VALUE_W} ${height}" role="img" aria-label="${esc(title)}, Orchestrate and Claude alone per scenario">${ticks}${groups}</svg></div></figure>`;
}

const CSS = `
.viz-root {
  color-scheme: light;
  --surface-1: #fcfcfb; --text-primary: #0b0b0b; --text-secondary: #52514e; --text-muted: #898781;
  --grid: #e1e0d9; --border: rgba(11,11,11,0.10); --series-1: #2a78d6; --series-2: #eb6834;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .viz-root {
    color-scheme: dark;
    --surface-1: #1a1a19; --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #898781;
    --grid: #2c2c2a; --border: rgba(255,255,255,0.10); --series-1: #3987e5; --series-2: #d95926;
  }
  :root:where(:not([data-theme="light"])) body { background: #1a1a19; }
}
:root[data-theme="dark"] .viz-root {
  color-scheme: dark;
  --surface-1: #1a1a19; --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #898781;
  --grid: #2c2c2a; --border: rgba(255,255,255,0.10); --series-1: #3987e5; --series-2: #d95926;
}
:root[data-theme="dark"] body { background: #1a1a19; }
* { box-sizing: border-box; }
body { margin: 0; background: #fcfcfb; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
.viz-root { max-width: 760px; margin: 0 auto; padding: 32px 16px 48px; background: var(--surface-1); color: var(--text-primary); min-height: 100vh; }
h1 { font-size: 24px; margin: 0 0 4px; }
h2 { font-size: 18px; margin: 28px 0 4px; }
table.beyond { display: table; margin-bottom: 16px; }
table.beyond td:not(:first-child), table.beyond th:not(:first-child) { white-space: normal; }
.meta, .note { color: var(--text-secondary); font-size: 13px; margin: 0; }
.note { margin-top: 24px; }
.verdict { font-size: 17px; margin: 20px 0; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
.tile { border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
.tile-label { color: var(--text-secondary); font-size: 13px; margin-bottom: 6px; }
.tile-row { display: flex; align-items: center; gap: 6px; font-size: 14px; }
.tile-name { color: var(--text-secondary); flex: 1; }
.tile-value { font-weight: 600; font-variant-numeric: tabular-nums; }
.key { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
.k1 { background: var(--series-1); } .k2 { background: var(--series-2); }
.legend { display: flex; gap: 16px; font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; }
.legend > span { display: inline-flex; align-items: center; gap: 6px; }
.chart { margin: 0 0 24px; }
.scroll { overflow-x: auto; }
figcaption { font-weight: 600; margin-bottom: 6px; }
svg { width: 100%; min-width: 520px; height: auto; overflow: visible; }
.s1 { fill: var(--series-1); } .s2 { fill: var(--series-2); }
.grid { stroke: var(--grid); stroke-width: 1; }
.axis { fill: var(--text-muted); font-size: 11px; }
.label { fill: var(--text-secondary); font-size: 12px; }
.value { fill: var(--text-primary); font-size: 11px; font-variant-numeric: tabular-nums; }
.hit { outline: none; cursor: default; }
.hit:hover path, .hit:focus path { opacity: 0.85; }
details { margin-top: 8px; }
summary { cursor: pointer; color: var(--text-secondary); }
table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 13px; font-variant-numeric: tabular-nums; display: block; overflow-x: auto; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }
th { color: var(--text-secondary); font-weight: 500; }
.tip { position: fixed; pointer-events: none; background: #0b0b0b; color: #f0efec; font-size: 12px; padding: 6px 8px; border-radius: 6px; max-width: 320px; z-index: 10; }
`;

/** One tooltip for every bar: follows the pointer, and shows for keyboard focus too. */
const TOOLTIP = `
const tip = document.querySelector('.tip');
const show = (el, x, y) => { tip.textContent = el.dataset.tip; tip.hidden = false; tip.style.left = Math.min(x + 12, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (y + 12) + 'px'; };
document.querySelectorAll('.hit').forEach((el) => {
  el.addEventListener('pointermove', (e) => show(el, e.clientX, e.clientY));
  el.addEventListener('pointerleave', () => (tip.hidden = true));
  el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); show(el, r.left, r.bottom); });
  el.addEventListener('blur', () => (tip.hidden = true));
});
`;
