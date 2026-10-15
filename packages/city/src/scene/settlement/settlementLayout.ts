import { districtPlazaRadius, type District } from '../../layout.ts';
import { rng } from '../rng.ts';

/**
 * Where a district's settlement stands. Pure and deterministic: every district has a fixed, ordered
 * list of house spots, and its level only decides how many of them are built. Growing adds houses;
 * it never moves one. Houses fill the side of the plaza facing away from HQ (the other side is the
 * footpath and this run's task trees).
 */

export interface HouseSpot {
  x: number;
  z: number;
  /** Rotation about y; the house's local +z faces the plaza. */
  rot: number;
  width: number;
  depth: number;
  /** Wall height: later houses are taller, so towns read as two storeys. */
  height: number;
  /** 0–1, varies the roof shade within the squad's colour. */
  shade: number;
}

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
  /** City and up: street lamps that glow. */
  lamps: Point[];
}

export interface Settlement {
  houses: HouseSpot[];
  features: SettlementFeatures;
}

/** Houses per level: Hamlet 2, Village 6, Town 10, Borough 15, City 22, then +3 per City level. */
const LADDER = [2, 6, 10, 15, 22];

/** Half-width of the settlement's arc, either side of the district's outward direction. */
const ARC = (70 * Math.PI) / 180;
/** Row distances beyond the plaza edge; lanes run between them. */
const ROWS = [5, 10.5, 16];
const LANES = [7.75, 13.25];
/** Gap between neighbours along a row: tighter on short rows so a small district can still become a City. */
const spacingAt = (r: number) => Math.min(6.5, Math.max(5.4, r * 0.26));

export function houseCount(level: number, room: number): number {
  const n = level <= LADDER.length ? LADDER[Math.max(1, level) - 1]! : LADDER[LADDER.length - 1]! + 3 * (level - LADDER.length);
  return Math.min(n, room);
}

const polar = (d: District, r: number, offset: number): Point => ({ x: d.x + Math.cos(d.angle + offset) * r, z: d.z + Math.sin(d.angle + offset) * r });
const seedOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Fixed spots for the well and fountain, on the district's axis; houses never take them. */
function featureSpots(d: District) {
  const plaza = districtPlazaRadius(d.size);
  return { well: polar(d, plaza + ROWS[0]!, 0), fountain: polar(d, plaza + ROWS[1]!, 0) };
}

/** Every house spot the district has room for, in the order they are built. */
export function houseSpots(d: District): HouseSpot[] {
  const plaza = districtPlazaRadius(d.size);
  const rand = rng(seedOf(d.squad.id));
  const reserved = featureSpots(d);
  const candidates: (Point & { score: number })[] = [];

  ROWS.forEach((row, ri) => {
    const r = plaza + row;
    const n = Math.floor((2 * ARC * r) / spacingAt(r));
    for (let i = 0; i < n; i++) {
      const offset = -ARC + ((i + 0.5) * 2 * ARC) / n + (rand() - 0.5) * 0.04;
      const p = polar(d, r, offset);
      const clearWell = Math.hypot(p.x - reserved.well.x, p.z - reserved.well.z) > 4.2;
      const clearFountain = Math.hypot(p.x - reserved.fountain.x, p.z - reserved.fountain.z) > 4.8;
      if (!clearWell || !clearFountain) continue;
      // Build outward from the front row and the axis, so a hamlet sits by the plaza and a city spreads.
      candidates.push({ ...p, score: ri * 1.0 + (Math.abs(offset) / ARC) * 1.4 + rand() * 0.25 });
    }
  });

  candidates.sort((a, b) => a.score - b.score);
  return candidates.map((p, i) => {
    const t = candidates.length > 1 ? i / (candidates.length - 1) : 0;
    return {
      x: p.x,
      z: p.z,
      rot: Math.atan2(d.x - p.x, d.z - p.z),
      width: 2.6 + rand() * 0.8,
      depth: 2.2 + rand() * 0.6,
      height: 1.7 + t * 1.3 + rand() * 0.3,
      shade: rand(),
    };
  });
}

export function layoutSettlement(d: District, level: number): Settlement {
  const spots = houseSpots(d);
  const plaza = districtPlazaRadius(d.size);
  const { well, fountain } = featureSpots(d);
  const lamps = level >= 5 ? LANES.flatMap((lane) => [-0.95, -0.45, 0.45, 0.95].map((k) => polar(d, plaza + lane, k * ARC))) : [];
  return {
    houses: spots.slice(0, houseCount(level, spots.length)),
    features: {
      well: level >= 2 ? well : undefined,
      lanes: level >= 3 ? LANES.map((lane) => ({ radius: plaza + lane, start: d.angle - ARC - 0.06, length: 2 * ARC + 0.12 })) : [],
      fountain: level >= 4 ? fountain : undefined,
      lamps,
    },
  };
}

/** True inside any district's settlement band, so scenery trees grow elsewhere. */
export function inSettlement(districts: readonly District[], x: number, z: number): boolean {
  for (const d of districts) {
    const plaza = districtPlazaRadius(d.size);
    const r = Math.hypot(x - d.x, z - d.z);
    if (r < plaza || r > plaza + ROWS[ROWS.length - 1]! + 3) continue;
    const a = Math.atan2(z - d.z, x - d.x) - d.angle;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) <= ARC + 0.15) return true;
  }
  return false;
}
