import { districtPlazaRadius, PLATFORM_RADIUS, type District } from '../../layout.ts';
import { rng } from '../rng.ts';
import { HOUSES, LANE_HALF_WIDTH, shapeOf, type Settlement } from './settlementLayout.ts';
import town from './town.json';

/**
 * What grows around the old village as a district levels up, from Kenney's city kits (see
 * tools/build-town.mjs). Pure and deterministic like the village: a level only decides how much of
 * a fixed plan is built, so nothing ever moves.
 *
 *   Village (2)   flower beds and a bench by the well
 *   Town (3)      benches and planters beside the lanes, pillars marking the way in
 *   Borough (4)   a statue by the fountain; the ring road arrives with its first shops,
 *                 street lights and parked cars
 *   City (5)      more shops, café parasols, traffic lights at the road's ends
 *   City II+      bigger buildings, then towers behind them, a few more each level
 *
 * The old village stays the heart; the new town wraps around it, more modern further out.
 */

export type TownPieceName = keyof typeof town;
export const TOWN: Record<TownPieceName, { width: number; depth: number; height: number; parts: number }> = town;

export interface TownPiece {
  piece: TownPieceName;
  x: number;
  z: number;
  /** Rotation about y. Buildings and benches: local +z faces what they look at. Cars: local +z along the road. */
  rot: number;
  /** A colour the piece is tinted toward (buildings get the town's warm palette). */
  tint?: string;
}

export interface Road {
  radius: number;
  halfWidth: number;
  /** Arc start and length in radians, around the district centre (like a lane). */
  start: number;
  length: number;
}

export interface Town {
  road?: Road;
  pieces: TownPiece[];
}

/** The ring road, beyond the village's outer row of houses. */
const ROAD = 27;
export const ROAD_HALF_WIDTH = 2.2;
/** The second row of the new town, where towers stand. */
const TOWER_ROW = 17;

const SHOPS: TownPieceName[] = ['shop_a', 'shop_b', 'shop_c', 'shop_d', 'shop_h', 'shop_e', 'shop_f', 'shop_g'];
const BIG: TownPieceName[] = ['shop_i', 'shop_k', 'shop_l', 'shop_j', 'shop_m', 'shop_n'];
const TOWERS: TownPieceName[] = ['tower_a', 'tower_e', 'tower_c', 'tower_b', 'tower_d'];
const CARS: TownPieceName[] = ['car_sedan', 'car_suv', 'car_hatchback_sports', 'car_taxi', 'car_van', 'car_delivery', 'car_truck', 'car_police', 'car_sedan', 'car_suv'];
const FLOWERS: TownPieceName[] = ['flower_reda', 'flower_yellowa', 'flower_purplea', 'flower_redb', 'flower_yellowb', 'flower_purpleb'];

/** Warm colours for the new town's buildings, so it sits with the village instead of reading cold grey. */
const FACADES = ['#f3e3c3', '#e9c9a0', '#d99f7e', '#c9cfa9', '#b8c7cf', '#efd0b8', '#dcc1a1'];

const seedOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const face = (from: { x: number; z: number }, to: { x: number; z: number }) => Math.atan2(to.x - from.x, to.z - from.z);
const radiusOf = (p: TownPieceName) => Math.max(TOWN[p].width, TOWN[p].depth) / 2;

/** Things already standing, as circles, so nothing is placed on top of anything else. */
class Ground {
  private taken: { x: number; z: number; r: number }[] = [];
  take(x: number, z: number, r: number) {
    this.taken.push({ x, z, r });
  }
  free(x: number, z: number, r: number) {
    return this.taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + r);
  }
}

/**
 * Each section draws from its own random sequence, and anything that will exist at a later level
 * (lanterns, traffic lights) holds its ground from the start. So reaching a level only adds
 * pieces: nothing placed earlier ever shifts.
 */
