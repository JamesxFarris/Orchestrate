import { describe, expect, it } from 'vitest';
import { districtPlazaRadius, layoutCity, PLATFORM_RADIUS, type CityLayout } from '../src/layout.ts';
import { buildParkLayout, PATH_WIDTH } from '../src/scene/park/parkLayout.ts';
import { districtRing, landmarkSites, landmarksBuilt, layoutLandmarks, SITE_RADIUS } from '../src/scene/park/landmarksLayout.ts';
import { inSettlement, layoutSettlement } from '../src/scene/settlement/settlementLayout.ts';
import type { Team } from '../src/store.ts';

/** A team of `squads` squads, each a lead plus `devs` engineers. */
const team = (squads: number, devs: number): Team =>
  ({
    squads: Array.from({ length: squads }, (_, i) => ({ id: `squad-${i}`, name: `Squad ${i}`, color: '#e4572e', mission: '' })),
    roles: [
      { id: 'boss', title: 'VP', kind: 'master', tier: 'exec' },
      ...Array.from({ length: squads }, (_, i) => [
        { id: `lead-${i}`, title: 'Lead', kind: 'lead', tier: 'lead', squad: `squad-${i}` },
        ...Array.from({ length: devs }, (_, j) => ({ id: `dev-${i}-${j}`, title: 'Dev', kind: 'dev', tier: 'senior', squad: `squad-${i}` })),
      ]).flat(),
    ],
  }) as unknown as Team;

const cities: [string, CityLayout][] = [];
for (let n = 2; n <= 8; n++) for (const devs of [1, 3, 5]) cities.push([`${n} squads x ${devs + 1}`, layoutCity(team(n, devs))]);

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const angleOf = (p: { x: number; z: number }) => Math.atan2(p.z, p.x);
const angleBetween = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

function distToPolyline(p: { x: number; z: number }, line: { x: number; y: number }[]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const abx = b.x - a.x;
    const abz = b.y - a.y;
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.z - a.y) * abz) / Math.max(abx * abx + abz * abz, 1e-6)));
    best = Math.min(best, Math.hypot(p.x - a.x - abx * t, p.z - a.y - abz * t));
  }
  return best;
}

describe('landmarkSites: where landmarks stand', () => {
  it('is deterministic', () => {
    for (const [, city] of cities) expect(landmarkSites(city)).toEqual(landmarkSites(city));
  });

  it('puts one site midway between each pair of neighbouring districts, on the district ring when it fits', () => {
    const city = layoutCity(team(4, 2));
    const sites = landmarkSites(city);
    expect(sites).toHaveLength(4);
    const ring = districtRing(city);
    sites.forEach((s, i) => {
      const a = city.districts[i]!.angle;
      // four squads: districts a quarter turn apart, the site an eighth of a turn past each
      expect(angleBetween(angleOf(s), a + Math.PI / 4)).toBeLessThan(1e-9);
      expect(Math.hypot(s.x, s.z)).toBeCloseTo(ring, 6);
      expect(s.radius).toBe(SITE_RADIUS);
    });
  });

  it('gives two squads a site on each side', () => {
    expect(landmarkSites(layoutCity(team(2, 2)))).toHaveLength(2);
  });

  it('has a site between every pair of districts for 2..8 squads, each on its midway ray', () => {
    for (const [name, city] of cities) {
      const sites = landmarkSites(city);
      expect(sites.length, name).toBe(city.districts.length);
      sites.forEach((s, i) => {
        const a = city.districts[i]!.angle;
        let gap = city.districts[(i + 1) % city.districts.length]!.angle - a;
        while (gap <= 0) gap += Math.PI * 2;
        expect(angleBetween(angleOf(s), a + gap / 2), name).toBeLessThan(1e-9);
        expect(s.radius, name).toBeGreaterThanOrEqual(6);
        expect(s.radius, name).toBeLessThanOrEqual(SITE_RADIUS);
      });
    }
  });

  it('never overlaps a district plaza, task tree, footpath, settlement, HQ or the platform edge', () => {
    for (const [name, city] of cities) {
      const park = buildParkLayout(city);
      for (const s of landmarkSites(city)) {
        expect(Math.hypot(s.x, s.z) - s.radius, name).toBeGreaterThan(city.plazaRadius);
        expect(Math.hypot(s.x, s.z) + s.radius, name).toBeLessThan(PLATFORM_RADIUS - 4);
        for (const d of city.districts) expect(dist(s, d) - s.radius, name).toBeGreaterThan(districtPlazaRadius(d.size) + 2);
        for (const slots of park.taskSlots.values()) for (const t of slots) expect(Math.hypot(t.x - s.x, t.y - s.z) - s.radius, name).toBeGreaterThan(2.1);
        for (const line of park.paths.values()) expect(distToPolyline(s, line) - s.radius, name).toBeGreaterThan(PATH_WIDTH / 2 + 1);
        // sample the whole disc against every settlement band, and every house the full-grown town will have
        for (let k = 0; k <= 4; k++)
          for (let i = 0; i < 48; i++) {
            const a = (i / 48) * Math.PI * 2;
            const r = (s.radius * k) / 4;
            expect(inSettlement(city.districts, s.x + Math.cos(a) * r, s.z + Math.sin(a) * r), name).toBe(false);
          }
        for (const d of city.districts) for (const h of layoutSettlement(d, 9).houses) expect(dist(h, s) - s.radius, name).toBeGreaterThan(3);
      }
    }
  });

  it('keeps sites apart from each other', () => {
    for (const [name, city] of cities) {
      const sites = landmarkSites(city);
      for (let i = 0; i < sites.length; i++)
        for (let j = i + 1; j < sites.length; j++) expect(dist(sites[i]!, sites[j]!), name).toBeGreaterThan(sites[i]!.radius + sites[j]!.radius);
    }
  });

  it('keeps decor trees and path hedges out of every site', () => {
    for (const [name, city] of cities) {
      const park = buildParkLayout(city);
      for (const s of landmarkSites(city)) {
        for (const t of park.trees) expect(dist(t, s), name).toBeGreaterThan(s.radius);
        for (const b of park.shrubs) expect(dist(b, s), name).toBeGreaterThan(s.radius);
      }
    }
  });
});

