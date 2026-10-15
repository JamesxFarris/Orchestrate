import { districtPlazaRadius, PLATFORM_RADIUS, type District } from '../../layout.ts';
import { rng } from '../rng.ts';
import kit from './kit.json';

/**
 * Where a district's settlement stands. Pure and deterministic: every district has a fixed, ordered
 * list of house spots, and its level only decides how many of them are built. Growing adds houses;
 * it never moves one. Houses fill the side of the plaza facing away from HQ (the other side is the
 * footpath and this run's task trees).
 *
 * Nothing is mirrored: each district gets its own shape (see `shapeOf`), with the town leaning to
 * one side, uneven gaps between houses, houses set a little in or out and turned, and the well,
 * fountain and lanterns wherever its seed puts them. Like a village that grew, not one that was drawn.
 */

export interface HouseSpot {
  x: number;
  z: number;
  /** Rotation about y; the house's local +z (its front door) faces the plaza, give or take a little. */
  rot: number;
  /** Which house model stands here: cottages first, two-storey houses as the town grows. */
  house: HouseName;
  /** 0–1, varies the roof shade within the squad's colour. */
  shade: number;
}

export type HouseName = keyof typeof kit.houses;
/** Model sizes in world units, written by tools/build-settlement.mjs. */
export const HOUSES: Record<HouseName, { width: number; depth: number; height: number; floors: number }> = kit.houses;

/** House models by how far out a spot is: small near the plaza, larger toward the edge of town. */
const TIERS: HouseName[][] = [
  ['cottage', 'croft'],
  ['cottage', 'croft', 'longhouse', 'townhouse'],
  ['townhouse', 'hall', 'tallhouse', 'longhouse'],
];

export interface Point {
  x: number;
  z: number;
}

export interface Lane {
  radius: number;
  /** Arc start and length in radians, around the district centre. */
  start: number;
  length: number;
}

export interface SettlementFeatures {
  /** Village and up. */
  well?: Point;
  /** Town and up: cobbled lanes between the rows of houses. */
  lanes: Lane[];
  /** Borough and up. */
  fountain?: Point;
  /** City and up: lanterns beside the lanes. */
  lamps: Point[];
}

export interface Settlement {
  houses: HouseSpot[];
  features: SettlementFeatures;
}

/** Houses per level: Hamlet 2, Village 6, Town 10, Borough 15, City 22, then +3 per City level. */
const LADDER = [2, 6, 10, 15, 22];

/** Row distances beyond the plaza edge; lanes run between the first three. The outer row fills last. */
const ROWS = [5, 10.5, 16, 21.5];
const LANES = [7.75, 13.25];
/** Half the width of a cobbled lane. */
export const LANE_HALF_WIDTH = 1.0;
/** Base gap between neighbours along a row: tighter on short rows so a small district can still become a City. */
const spacingAt = (r: number) => Math.min(6.5, Math.max(5.2, r * 0.26));

export function houseCount(level: number, room: number): number {
  const n = level <= LADDER.length ? LADDER[Math.max(1, level) - 1]! : LADDER[LADDER.length - 1]! + 3 * (level - LADDER.length);
  return Math.min(n, room);
}

const polar = (d: District, r: number, offset: number): Point => ({ x: d.x + Math.cos(d.angle + offset) * r, z: d.z + Math.sin(d.angle + offset) * r });
const seedOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/**
 * A district's own shape, from its seed. Angles are offsets from the district's outward direction.
 * - `from`/`to`: how far the town reaches on each side (they differ, so it leans one way).
 * - `centre`: where its middle is; the first houses go up near here.
 * - `well`/`fountain`: their angles, off the middle and on opposite sides of it.
 */
export function shapeOf(d: District) {
  const rand = rng(seedOf(d.squad.id) ^ 0x9e3779b9);
  const lean = (rand() - 0.5) * 0.4; // up to about ±11° off the axis
  const from = lean - (0.95 + rand() * 0.3);
  const to = lean + (0.95 + rand() * 0.3);
  const side = rand() < 0.5 ? -1 : 1;
  return {
    from,
    to,
    centre: lean,
    well: lean + side * (0.18 + rand() * 0.2),
    fountain: lean - side * (0.12 + rand() * 0.18),
  };
}

/** The well and fountain spots; houses never take them. */
function featureSpots(d: District) {
  const plaza = districtPlazaRadius(d.size);
  const s = shapeOf(d);
  return { well: polar(d, plaza + ROWS[0]!, s.well), fountain: polar(d, plaza + ROWS[1]!, s.fountain) };
}

