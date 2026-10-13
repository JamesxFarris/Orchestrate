import type { Plan } from '@orchestrate/shared';
import type { Org } from '../org/org.ts';
import { globWithin, matcher, toRepoRelative } from '../scope/paths.ts';
import { topoOrder } from './dag.ts';

/**
 * Deterministic checks on a master's plan. Every problem is phrased as an instruction the master can
 * act on when revising. An empty list means the plan is structurally sound.
 */
export function validatePlan(plan: Plan, org: Org): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const policyMax = org.policy.maxChangedLines;
  const testGlobs = org.project.testGlobs;

  for (const t of plan.tasks) {
    const where = `task "${t.id}"`;
    if (ids.has(t.id)) problems.push(`${where}: duplicate task id.`);
    ids.add(t.id);

    if (!org.hasSquad(t.squad)) {
      problems.push(`${where}: unknown squad "${t.squad}". Valid squads: ${org.squads.map((s) => s.id).join(', ')}.`);
      continue;
    }
    const squad = org.squad(t.squad);

    if (!org.implementer(t.squad, t.kind)) {
      problems.push(`${where}: squad "${t.squad}" has nobody who can do ${t.kind} tasks.`);
    }

    for (const g of [...t.writeScope, ...t.testFiles]) {
      if (toRepoRelative('/', g) === null || g.startsWith('/') || /^[a-zA-Z]:/.test(g)) {
        problems.push(`${where}: "${g}" must be a repo-relative path.`);
      }
    }

    for (const g of t.writeScope) {
      if (!globWithin(g, squad.owns)) {
        problems.push(`${where}: writeScope "${g}" is outside squad "${squad.id}" ownership (${squad.owns.join(', ')}). Narrow it or assign the work to the owning squad.`);
      }
      if (g === '**' || g === '**/*') problems.push(`${where}: writeScope "${g}" is unbounded. Name the directories or files.`);
    }

    if (t.kind === 'code') {
      if (t.testFiles.length === 0) {
        problems.push(`${where}: code tasks need at least one test file so QA can write failing acceptance tests first.`);
      }
      if (!org.squadRole(t.squad, 'qa')) problems.push(`${where}: squad "${t.squad}" has no QA role for a code task.`);
      // A test file must look like a test AND live in this squad's test dirs (not another squad's).
      const looksLikeTest = matcher(testGlobs);
      const inSquadDirs = squad.testDirs.length ? matcher(squad.testDirs) : () => true;
      for (const f of t.testFiles) {
        if (/[*?[\]{}]/.test(f)) problems.push(`${where}: test file "${f}" must be an exact path, not a glob.`);
        else if (!looksLikeTest(f) || !inSquadDirs(f)) {
          problems.push(`${where}: "${f}" is not a test path for squad "${squad.id}" (must match ${testGlobs.join(' or ')} under ${squad.testDirs.join(', ') || 'any directory'}).`);
        }
      }
    } else if (t.testFiles.length > 0) {
      problems.push(`${where}: research tasks must not have test files.`);
    }

    if (t.maxChangedLines !== undefined && t.maxChangedLines > policyMax) {
      problems.push(`${where}: maxChangedLines ${t.maxChangedLines} exceeds the policy cap of ${policyMax}. Split the task.`);
    }

    for (const d of t.dependsOn) {
      if (d === t.id) problems.push(`${where}: depends on itself.`);
    }
  }

  for (const t of plan.tasks) {
    for (const d of t.dependsOn) {
      if (!ids.has(d)) problems.push(`task "${t.id}": depends on unknown task "${d}".`);
    }
  }

  const topo = topoOrder(plan.tasks);
  if ('cycle' in topo) problems.push(`dependency cycle: ${topo.cycle.join(' -> ')}.`);

  return problems;
}
