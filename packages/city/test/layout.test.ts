import { describe, expect, it } from 'vitest';
import { layoutCity, PLATFORM_RADIUS } from '../src/layout.ts';
import { buildParkLayout, PATH_WIDTH } from '../src/scene/park/parkLayout.ts';
import { inSettlement } from '../src/scene/settlement/settlementLayout.ts';
import type { Team, TeamRole } from '../src/store.ts';

const squads = ['gameplay', 'engine', 'render', 'research'];
const team: Team = {
  mode: 'demo',
  project: { name: 'Test', language: 'TypeScript' },
  squads: squads.map((id, i) => ({ id, name: id, color: ['#e4572e', '#1985a1', '#f2a541', '#7a5cb2'][i]!, mission: '' })),
  roles: [
    { id: 'vp', title: 'VP of Engineering', kind: 'master', tier: 'exec' },
    { id: 'architect', title: 'Principal Architect', kind: 'architect', tier: 'principal' },
    { id: 'qa-manager', title: 'QA Manager', kind: 'qa', tier: 'principal' },
    ...squads.flatMap((s): TeamRole[] => [
      { id: `${s}-lead`, title: 'Tech Lead', kind: 'lead', tier: 'lead', squad: s },
      { id: `${s}-dev`, title: 'Software Engineer', kind: 'dev', tier: 'senior', squad: s },
      { id: `${s}-qa`, title: 'QA Engineer', kind: 'qa', tier: 'ic', squad: s },
    ]),
  ],
  techCircle: [],
};

const city = layoutCity(team);
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe('layoutCity', () => {
  it('places every role exactly once, the VP in the middle', () => {
    expect(city.buildings.map((b) => b.role.id).sort()).toEqual(team.roles.map((r) => r.id).sort());
    expect(city.byId.get('vp')).toMatchObject({ x: 0, z: 0 });
  });

  it('stands each squad lead on the Tech Circle, and gives each squad a district on the island', () => {
    for (const s of squads) {
      expect(Math.hypot(city.byId.get(`${s}-lead`)!.x, city.byId.get(`${s}-lead`)!.z)).toBeCloseTo(city.circleRadius, 5);
    }
    expect(city.districts.map((d) => d.squad.id)).toEqual(squads);
    for (const d of city.districts) expect(Math.hypot(d.x, d.z) + d.size).toBeLessThan(PLATFORM_RADIUS);
  });

  it('never puts two towers on top of each other', () => {
    for (const [i, a] of city.buildings.entries()) {
      for (const b of city.buildings.slice(i + 1)) expect(dist(a, b), `${a.role.id} / ${b.role.id}`).toBeGreaterThan((a.width + b.width) / 2);
    }
  });
});

describe('buildParkLayout', () => {
  const park = buildParkLayout(city);

  it('lays one footpath per squad, from the central plaza out to its district', () => {
    expect([...park.paths.keys()]).toEqual(squads);
    for (const d of city.districts) {
      const path = park.paths.get(d.squad.id)!;
      expect(Math.hypot(path[0]!.x, path[0]!.y)).toBeLessThan(city.plazaRadius + 1);
      expect(dist({ x: path.at(-1)!.x, z: path.at(-1)!.y }, d)).toBeLessThan(d.size + 5);
    }
  });

  it('keeps scenery trees off the footpaths and out of the settlements', () => {
    const paths = [...park.paths.values()];
    const offPath = (x: number, z: number) =>
      paths.every((line) => line.every((p, i) => i === 0 || segmentDistance(x, z, line[i - 1]!, p) > PATH_WIDTH / 2));
    for (const t of park.trees) {
      expect(offPath(t.x, t.z), `tree at ${t.x.toFixed(1)}, ${t.z.toFixed(1)}`).toBe(true);
      expect(inSettlement(city.districts, t.x, t.z)).toBe(false);
    }
  });

  it('lines each footpath with street lamps, evenly spaced, beside the path with the arm reaching over it', () => {
    const paths = [...park.paths.values()];
    const nearestOnPaths = (x: number, z: number) => {
      let best = { d: Infinity, x: 0, z: 0 };
      for (const line of paths)
        for (const [i, p] of line.entries()) {
          if (i === 0) continue;
          const a = line[i - 1]!;
          const dx = p.x - a.x;
          const dz = p.y - a.y;
          const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.y) * dz) / (dx * dx + dz * dz || 1)));
          const q = { x: a.x + t * dx, z: a.y + t * dz };
          const d = Math.hypot(x - q.x, z - q.z);
          if (d < best.d) best = { d, ...q };
        }
      return best;
    };
    // a few per path, not one per path vertex
    expect(park.lamps.length).toBeGreaterThanOrEqual(squads.length * 2);
    expect(park.lamps.length).toBeLessThan(squads.length * 8);
    for (const [i, l] of park.lamps.entries()) {
      const near = nearestOnPaths(l.x, l.z);
      expect(near.d).toBeGreaterThan(PATH_WIDTH / 2);
      expect(near.d).toBeLessThan(PATH_WIDTH / 2 + 2);
      // the arm (local +x, turned by rot about y) reaches over the path: its tip is nearer the path than the post
      const tip = { x: l.x + Math.cos(l.rot) * 1.5, z: l.z - Math.sin(l.rot) * 1.5 };
      expect(nearestOnPaths(tip.x, tip.z).d).toBeLessThan(near.d - 1);
      for (const other of park.lamps.slice(i + 1)) expect(dist(l, other)).toBeGreaterThan(4);
      for (const t of park.trees) expect(dist(l, t)).toBeGreaterThan(2.9);
    }
  });

  it('gives each squad room for its task trees, and routes between any two towers', () => {
    for (const s of squads) expect(park.taskSlots.get(s)!.length).toBeGreaterThanOrEqual(10);
    const route = park.route('gameplay-dev', 'render-qa');
    expect(route.length).toBeGreaterThan(2);
    expect(dist({ x: route[0]!.x, z: route[0]!.z }, city.byId.get('gameplay-dev')!)).toBeLessThan(15);
  });
});

function segmentDistance(x: number, z: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dz = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.y) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - (a.x + t * dx), z - (a.y + t * dz));
}
