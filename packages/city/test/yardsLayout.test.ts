import { describe, expect, it } from 'vitest';
import { districtPlazaRadius, type District } from '../src/layout.ts';
import { HOUSES, houseSpots, inSettlement, layoutSettlement, type HouseSpot } from '../src/scene/settlement/settlementLayout.ts';
import { layoutYards, levelOfHouse, yardItems, type YardItem } from '../src/scene/settlement/yardsLayout.ts';

const district = (angle: number, size = 20.25, radius = 64, id = 'render'): District => ({
  squad: { id, name: 'Render & UI', color: '#f2a541', mission: '' },
  angle,
  x: Math.cos(angle) * radius,
  z: Math.sin(angle) * radius,
  size,
});

const d = district(-Math.PI / 4);
const small = district(Math.PI / 4, 8.75, 64, 'small');
type P = { x: number; z: number };

/** An oriented rectangle's corners (local z rotated by rot about y), the same convention as the houses. */
const rect = (c: P, rot: number, hw: number, hd: number): P[] => {
  const [cs, sn] = [Math.cos(rot), Math.sin(rot)];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({ x: c.x + a! * hw * cs + b! * hd * sn, z: c.z - a! * hw * sn + b! * hd * cs }));
};
const house = (h: HouseSpot) => rect(h, h.rot, HOUSES[h.house].width / 2, HOUSES[h.house].depth / 2);
const item = (it: YardItem) => rect(it, it.rot, it.hw, it.hd);

// separating-axis test for two rectangles
const overlap = (p: P[], q: P[]) =>
  [p, q].every((poly) =>
    poly.every((a, i) => {
      const b = poly[(i + 1) % 4]!;
      const axis = { x: -(b.z - a.z), z: b.x - a.x };
      const proj = (pts: P[]) => pts.map((v) => v.x * axis.x + v.z * axis.z);
      return Math.max(...proj(p)) > Math.min(...proj(q)) && Math.max(...proj(q)) > Math.min(...proj(p));
    }),
  );

/** Closest and farthest distance of a rectangle from a point, sampled densely along its edges. */
const reach = (poly: P[], c: P) => {
  const ds: number[] = [];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % 4]!;
    for (let t = 0; t <= 1; t += 0.05) ds.push(Math.hypot(a.x + (b.x - a.x) * t - c.x, a.z + (b.z - a.z) * t - c.z));
  });
  return [Math.min(...ds), Math.max(...ds)] as const;
};

describe('yardItems: gardens, trees and paths around the houses', () => {
  it('is deterministic, so a garden never moves between visits', () => {
    expect(yardItems(d)).toEqual(yardItems(d));
    expect(layoutYards(d, 5)).toEqual(layoutYards(d, 5));
  });

  it('only adds pieces as a district grows: each level keeps every earlier piece in place', () => {
    for (const town of [d, small]) {
      for (let level = 1; level < 8; level++) {
        const now = layoutYards(town, level);
        const next = layoutYards(town, level + 1);
        for (const it of now) expect(next).toContainEqual(it);
        expect(next.length).toBeGreaterThanOrEqual(now.length);
      }
    }
  });

  it('grows with the town: a hamlet gets a little, a city is lush', () => {
    const count = (level: number, kinds?: string[]) => layoutYards(d, level).filter((it) => !kinds || kinds.includes(it.kind)).length;
    expect(count(1)).toBeGreaterThanOrEqual(3);
    expect(count(1)).toBeLessThan(count(3));
    expect(count(5)).toBeGreaterThan(count(1) * 6);
    const greenery = ['tree', 'conifer', 'fruitTree', 'bush'];
    expect(count(5, greenery)).toBeGreaterThan(count(2, greenery) * 3);
    const kinds = new Set(layoutYards(d, 5).map((it) => it.kind));
    for (const k of ['path', 'fence', 'flowers', 'crops', 'bush', 'tree', 'woodpile']) expect(kinds).toContain(k);
  });

  it('only gives a house its yard once the house stands', () => {
    const spots = houseSpots(d);
    for (const it of yardItems(d)) {
      // a piece next to an unbuilt house waits for it
      const nearest = spots.reduce((best, h, i) => (Math.hypot(h.x - it.x, h.z - it.z) < Math.hypot(spots[best]!.x - it.x, spots[best]!.z - it.z) ? i : best), 0);
      if (it.kind === 'path') expect(it.level).toBeGreaterThanOrEqual(levelOfHouse(nearest));
    }
  });

  it('never overlaps a house, built or still to come', () => {
    for (const town of [d, small]) {
      const houses = houseSpots(town).map(house);
      for (const it of yardItems(town)) for (const h of houses) expect(overlap(item(it), h)).toBe(false);
    }
  });

  it('keeps off the lanes, the plaza and the market ground round the well and fountain', () => {
    for (const town of [d, small]) {
      const { features } = layoutSettlement(town, 9);
      const plaza = districtPlazaRadius(town.size);
      const centre = { x: town.x, z: town.z };
      for (const it of yardItems(town)) {
        const poly = item(it);
        const [near, far] = reach(poly, centre);
        expect(near).toBeGreaterThan(plaza);
        for (const lane of features.lanes) expect(far < lane.radius - 1.1 || near > lane.radius + 1.1).toBe(true);
        expect(reach(poly, features.well!)[0]).toBeGreaterThan(3);
        expect(reach(poly, features.fountain!)[0]).toBeGreaterThan(3);
      }
    }
  });

  it('keeps pieces apart (a fence or hedge only meets its own pieces)', () => {
    const all = yardItems(d);
    for (const [i, a] of all.entries()) {
      for (const b of all.slice(i + 1)) {
        const runs = (k: string) => k === 'fence' || k === 'hedge';
        if (runs(a.kind) && runs(b.kind)) continue;
        expect(overlap(item(a), item(b))).toBe(false);
      }
    }
  });

  it('stays inside the settlement band, where the park plants no scenery trees', () => {
    for (const town of [d, small]) for (const it of yardItems(town)) expect(inSettlement([town], it.x, it.z)).toBe(true);
  });
});

describe('levelOfHouse: when each house is built', () => {
  it('follows the settlement ladder', () => {
    expect([0, 1, 2, 5, 6, 21, 22, 25].map(levelOfHouse)).toEqual([1, 1, 2, 2, 3, 5, 6, 7]);
  });
});
