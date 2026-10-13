import type { TaskContract, TaskStatus } from '@orchestrate/shared';
import { scopesOverlap } from '../scope/paths.ts';

/** Returns task ids in dependency order, or the ids forming a cycle. */
export function topoOrder(tasks: readonly TaskContract[]): { order: string[] } | { cycle: string[] } {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map<string, 'visiting' | 'done'>();
  const order: string[] = [];
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    const s = state.get(id);
    if (s === 'done') return null;
    if (s === 'visiting') return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 'visiting');
    stack.push(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (!byId.has(dep)) continue;
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 'done');
    order.push(id);
    return null;
  };

  for (const t of tasks) {
    const cycle = visit(t.id);
    if (cycle) return { cycle };
  }
  return { order };
}

const TERMINAL_BAD: ReadonlySet<TaskStatus> = new Set(['failed', 'escalated', 'skipped']);

/** Write scopes a running task occupies: its write scope plus its test files. */
export function footprint(t: TaskContract): string[] {
  return [...t.writeScope, ...t.testFiles];
}

/**
 * Scheduling decision for one tick. A task is ready when all deps merged, nothing running overlaps its
 * footprint, its squad is free (each squad's people work one task at a time), and a parallel slot is
 * free. Tasks whose deps can never merge are reported as blocked.
 */
export function schedule(
  tasks: readonly { contract: TaskContract; status: TaskStatus }[],
  maxParallel: number,
): { ready: TaskContract[]; blocked: TaskContract[] } {
  const status = new Map(tasks.map((t) => [t.contract.id, t.status]));
  const running = tasks.filter((t) => !['pending', 'merged', ...TERMINAL_BAD].includes(t.status)).map((t) => t.contract);
  const ready: TaskContract[] = [];
  const blocked: TaskContract[] = [];
  let slots = maxParallel - running.length;

  for (const { contract, status: st } of tasks) {
    if (st !== 'pending') continue;
    const deps = contract.dependsOn.map((d) => status.get(d));
    if (deps.some((d) => d !== undefined && TERMINAL_BAD.has(d))) {
      blocked.push(contract);
      continue;
    }
    if (!deps.every((d) => d === undefined || d === 'merged')) continue;
    if (slots <= 0) continue;
    const busy = [...running, ...ready];
    if (busy.some((r) => r.squad === contract.squad || scopesOverlap(footprint(r), footprint(contract)))) continue;
    ready.push(contract);
    slots--;
  }
  return { ready, blocked };
}
