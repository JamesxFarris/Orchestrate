import type { RunState, TaskState } from '@orchestrate/shared';
import { searchRoots } from '../scope/scopeGuard.ts';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * What an agent should know beyond its contract, gathered by the orchestrator so the agent does not
 * spend turns rediscovering it: what the tasks it builds on delivered, which design docs to follow,
 * and where it may search. Paths and short summaries only; the agent reads the files itself.
 */
export function buildTaskBrief(run: RunState, task: TaskState, readGlobs: readonly string[]): string {
  const c = task.contract;
  const byId = new Map(run.tasks.map((t) => [t.contract.id, t]));
  const deps = c.dependsOn.map((id) => byId.get(id)).filter((t): t is TaskState => t?.status === 'merged');
  const sections: string[] = [];

  // UPSTREAM: what each finished dependency delivered (it is already in your branch)
  const upstream: string[] = [];
  let used = 0;
  for (const d of deps) {
    const r = d.result;
    const files = r?.files.length ? `; changed ${r.files.slice(0, 8).join(', ')}${r.files.length > 8 ? ` and ${r.files.length - 8} more` : ''}` : '';
    const line = clip(`- ${d.contract.id} "${d.contract.title}" (${d.contract.squad}): ${r?.summary ?? 'merged'}${files}`, 600);
    if (used + line.length > 2500) break;
    upstream.push(line);
    used += line.length;
  }
  if (upstream.length) sections.push(`UPSTREAM (finished work this task builds on, already in your branch)\n${upstream.join('\n')}`);

  // DESIGN TO FOLLOW: the documents a design (research) task this one depends on wrote
  const designs = deps.filter((d) => d.contract.kind === 'research').flatMap((d) => d.result?.files ?? d.contract.writeScope);
  if (designs.length) sections.push(`DESIGN TO FOLLOW (read these first; your work implements their contracts)\n${designs.map((f) => `- ${f}`).join('\n')}`);

  // WHERE TO LOOK: Grep only searches directories the read scope covers whole
  const roots = searchRoots(readGlobs).map((r) => r || '.');
  if (roots.length) sections.push(`WHERE TO LOOK (Grep must name one of these directories as its path)\n${roots.map((r) => `- ${r}`).join('\n')}`);

  return sections.join('\n\n');
}