describe('layoutLandmarks: what stands where, and in what order', () => {
  it('gives every site a landmark, a distinct unlock rank, and a front facing HQ', () => {
    for (const [name, city] of cities) {
      const marks = layoutLandmarks(city);
      expect(marks.map((m) => m.rank).sort((a, b) => a - b), name).toEqual(marks.map((_, i) => i));
      for (const m of marks) {
        // local +z rotated by rot points at the origin
        const fx = Math.sin(m.rot);
        const fz = Math.cos(m.rot);
        expect(fx * -m.x + fz * -m.z, name).toBeCloseTo(Math.hypot(m.x, m.z), 6);
      }
    }
  });

  it('builds a grand fountain first, then a statue, a bandstand, an arch and an obelisk', () => {
    const marks = layoutLandmarks(layoutCity(team(6, 1)));
    const byRank = [...marks].sort((a, b) => a.rank - b.rank);
    expect(byRank.map((m) => m.kind)).toEqual(['fountain', 'statue', 'bandstand', 'arch', 'obelisk', 'fountain']);
    expect(byRank.map((m) => m.variant)).toEqual([0, 0, 0, 0, 0, 1]);
  });

  it('never puts the same landmark on neighbouring sites', () => {
    for (const [name, city] of cities) {
      const marks = layoutLandmarks(city);
      if (marks.length < 3) continue;
      marks.forEach((m, i) => expect(m.kind, name).not.toBe(marks[(i + 1) % marks.length]!.kind));
    }
  });

  it('builds the first landmark where the default camera looks, then spreads the rest round the ring', () => {
    const city = layoutCity(team(4, 2));
    const byRank = [...layoutLandmarks(city)].sort((a, b) => a.rank - b.rank);
    expect(angleBetween(angleOf(byRank[0]!), Math.PI / 4)).toBeLessThan(Math.PI / 4 + 1e-9);
    // the second is opposite the first
    expect(angleBetween(angleOf(byRank[0]!), angleOf(byRank[1]!))).toBeCloseTo(Math.PI, 6);
  });

  it('has a stable unlock order', () => {
    for (const [name, city] of cities) expect(layoutLandmarks(city), name).toEqual(layoutLandmarks(city));
  });
});

describe('landmarksBuilt: landmarks are earned as the whole city grows', () => {
  it('builds none while the city is all hamlets, and all of them at City', () => {
    expect(landmarksBuilt([1, 1, 1, 1], 4)).toBe(0);
    expect(landmarksBuilt([5, 5, 5, 5], 4)).toBe(4);
    expect(landmarksBuilt([7, 9, 5, 6], 4)).toBe(4);
  });

  it('adds a share for each step of the mean settlement level', () => {
    expect([1, 2, 3, 4, 5].map((l) => landmarksBuilt([l, l, l, l], 4))).toEqual([0, 1, 2, 3, 4]);
    expect([1, 2, 3, 4, 5].map((l) => landmarksBuilt([l, l, l, l, l, l, l, l], 8))).toEqual([0, 2, 4, 6, 8]);
    expect([1, 2, 3, 4, 5].map((l) => landmarksBuilt([l, l], 2))).toEqual([0, 1, 1, 2, 2]);
  });

  it('never goes down as any district grows', () => {
    let prev = 0;
    const levels = [1, 1, 1, 1, 1];
    for (let step = 0; step < 20; step++) {
      levels[step % 5]! += 1;
      const now = landmarksBuilt(levels, 5);
      expect(now).toBeGreaterThanOrEqual(prev);
      prev = now;
    }
    expect(prev).toBe(5);
  });

  it('builds nothing without districts or sites', () => {
    expect(landmarksBuilt([], 4)).toBe(0);
    expect(landmarksBuilt([3, 3], 0)).toBe(0);
  });
});
