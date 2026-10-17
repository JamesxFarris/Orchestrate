import { describe, expect, it } from 'vitest';
import { districtPlazaRadius, PLATFORM_RADIUS, type District } from '../src/layout.ts';
import { HOUSES, layoutSettlement, TOWN_REACH } from '../src/scene/settlement/settlementLayout.ts';
import { layoutTown, TOWN, type TownPiece } from '../src/scene/settlement/townLayout.ts';

const district = (id: string, angle: number, size = 20.25, radius = 64): District => ({
  squad: { id, name: id, color: '#f2a541', mission: '' },
  angle,
  x: Math.cos(angle) * radius,
  z: Math.sin(angle) * radius,
  size,
});
const districts = [district('gameplay', -2.36), district('engine', -0.79, 8.75), district('render', 0.79, 14.5, 75.5), district('research', 2.36)];
const townAt = (d: District, level: number) => layoutTown(d, level, layoutSettlement(d, level));
const key = (p: TownPiece) => `${p.piece}@${p.x.toFixed(3)},${p.z.toFixed(3)}`;
const kinds = (t: { pieces: TownPiece[] }, prefix: string) => t.pieces.filter((p) => p.piece.startsWith(prefix)).length;
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe('layoutTown: what grows around the village', () => {
  const d = districts[0]!;

  it('adds pieces level by level and never moves one', () => {
    for (const dd of districts) {
      for (let level = 1; level < 12; level++) {
        const now = new Set(townAt(dd, level).pieces.map(key));
        for (const k of now) expect(new Set(townAt(dd, level + 1).pieces.map(key)), `${dd.squad.id} L${level} -> L${level + 1}: ${k}`).toContain(k);
      }
    }
  });

  it('follows the ladder: flowers, then lane benches, then road and shops, then towers', () => {
    expect(townAt(d, 1).pieces).toEqual([]);
    expect(kinds(townAt(d, 2), 'flower_')).toBeGreaterThanOrEqual(5);
    expect(kinds(townAt(d, 2), 'bench')).toBe(1);
    expect(kinds(townAt(d, 3), 'statue_column')).toBe(4);
    expect(kinds(townAt(d, 3), 'planter')).toBeGreaterThan(0);
    expect(townAt(d, 3).road).toBeUndefined();
    const borough = townAt(d, 4);
    expect(borough.road).toBeDefined();
    expect(kinds(borough, 'shop_')).toBe(3);
    expect(kinds(borough, 'car_')).toBe(2);
    expect(kinds(borough, 'traffic_light')).toBe(0);
    expect(kinds(townAt(d, 5), 'traffic_light')).toBe(2);
    expect(kinds(townAt(d, 5), 'tower_')).toBe(0);
    expect(kinds(townAt(d, 8), 'tower_')).toBe(3);
  });

  it('keeps everything apart: no piece on a house spot, the well, or another piece', () => {
    for (const dd of districts) {
      const village = layoutSettlement(dd, 12);
      const t = layoutTown(dd, 12, village);
      const r = (p: TownPiece) => (Math.max(TOWN[p.piece].width, TOWN[p.piece].depth) / 2) * 0.7;
      for (const p of t.pieces) {
        for (const h of village.allHouses) expect(dist(p, h)).toBeGreaterThan(Math.max(HOUSES[h.house].width, HOUSES[h.house].depth) / 2 + r(p) - 0.01);
        expect(dist(p, village.spots.well)).toBeGreaterThan(1.2 + r(p) - 0.01);
      }
      for (const [i, a] of t.pieces.entries()) for (const b of t.pieces.slice(i + 1)) expect(dist(a, b), `${a.piece} / ${b.piece}`).toBeGreaterThan(r(a) + r(b) - 0.01);
    }
  });

  it('stands the new town outside the village, on the island, within the band scenery trees avoid', () => {
    for (const dd of districts) {
      const t = townAt(dd, 12);
      const plaza = districtPlazaRadius(dd.size);
      for (const p of t.pieces.filter((x) => /^(shop|tower)_/.test(x.piece))) {
        expect(dist(p, dd)).toBeGreaterThan(t.road!.radius + t.road!.halfWidth);
        expect(dist(p, dd)).toBeLessThan(plaza + TOWN_REACH);
        expect(Math.hypot(p.x, p.z)).toBeLessThan(PLATFORM_RADIUS);
      }
    }
  });

  it('parks cars on the road, along it', () => {
    const t = townAt(d, 9);
    for (const car of t.pieces.filter((p) => p.piece.startsWith('car_'))) {
      const r = dist(car, d);
      expect(Math.abs(r - t.road!.radius)).toBeLessThan(t.road!.halfWidth);
      const theta = Math.atan2(car.z - d.z, car.x - d.x);
      const along = { x: Math.sin(car.rot), z: Math.cos(car.rot) }; // local +z
      // perpendicular to the direction from the district centre, i.e. along the ring
      expect(Math.abs(along.x * Math.cos(theta) + along.z * Math.sin(theta))).toBeLessThan(0.01);
    }
  });

  it('gives every district its own town', () => {
    const shops = districts.map((dd) => townAt(dd, 8).pieces.filter((p) => p.piece.startsWith('shop_')).map((p) => p.piece).join());
    expect(new Set(shops).size).toBe(districts.length);
  });
});
