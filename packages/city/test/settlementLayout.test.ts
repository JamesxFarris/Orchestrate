import { describe, expect, it } from 'vitest';
import { districtPlazaRadius, PLATFORM_RADIUS, type District } from '../src/layout.ts';

import { HOUSES, houseCount, houseSpots, inSettlement, LANE_HALF_WIDTH, layoutSettlement, shapeOf, type HouseSpot } from '../src/scene/settlement/settlementLayout.ts';

const district = (angle: number, size = 20.25, radius = 64): District => ({
  squad: { id: 'render', name: 'Render & UI', color: '#f2a541', mission: '' },
  angle,
  x: Math.cos(angle) * radius,
  z: Math.sin(angle) * radius,
  size,
});

const d = district(-Math.PI / 4);
const centre = { x: d.x, z: d.z };
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
/** Angle of a point around the district centre, relative to the district's outward direction, in degrees. */
const offsetDeg = (p: { x: number; z: number }) => {
  const a = Math.atan2(p.z - d.z, p.x - d.x) - d.angle;
  return (Math.atan2(Math.sin(a), Math.cos(a)) * 180) / Math.PI;
};

type XZ = { x: number; z: number };
/** A rectangle's corners: `width` along its local x, `depth` along local z, turned by `rot` about y. */
const footprint = (at: XZ & { rot: number }, width: number, depth: number): XZ[] => {
  const [c, s] = [Math.cos(at.rot), Math.sin(at.rot)];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
    const lx = (a! * width) / 2;
    const lz = (b! * depth) / 2;
    return { x: at.x + lx * c + lz * s, z: at.z - lx * s + lz * c };
  });
};
const houseFootprint = (h: HouseSpot) => footprint(h, HOUSES[h.house].width, HOUSES[h.house].depth);
/** Separating-axis test for two rectangles. */
const overlap = (p: XZ[], q: XZ[]) =>
  [p, q].every((poly) =>
    poly.every((a, i) => {
      const b = poly[(i + 1) % 4]!;
      const axis = { x: -(b.z - a.z), z: b.x - a.x };
      const proj = (pts: XZ[]) => pts.map((v) => v.x * axis.x + v.z * axis.z);
      return Math.max(...proj(p)) > Math.min(...proj(q)) && Math.max(...proj(q)) > Math.min(...proj(p));
    }),
  );

/** Angle around the district centre relative to its outward direction, in radians (-π..π). */
const offsetRad = (p: XZ) => (offsetDeg(p) * Math.PI) / 180;

describe('houseCount: a hamlet becomes a city', () => {
  it('follows the settlement ladder, then keeps adding a few per City level', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((level) => houseCount(level, 100))).toEqual([2, 6, 10, 15, 22, 25, 28]);
  });
  it('never exceeds the spots a district has room for', () => {
    expect(houseCount(9, 24)).toBe(24);
  });
});

describe('houseSpots: where houses go', () => {
  const spots = houseSpots(d);
  const shape = shapeOf(d);

  it('is deterministic, so a house never moves between visits', () => {
    expect(houseSpots(d)).toEqual(spots);
  });

  it('only adds houses as a district grows: each level keeps every earlier house in place', () => {
    const town = layoutSettlement(d, 3).houses;
    const borough = layoutSettlement(d, 4).houses;
    expect(borough.slice(0, town.length)).toEqual(town);
  });

  it("stays off the plaza, inside the district's own arc, and on the island", () => {
    const plaza = districtPlazaRadius(d.size);
    for (const h of spots) {
      expect(dist(h, centre)).toBeGreaterThan(plaza + 3);
      expect(offsetRad(h)).toBeGreaterThanOrEqual(shape.from - 0.05);
      expect(offsetRad(h)).toBeLessThanOrEqual(shape.to + 0.05);
      expect(Math.hypot(h.x, h.z)).toBeLessThan(PLATFORM_RADIUS - 7);
    }
  });

  it("never lets two houses' footprints touch, even the largest models side by side", () => {
    for (const small of [d, district(Math.PI / 4, 8.75)]) {
      const all = houseSpots(small);
      for (const [i, h] of all.entries()) for (const other of all.slice(i + 1)) expect(overlap(houseFootprint(h), houseFootprint(other))).toBe(false);
    }
  });

  it("starts small and close: the first houses sit in the front row near the town's middle", () => {
    const plaza = districtPlazaRadius(d.size);
    for (const h of spots.slice(0, 2)) {
      expect(dist(h, centre)).toBeLessThan(plaza + 6);
      expect(Math.abs(offsetRad(h) - shape.centre)).toBeLessThan(0.6);
      expect(HOUSES[h.house].floors).toBe(1);
    }
    expect(spots.slice(-6).some((h) => HOUSES[h.house].floors > 1)).toBe(true);
  });

  it('turns each house to face the plaza, give or take a little', () => {
    for (const h of spots) {
      const front = { x: Math.sin(h.rot), z: Math.cos(h.rot) };
      const toCentre = { x: (d.x - h.x) / dist(h, centre), z: (d.z - h.z) / dist(h, centre) };
      expect(front.x * toCentre.x + front.z * toCentre.z).toBeGreaterThan(Math.cos(0.11));
    }
  });

  it('fits a small district too, with fewer spots', () => {
    const small = houseSpots(district(Math.PI / 4, 8.75));
    expect(small.length).toBeGreaterThanOrEqual(22);
    expect(small.length).toBeLessThan(spots.length);
  });
});

