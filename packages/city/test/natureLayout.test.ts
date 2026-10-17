import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { districtPlazaRadius, layoutCity, PLATFORM_RADIUS } from '../src/layout.ts';
import { landmarkSites } from '../src/scene/park/landmarksLayout.ts';
import { buildNatureLayout, LANDMARK_MARGIN, natureFootprints, pondReach, pondRadiusAt, SHRUB_MARGIN } from '../src/scene/park/natureLayout.ts';
import { buildParkLayout, PATH_WIDTH } from '../src/scene/park/parkLayout.ts';
import { inSettlement } from '../src/scene/settlement/settlementLayout.ts';
import type { Team, TeamRole } from '../src/store.ts';

const COLORS = ['#e4572e', '#1985a1', '#f2a541', '#7a5cb2', '#7bc950', '#b8a9e3', '#4c5c68', '#c5c3c6'];

/** A team of n squads; squads alternate between one and two rows of members so districts sit at different radii. */
function teamOf(n: number): Team {
  const squads = Array.from({ length: n }, (_, i) => `squad${i}`);
  return {
    mode: 'demo',
    project: { name: 'Test', language: 'TypeScript' },
    squads: squads.map((id, i) => ({ id, name: id, color: COLORS[i]!, mission: '' })),
    roles: [
      { id: 'vp', title: 'VP of Engineering', kind: 'master', tier: 'exec' },
      { id: 'architect', title: 'Principal Architect', kind: 'architect', tier: 'principal' },
      ...squads.flatMap((s, i): TeamRole[] => [
        { id: `${s}-lead`, title: 'Tech Lead', kind: 'lead', tier: 'lead', squad: s },
        ...Array.from({ length: i % 2 ? 5 : 2 }, (_, k): TeamRole => ({ id: `${s}-dev${k}`, title: 'Software Engineer', kind: 'dev', tier: 'senior', squad: s })),
      ]),
    ],
    techCircle: [],
  };
}

function distToPolyline(p: { x: number; z: number }, line: THREE.Vector2[]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const ab = b.clone().sub(a);
    const t = THREE.MathUtils.clamp(((p.x - a.x) * ab.x + (p.z - a.y) * ab.y) / ab.lengthSq(), 0, 1);
    best = Math.min(best, Math.hypot(p.x - a.x - ab.x * t, p.z - a.y - ab.y * t));
  }
  return best;
}

for (const n of [2, 3, 4, 5, 6, 7, 8]) {
  describe(`buildNatureLayout with ${n} squads`, () => {
    const city = layoutCity(teamOf(n));
    const park = buildParkLayout(city);
    const nature = buildNatureLayout(city, park);
    const prints = natureFootprints(nature);

    it('is deterministic', () => {
      expect(buildNatureLayout(city, buildParkLayout(city))).toEqual(nature);
    });

    it('has ponds, rocks, meadows and wildlife', () => {
      expect(nature.ponds.length).toBeGreaterThanOrEqual(2);
      expect(nature.rocks.length).toBeGreaterThan(30);
      expect(nature.meadows.length).toBeGreaterThan(5);
      expect(nature.flowers.length).toBeGreaterThan(200);
      expect(nature.ducks.length).toBeGreaterThan(0);
      expect(nature.deer.length).toBeGreaterThan(0);
    });

    /** Footprints failing a rule, as readable labels (an empty list passes). */
    const failing = (rule: (p: (typeof prints)[number]) => boolean) => prints.filter((p) => !rule(p)).map((p) => `${p.kind} at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);

    it('keeps everything on the platform and off the central plaza', () => {
      expect(failing((p) => Math.hypot(p.x, p.z) + p.r < PLATFORM_RADIUS)).toEqual([]);
      expect(failing((p) => Math.hypot(p.x, p.z) - p.r > city.plazaRadius)).toEqual([]);
    });

    it('stays off district plazas, settlements and task slots', () => {
      const slots = [...park.taskSlots.values()].flat();
      expect(failing((p) => city.districts.every((d) => Math.hypot(p.x - d.x, p.z - d.z) - p.r > districtPlazaRadius(d.size)))).toEqual([]);
      expect(
        failing((p) => [p, ...Array.from({ length: 8 }, (_, k) => ({ x: p.x + Math.cos(k) * p.r, z: p.z + Math.sin(k) * p.r }))].every((q) => !inSettlement(city.districts, q.x, q.z))),
      ).toEqual([]);
      expect(failing((p) => slots.every((s) => Math.hypot(p.x - s.x, p.z - s.y) - p.r > 2.1))).toEqual([]);
    });

    it('stays off the footpaths and their hedges', () => {
      const lines = [...park.paths.values()];
      expect(failing((p) => lines.every((line) => distToPolyline(p, line) - p.r > PATH_WIDTH / 2 + SHRUB_MARGIN - 1e-6))).toEqual([]);
    });

    it("keeps clear of the decor trees' trunks", () => {
      expect(failing((p) => park.trees.every((t) => Math.hypot(p.x - t.x, p.z - t.z) - p.r > 0.24 * t.scale))).toEqual([]);
    });

    it('leaves every landmark site empty', () => {
      const sites = landmarkSites(city);
      expect(failing((p) => sites.every((s) => Math.hypot(p.x - s.x, p.z - s.z) - p.r >= s.radius + LANDMARK_MARGIN))).toEqual([]);
    });

    it('keeps ponds apart, with their lilies, reeds and ducks on the water', () => {
      nature.ponds.forEach((a, i) =>
        nature.ponds.slice(i + 1).forEach((b) => expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(pondReach(a) + pondReach(b))),
      );
      const onPond = (x: number, z: number, k: number) =>
        nature.ponds.some((p) => Math.hypot(x - p.x, z - p.z) < pondRadiusAt(p, Math.atan2(z - p.z, x - p.x)) * k);
      expect(nature.lilies.every((l) => onPond(l.x, l.z, 0.95))).toBe(true);
      expect([...nature.reeds, ...nature.cattails].every((r) => onPond(r.x, r.z, 1.1))).toBe(true);
      for (const d of nature.ducks) {
        const p = nature.ponds[d.pond]!;
        expect(d.orbit).toBeLessThan(p.radius * Math.min(...p.shape) * 0.5);
      }
    });

    it('is wilder toward the rim than near HQ', () => {
      const mid = (city.plazaRadius + PLATFORM_RADIUS) / 2;
      const outer = prints.filter((p) => Math.hypot(p.x, p.z) > mid && p.kind !== 'flower').length;
      const inner = prints.filter((p) => Math.hypot(p.x, p.z) <= mid && p.kind !== 'flower').length;
      expect(outer).toBeGreaterThan(inner);
    });
  });
}