/** Every house spot the district has room for, in the order they are built. */
export function houseSpots(d: District): HouseSpot[] {
  const plaza = districtPlazaRadius(d.size);
  const rand = rng(seedOf(d.squad.id));
  const shape = shapeOf(d);
  const reserved = featureSpots(d);
  const span = shape.to - shape.from;
  const candidates: (Point & { score: number; offset: number })[] = [];

  ROWS.forEach((row, ri) => {
    const r = plaza + row;
    // walk along the row with uneven steps, so gaps differ from house to house
    let along = spacingAt(r) * (0.5 + rand() * 0.3);
    while (along < span * r - spacingAt(r) * 0.4) {
      const offset = shape.from + along / r;
      const p = polar(d, r + (rand() - 0.5) * 0.8, offset); // set a little in or out
      along += spacingAt(r) * (0.95 + rand() * 0.25);
      const clearWell = Math.hypot(p.x - reserved.well.x, p.z - reserved.well.z) > 4.2;
      const clearFountain = Math.hypot(p.x - reserved.fountain.x, p.z - reserved.fountain.z) > 4.8;
      if (!clearWell || !clearFountain) continue;
      if (Math.hypot(p.x, p.z) > PLATFORM_RADIUS - 8) continue; // off the edge of the island
      // Build outward from the front row and the town's middle, so a hamlet sits by the plaza and a city spreads.
      const fromMiddle = Math.abs(offset - shape.centre) / (span / 2);
      candidates.push({ ...p, offset, score: ri * 1.0 + fromMiddle * 1.4 + rand() * 0.35 });
    }
  });

  candidates.sort((a, b) => a.score - b.score);
  return candidates.map((p, i) => {
    const t = candidates.length > 1 ? i / (candidates.length - 1) : 0;
    const tier = TIERS[t < 0.3 ? 0 : t < 0.6 ? 1 : 2]!;
    return {
      x: p.x,
      z: p.z,
      // face the plaza, turned a little either way
      rot: Math.atan2(d.x - p.x, d.z - p.z) + (rand() - 0.5) * 0.2,
      house: tier[Math.floor(rand() * tier.length)]!,
      shade: rand(),
    };
  });
}

/** Lanterns beside the lanes at uneven spacing, alternating sides, a different pattern per lane. */
function lanterns(d: District, plaza: number, lanes: Lane[]): Point[] {
  const rand = rng(seedOf(d.squad.id) ^ 0x1a77e5);
  const out: Point[] = [];
  lanes.forEach((lane, li) => {
    let along = 2 + rand() * 4;
    let side = li % 2 ? 1 : -1;
    while (along < lane.length * lane.radius - 2) {
      const offset = lane.start - d.angle + along / lane.radius;
      out.push(polar(d, lane.radius + side * (LANE_HALF_WIDTH + 0.45), offset));
      along += 7 + rand() * 5;
      side = -side;
    }
  });
  return out;
}

export function layoutSettlement(d: District, level: number): Settlement {
  const spots = houseSpots(d);
  const plaza = districtPlazaRadius(d.size);
  const shape = shapeOf(d);
  const { well, fountain } = featureSpots(d);
  const lanes = LANES.map((lane) => ({ radius: plaza + lane, start: d.angle + shape.from - 0.06, length: shape.to - shape.from + 0.12 }));
  const houses = spots.slice(0, houseCount(level, spots.length));
  return {
    houses,
    features: {
      well: level >= 2 ? well : undefined,
      lanes: level >= 3 ? lanes : [],
      fountain: level >= 4 ? fountain : undefined,
      // a lantern never stands where a house is
      lamps: level >= 5 ? lanterns(d, plaza, lanes).filter((l) => spots.every((h) => Math.hypot(h.x - l.x, h.z - l.z) > 2.3)) : [],
    },
  };
}

/** True inside any district's settlement band, so scenery trees grow elsewhere. */
export function inSettlement(districts: readonly District[], x: number, z: number): boolean {
  for (const d of districts) {
    const plaza = districtPlazaRadius(d.size);
    const r = Math.hypot(x - d.x, z - d.z);
    if (r < plaza || r > plaza + ROWS[ROWS.length - 1]! + 3) continue;
    const s = shapeOf(d);
    const a = Math.atan2(z - d.z, x - d.x) - d.angle;
    const rel = Math.atan2(Math.sin(a), Math.cos(a));
    if (rel >= s.from - 0.15 && rel <= s.to + 0.15) return true;
  }
  return false;
}