describe('nothing mirrored: every district grows its own way', () => {
  const squads = ['gameplay', 'engine', 'render', 'research'];
  const of = (id: string) => ({ ...district(-Math.PI / 4), squad: { id, name: id, color: '#fff', mission: '' } });

  it('leans each town to one side, by a different amount per district', () => {
    const shapes = squads.map((id) => shapeOf(of(id)));
    for (const s of shapes) expect(Math.abs(s.to + s.from)).toBeGreaterThan(0.01); // lopsided
    expect(new Set(shapes.map((s) => s.from.toFixed(3))).size).toBe(squads.length);
  });

  it('spaces houses unevenly and puts the well and fountain off the axis', () => {
    const front = houseSpots(d)
      .filter((h) => dist(h, centre) < districtPlazaRadius(d.size) + 7)
      .map((h) => offsetRad(h))
      .sort((a, b) => a - b);
    const gaps = front.slice(1).map((a, i) => a - front[i]!);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(0.02);
    const s = layoutSettlement(d, 9).features;
    expect(Math.abs(offsetRad(s.well!))).toBeGreaterThan(0.05);
    expect(Math.abs(offsetRad(s.fountain!))).toBeGreaterThan(0.05);
  });
});

describe('layoutSettlement: what each level unlocks', () => {
  it('adds a well, then lanes, then a fountain, then lanterns', () => {
    const at = (level: number) => layoutSettlement(d, level).features;
    expect(at(1)).toEqual({ lamps: [], lanes: [] });
    expect(at(2).well).toBeDefined();
    expect(at(2).lanes).toEqual([]);
    expect(at(3).lanes.length).toBeGreaterThan(0);
    expect(at(3).fountain).toBeUndefined();
    expect(at(4).fountain).toBeDefined();
    expect(at(4).lamps).toEqual([]);
    expect(at(5).lamps.length).toBeGreaterThan(0);
  });

  it('keeps houses clear of the well, the fountain, the lanterns and the middle of the lanes', () => {
    const s = layoutSettlement(d, 9);
    for (const h of s.houses) {
      expect(dist(h, s.features.well!)).toBeGreaterThan(3.5);
      expect(dist(h, s.features.fountain!)).toBeGreaterThan(4);
      for (const lamp of s.features.lamps) expect(dist(h, lamp)).toBeGreaterThan(2);
      for (const lane of s.features.lanes) expect(Math.abs(dist(h, centre) - lane.radius)).toBeGreaterThan(LANE_HALF_WIDTH + 0.5);
    }
  });

  it('stands lanterns beside the lanes, at uneven spacing', () => {
    const s = layoutSettlement(d, 9).features;
    for (const lamp of s.lamps) {
      const off = Math.min(...s.lanes.map((l) => Math.abs(dist(lamp, centre) - l.radius)));
      expect(off).toBeCloseTo(LANE_HALF_WIDTH + 0.45, 1);
    }
    const onFirst = s.lamps.filter((l) => Math.abs(dist(l, centre) - s.lanes[0]!.radius) < 2).map(offsetRad).sort((a, b) => a - b);
    const gaps = onFirst.slice(1).map((a, i) => a - onFirst[i]!);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(0.02);
  });
});

describe('inSettlement: keeps scenery trees out of town', () => {
  it('covers house spots and lanes, but not the HQ side where task trees grow', () => {
    const plaza = districtPlazaRadius(d.size);
    for (const h of houseSpots(d)) expect(inSettlement([d], h.x, h.z)).toBe(true);
    const lane = plaza + 7.75;
    expect(inSettlement([d], d.x + Math.cos(d.angle) * lane, d.z + Math.sin(d.angle) * lane)).toBe(true);
    const back = d.angle + Math.PI;
    expect(inSettlement([d], d.x + Math.cos(back) * (plaza + 6), d.z + Math.sin(back) * (plaza + 6))).toBe(false);
  });
});
