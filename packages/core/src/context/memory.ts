import type { RunState } from '@orchestrate/shared';

const FINISHED = new Set(['completed', 'failed', 'cancelled']);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * The planner's memory: one line per recent finished run on the same repository (the store is
 * shared across projects), with what it delivered and the follow-ups it left. Short on purpose:
 * it points the planner at history to check, it is not a record to trust over the code.
 */
export function recentRunMemory(runs: readonly RunState[], current: RunState, limit = 5, maxChars = 1500): string {
  const recent = runs
    .filter((r) => r.id !== current.id && FINISHED.has(r.status) && r.repo !== undefined && r.repo === current.repo)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
  const lines: string[] = [];
  let used = 0;
  for (const r of recent) {
    const merged = r.tasks.filter((t) => t.status === 'merged').length;
    const outcome = `${r.status}, ${merged}/${r.tasks.length} tasks merged`;
    const what = r.summary ? ` — ${clip(r.summary.split('\n')[0]!, 160)}` : '';
    const next = r.followUps?.length ? `; follow-ups: ${clip(r.followUps.join('; '), 200)}` : '';
    const line = `- ${new Date(r.createdAt).toISOString().slice(0, 10)} "${clip(r.prompt.split('\n')[0]!, 80)}" (${outcome})${what}${next}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}
