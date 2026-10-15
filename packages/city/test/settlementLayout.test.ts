import { describe, expect, it } from 'vitest';
import { districtPlazaRadius, PLATFORM_RADIUS, type District } from '../src/layout.ts';
import { PROPS } from '../src/scene/props.ts';
import { HOUSES, houseCount, houseSpots, inSettlement, layoutSettlement, type HouseSpot } from '../src/scene/settlement/settlementLayout.ts';

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

  it('is deterministic, so a house never moves between visits', () => {
    expect(houseSpots(d)).toEqual(spots);
  });

  it('only adds houses as a district grows: each level keeps every earlier house in place', () => {
    const town = layoutSettlement(d, 3).houses;
    const borough = layoutSettlement(d, 4).houses;
    expect(borough.slice(0, town.length)).toEqual(town);
  });

  it('keeps houses apart, off the plaza, and on the side facing away from HQ', () => {
    const plaza = districtPlazaRadius(d.size);
    for (const [i, h] of spots.entries()) {
      expect(dist(h, centre)).toBeGreaterThan(plaza + 3);
      expect(Math.abs(offsetDeg(h))).toBeLessThanOrEqual(75);
      expect(Math.hypot(h.x, h.z)).toBeLessThan(PLATFORM_RADIUS - 7);
      for (const other of spots.slice(i + 1)) expect(dist(h, other)).toBeGreaterThan(4.5);
    }
  });

  it('starts small and close: the first houses sit in the front row near the district axis', () => {
    const plaza = districtPlazaRadius(d.size);
    for (const h of spots.slice(0, 2)) {
      expect(dist(h, centre)).toBeLessThan(plaza + 6);
      expect(Math.abs(offsetDeg(h))).toBeLessThan(30);
    }
    for (const h of spots.slice(0, 2)) expect(HOUSES[h.house].floors).toBe(1);
    expect(spots.slice(-6).some((h) => HOUSES[h.house].floors > 1)).toBe(true);
  });

  it("never lets two houses' footprints touch, even the largest models side by side", () => {
    for (const small of [d, district(Math.PI / 4, 8.75)]) {
      const all = houseSpots(small);
      for (const [i, h] of all.entries()) for (const other of all.slice(i + 1)) expect(overlap(houseFootprint(h), houseFootprint(other))).toBe(false);
    }
  });

  it('turns each house to face the plaza', () => {
    for (const h of spots) {
      // the house's local +z axis, rotated by rot about y, points back at the district centre
      const fx = Math.sin(h.rot);
      const fz = Math.cos(h.rot);
      const toCentre = { x: (d.x - h.x) / dist(h, centre), z: (d.z - h.z) / dist(h, centre) };
      expect(fx * toCentre.x + fz * toCentre.z).toBeGreaterThan(0.99);
    }
  });

  it('fits a small district too, with fewer spots', () => {
    const small = houseSpots(district(Math.PI / 4, 8.75));
    expect(small.length).toBeGreaterThanOrEqual(22);
    expect(small.length).toBeLessThan(spots.length);
  });
});

describe('layoutSettlement: what each level unlocks', () => {
  it('adds a well, then lanes, then a fountain, then lamps', () => {
    const at = (level: number) => layoutSettlement(d, level).features;
    expect(at(1)).toEqual({ lamps: [], lanes: [], cars: [] });
    expect(at(2).well).toBeDefined();
    expect(at(2).lanes).toEqual([]);
    expect(at(3).lanes.length).toBeGreaterThan(0);
    expect(at(3).fountain).toBeUndefined();
    expect(at(4).fountain).toBeDefined();
    expect(at(4).lamps).toEqual([]);
    expect(at(5).lamps.length).toBeGreaterThan(0);
  });

  it('keeps houses clear of the well, the fountain and the lamps', () => {
    const s = layoutSettlement(d, 9);
    for (const h of s.houses) {
      expect(dist(h, s.features.well!)).toBeGreaterThan(3.5);
      expect(dist(h, s.features.fountain!)).toBeGreaterThan(4);
      for (const lamp of s.features.lamps) expect(dist(h, lamp)).toBeGreaterThan(2);
    }
  });
});

describe('parked cars: a City upgrade', () => {
  it('arrive at City level, one more per City level after that', () => {
    expect(layoutSettlement(d, 4).features.cars).toEqual([]);
    expect(layoutSettlement(d, 5).features.cars).toHaveLength(3);
    expect(layoutSettlement(d, 7).features.cars).toHaveLength(5);
    expect(layoutSettlement(d, 20).features.cars).toHaveLength(8);
  });

  it('park on a lane, along it, clear of houses, lamps, the well and the fountain', () => {
    const s = layoutSettlement(d, 20);
    const lanes = s.features.lanes.map((l) => l.radius);
    for (const car of s.features.cars) {
      const r = dist(car, centre);
      expect(Math.min(...lanes.map((l) => Math.abs(r - l)))).toBeLessThan(0.01);
      // its length (local +x) runs along the lane: perpendicular to the direction from the centre
      const along = { x: Math.cos(car.rot), z: -Math.sin(car.rot) };
      expect(Math.abs((along.x * (car.x - d.x) + along.z * (car.z - d.z)) / r)).toBeLessThan(0.01);
      const reach = PROPS.cars[car.car].width / 2; // half its length
      const size = PROPS.cars[car.car];
      for (const h of s.houses) expect(overlap(footprint(car, size.width, size.depth), houseFootprint(h))).toBe(false);
      for (const lamp of s.features.lamps) expect(dist(car, lamp)).toBeGreaterThan(reach + 0.5);
      expect(dist(car, s.features.well!)).toBeGreaterThan(reach + 1);
      expect(dist(car, s.features.fountain!)).toBeGreaterThan(reach + 2);
    }
    expect(s.features.cars.every((c) => !['car_10', 'car_11', 'car_12'].includes(c.car))).toBe(true);
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