export function layoutTown(d: District, level: number, village: Settlement): Town {
  const plaza = districtPlazaRadius(d.size);
  const shape = shapeOf(d);
  const seed = seedOf(d.squad.id);
  const section = (k: number) => rng(seed ^ (0x70d1 * (k + 1)));
  const at = (r: number, offset: number) => ({ x: d.x + Math.cos(d.angle + offset) * r, z: d.z + Math.sin(d.angle + offset) * r });
  const centre = { x: d.x, z: d.z };
  const pieces: TownPiece[] = [];

  // Everything that stands in the village at any level, so a bench placed now is never where a
  // house or lantern will go later.
  const ground = new Ground();
  for (const h of village.allHouses) ground.take(h.x, h.z, Math.max(HOUSES[h.house].width, HOUSES[h.house].depth) / 2);
  const { well, fountain } = village.spots;
  ground.take(well.x, well.z, 1.2);
  ground.take(fountain.x, fountain.z, 2.2);
  for (const l of village.allLamps) ground.take(l.x, l.z, 0.4);
  const lanes = village.allLanes;

  /** Place `piece` at (x, z) if there is room; returns whether it went down. */
  const put = (piece: TownPieceName, x: number, z: number, rot: number, pad = 0.2, tint?: string) => {
    const r = radiusOf(piece) * 0.7 + pad; // footprints are rectangles; 0.7 of the half-diagonal is close enough
    if (!ground.free(x, z, r)) return false;
    ground.take(x, z, r);
    pieces.push({ piece, x, z, rot, ...(tint ? { tint } : {}) });
    return true;
  };

  // ---- Village: flowers and a bench by the well ---------------------------------------------------
  if (level >= 2) {
    const rand = section(1);
    for (let i = 0; i < 7; i++) {
      const a = rand() * Math.PI * 2;
      const r = 1.6 + rand() * 0.9;
      put(FLOWERS[i % FLOWERS.length]!, well.x + Math.cos(a) * r, well.z + Math.sin(a) * r, rand() * 6, 0);
    }
    for (let tries = 0; tries < 12; tries++) {
      const a = rand() * Math.PI * 2;
      const p = { x: well.x + Math.cos(a) * 3.2, z: well.z + Math.sin(a) * 3.2 };
      if (put('bench', p.x, p.z, face(p, well))) break;
    }
  }

  // ---- Town: columns at the way in, benches and planters beside the lanes -------------------------
  if (level >= 3) {
    const rand = section(2);
    const lane = lanes[0]!;
    for (const end of [0.04, lane.length - 0.04]) {
      for (const side of [-1, 1]) {
        const p = at(lane.radius + side * (LANE_HALF_WIDTH + 0.5), lane.start - d.angle + end);
        put('statue_column', p.x, p.z, 0, 0);
      }
    }
    let placed = 0;
    for (let tries = 0; tries < 60 && placed < 7; tries++) {
      const l = lanes[Math.floor(rand() * lanes.length)]!;
      const offset = l.start - d.angle + 0.1 + rand() * (l.length - 0.2);
      const side = rand() < 0.5 ? -1 : 1;
      const p = at(l.radius + side * (LANE_HALF_WIDTH + 0.9), offset);
      if (put(placed % 2 ? 'planter' : 'bench', p.x, p.z, face(p, at(l.radius, offset)))) placed++;
    }
  }

  // ---- Borough: a statue by the fountain ----------------------------------------------------------
  if (level >= 4) {
    const rand = section(3);
    const statue = (['statue_head', 'statue_obelisk', 'statue_ring', 'statue_head'] as const)[seed % 4]!;
    for (let tries = 0; tries < 12; tries++) {
      const a = rand() * Math.PI * 2;
      const p = { x: fountain.x + Math.cos(a) * 4, z: fountain.z + Math.sin(a) * 4 };
      if (put(statue, p.x, p.z, face(p, fountain))) break;
    }
  }

  if (level < 4) return { pieces };

  // ---- The new town: a ring road, shops and towers ------------------------------------------------
  const road: Road = { radius: plaza + ROAD, halfWidth: ROAD_HALF_WIDTH, start: d.angle + shape.from - 0.05, length: shape.to - shape.from + 0.1 };
  const onIsland = (p: { x: number; z: number }, r: number) => Math.hypot(p.x, p.z) + r < PLATFORM_RADIUS - 4;
  const offsetOf = (along: number, radius: number) => road.start - d.angle + along / radius;
  const outer = road.radius + road.halfWidth;
  const inner = road.radius - road.halfWidth;

  // street lights first, on the outer kerb at uneven spacing, the arm over the road
  {
    const rand = section(4);
    const r = outer + 0.4;
    let along = 3 + rand() * 4;
    while (along < road.length * r - 3) {
      const p = at(r, offsetOf(along, r));
      put('streetlight', p.x, p.z, face(p, centre) + Math.PI, 0); // the kit's arm reaches along local -z
      along += 9 + rand() * 6;
    }
  }

  // traffic lights at the road's two ends: their ground is held from the road's first day
  const trafficLights = [0.02, road.length - 0.02].map((end) => {
    const p = at(inner - 0.5, road.start - d.angle + end);
    const ahead = at(inner - 0.5, road.start - d.angle + (end < 0.1 ? end + 0.2 : end - 0.2));
    ground.take(p.x, p.z, 0.6);
    return { piece: 'traffic_light' as const, ...p, rot: face(p, ahead) };
  });
  if (level >= 5) pieces.push(...trafficLights);

  // building plots along the outside of the road, walked end to end with uneven gaps, then built
  // from the middle outward; every third plot is a bigger building
  const shopRand = section(5);
  const plots: { along: number; piece: TownPieceName; tint: string }[] = [];
  {
    let along = 1.5 + shopRand() * 2;
    for (let i = 0; ; i++) {
      const pool = i % 3 === 2 ? BIG : SHOPS;
      const piece = pool[Math.floor(shopRand() * pool.length)]!;
      const w = TOWN[piece].width;
      if (along + w > road.length * outer - 1) break;
      plots.push({ along: along + w / 2, piece, tint: FACADES[Math.floor(shopRand() * FACADES.length)]! });
      along += w + 0.8 + shopRand() * 2.2;
    }
  }
  const middle = (shape.centre - shape.from + 0.05) * outer;
  plots.sort((a, b) => Math.abs(a.along - middle) - Math.abs(b.along - middle));
  const shops = level === 4 ? 3 : level === 5 ? 7 : 7 + 2 * (level - 5);
  let built = 0;
  for (const plot of plots) {
    if (built >= shops) break;
    const p = at(outer + 0.9 + TOWN[plot.piece].depth / 2, offsetOf(plot.along, outer));
    if (onIsland(p, radiusOf(plot.piece)) && put(plot.piece, p.x, p.z, face(p, centre), 0, plot.tint)) built++;
  }
  const firstShops = pieces.filter((p) => p.piece.startsWith('shop_')).slice(0, 3);

  // café parasols in front of the first shops, City and up
  if (level >= 5) {
    const rand = section(6);
    for (const s of firstShops) {
      const toward = { x: centre.x - s.x, z: centre.z - s.z };
      const l = Math.hypot(toward.x, toward.z);
      const reach = TOWN[s.piece].depth / 2 + 1.2;
      const side = (rand() - 0.5) * 2;
      put(rand() < 0.5 ? 'parasol_a' : 'parasol_b', s.x + (toward.x / l) * reach + (toward.z / l) * side, s.z + (toward.z / l) * reach - (toward.x / l) * side, 0, 0);
    }
  }

  // towers in a second row, one more each City level from City II
  if (level >= 6) {
    const rand = section(7);
    const towers = Math.min(TOWERS.length, level - 5);
    let placed = 0;
    for (let tries = 0; tries < 40 && placed < towers; tries++) {
      const offset = shape.centre + (rand() - 0.5) * (shape.to - shape.from) * 0.9;
      const piece = TOWERS[placed]!;
      const p = at(road.radius + TOWER_ROW + rand() * 3, offset);
      const tint = FACADES[Math.floor(rand() * FACADES.length)];
      if (onIsland(p, radiusOf(piece)) && put(piece, p.x, p.z, face(p, centre), 0.6, tint)) placed++;
    }
  }

  // cars parked along the inner kerb, facing either way along the road
  {
    const rand = section(8);
    const cars = Math.min(12, 2 + 2 * (level - 4));
    const r = inner + 0.9;
    let placed = 0;
    for (let tries = 0; tries < 80 && placed < cars; tries++) {
      const offset = shape.from + rand() * (shape.to - shape.from);
      const p = at(r, offset);
      // local +z along the road: (sin r, cos r) = (-sin θ, cos θ), or the other way
      const rot = -(d.angle + offset) + (rand() < 0.5 ? 0 : Math.PI);
      if (put(CARS[placed % CARS.length]!, p.x, p.z, rot, 0.3)) placed++;
    }
  }

  return { road, pieces };
}
