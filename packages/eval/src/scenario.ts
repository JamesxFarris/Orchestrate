import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Plan } from '@orchestrate/shared';
import type { ScenarioTeam } from './team.ts';

/**
 * A scenario is a folder under packages/eval/scenarios/<id>/:
 *   scenario.json  the request, the reference plan, and which hidden test plays each planned test file
 *   repo/          the project as it starts (committed on main before the run)
 *   hidden/        judge tests the agents never see: the ground truth for "is it right?"
 *   solution/      the reference answer, used by the scripted team to check the bench itself
 *   flawed/        optional: a tempting wrong fix that passes the visible tests; the judge must reject it
 */
export interface Scenario {
  id: string;
  title: string;
  /** What harness skill it exercises. */
  skill: string;
  request: string;
  /** What the scripted VP proposes (and a sensible plan for a real one). */
  plan: Plan;
  /** Planned test file -> hidden judge test the scripted QA writes there. */
  reference: Record<string, string>;
  /** Optional: the scenario's own squads and usage cap; without it, the default core + api team. */
  team?: ScenarioTeam;
  dir: string;
}

export const SCENARIOS_DIR = path.resolve(import.meta.dirname, '../scenarios');

export function loadScenarios(only?: string[]): Scenario[] {
  return readdirSync(SCENARIOS_DIR)
    .filter((id) => statSync(path.join(SCENARIOS_DIR, id)).isDirectory())
    .filter((id) => !only?.length || only.includes(id))
    .sort()
    .map((id) => {
      const dir = path.join(SCENARIOS_DIR, id);
      return { ...(JSON.parse(readFileSync(path.join(dir, 'scenario.json'), 'utf8')) as Omit<Scenario, 'dir'>), dir };
    });
}

/** Every file under `dir`, as paths relative to it (forward slashes). */
export function filesIn(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(dir, p).split(path.sep).join('/'));
    }
  };
  walk(dir);
  return out;
}
