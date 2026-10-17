import { districtPlazaRadius, PLATFORM_RADIUS, type District } from '../../layout.ts';
import { rng } from '../rng.ts';
import { HOUSES, layoutSettlement, type Point, type Settlement } from './settlementLayout.ts';

/**
 * The settlement's public spaces: a market round the well and the fountain (stalls, a cart, goods,
 * a bench, a notice board), signposts where the lanes end, and bunting in the squad colour strung
 * between the lamps and between masts at the square's corners. Everything stands on the ground the
 * yards leave free (yardsLayout.ts): rings round the well and fountain, and the lanes' shoulders.
 * Pure and deterministic, like the houses: every district has one fixed
 * list of props, worked out against the full-grown town, and its level only decides which of them
 * are out. Growing adds props; it never moves one, and none ever stands where a house will rise.
 */

export type PropKind =
  | 'cart' | 'stall_green' | 'stall_red' | 'canopy' | 'crate' | 'barrel' | 'sack' | 'bench' | 'planter' | 'noticeboard' | 'signpost' | 'mast';

export interface MarketProp {
  kind: PropKind;
  x: number;
  z: number;
  /** Height of its base: a crate can sit on another. */
  y: number;
  /** Rotation about y; the prop's local +z is its front (a stall's counter, a bench's seat). */
  rot: number;
  /** The settlement level that puts it out: Village 2 … City 5. */
  level: number;
}

/** A string of pennants: along a lane from lamp to lamp, or across the market square between masts. */
export interface Bunting {
  /** The sagging string, as a polyline. */
  points: (Point & { y: number })[];
  /** Each pennant hangs from the string; `rot` turns its local x along the string. `accent` ones take the squad colour. */
  pennants: (Point & { y: number; rot: number; accent: boolean })[];
}

export interface Market {
  props: MarketProp[];
  /** Borough and up: the cobbled square around the fountain, as an arc band between the lanes. */
  square?: { radius: number; inner: number; outer: number; start: number; length: number };
  /** City and up. */
  bunting: Bunting[];
}

/** Kit stalls and carts stand at this scale, so they fit the ring of ground round the well and fountain. */
export const KIT_SCALE = 0.8;

/**
 * Footprint half-extents (local x = width, local z = depth): kit sizes from kit.json at KIT_SCALE, the
 * rest as Market.tsx builds them. A signpost counts only its post; its arms are overhead.
 */
export const PROPS: Record<PropKind, { hw: number; hd: number }> = {
  cart: { hw: 0.67 * KIT_SCALE, hd: 1.01 * KIT_SCALE },
  stall_green: { hw: 0.8 * KIT_SCALE, hd: 0.8 * KIT_SCALE },
  stall_red: { hw: 0.8 * KIT_SCALE, hd: 0.8 * KIT_SCALE },
  canopy: { hw: 0.78, hd: 0.58 },
  crate: { hw: 0.28, hd: 0.28 },
  barrel: { hw: 0.28, hd: 0.28 },
  sack: { hw: 0.26, hd: 0.22 },
  bench: { hw: 0.56, hd: 0.24 },
  planter: { hw: 0.32, hd: 0.32 },
  noticeboard: { hw: 0.52, hd: 0.2 },
  signpost: { hw: 0.1, hd: 0.1 },
  mast: { hw: 0.08, hd: 0.08 },
};

/** Lane half-width, as Settlements.tsx paves it. */
export const LANE_HALF_WIDTH = 1.1;
/** Strip along each lane's edge that the yards leave free (yardsLayout.ts): room for masts and posts. */
export const SHOULDER = 0.25;
const FOUNTAIN_RADIUS = 2.1;
/**
 * The market's ground: rings round the well and the fountain. Inside them stands nobody but the
 * villagers who gather there (about 1.6 from the well's centre, 2.6 from the fountain's); beyond
 * them, the yards' gardens and trees (which keep 3.5 from the well and 4.5 from the fountain).
 */
export const WELL_RING = { inner: 2.0, outer: 3.47 };
export const FOUNTAIN_RING = { inner: 3.0, outer: 4.45 };
/** Clear ground kept around every house, so props stay out of its plot; and the front path to its door. */
const PLOT_MARGIN = 0.3;
const DOORSTEP = 1.4;
/** Height the bunting hangs from on a lamp post. */
const BUNTING_HEIGHT = 2.15;
/** Height of a bunting mast, and where its strings tie on. */
export const MAST_HEIGHT = 3.2;
const MAST_TIE = 2.95;

export interface Rect {
  x: number;
  z: number;
  rot: number;
  hw: number;
  hd: number;
}

/** A rectangle's corners: local (lx, lz) turned by rot about y, as the houses are. */
export function corners(r: Rect): Point[] {
  const [c, s] = [Math.cos(r.rot), Math.sin(r.rot)];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
    const lx = a! * r.hw;
    const lz = b! * r.hd;
    return { x: r.x + lx * c + lz * s, z: r.z - lx * s + lz * c };
  });
}

/** Separating-axis test for two rectangles, with `gap` of clearance. */
export function rectsOverlap(p: Rect, q: Rect, gap = 0): boolean {
  const grow = (r: Rect) => ({ ...r, hw: r.hw + gap / 2, hd: r.hd + gap / 2 });
  const [a, b] = [corners(grow(p)), corners(grow(q))];
  return [a, b].every((poly) =>
    poly.every((u, i) => {
      const v = poly[(i + 1) % 4]!;
      const axis = { x: -(v.z - u.z), z: v.x - u.x };
      const proj = (pts: Point[]) => pts.map((w) => w.x * axis.x + w.z * axis.z);
      return Math.max(...proj(a)) > Math.min(...proj(b)) && Math.max(...proj(b)) > Math.min(...proj(a));
    }),
  );
}

/** Distance from a point to a rectangle (0 inside it). */
export function distanceToRect(p: Point, r: Rect): number {
  const [c, s] = [Math.cos(r.rot), Math.sin(r.rot)];
  const [dx, dz] = [p.x - r.x, p.z - r.z];
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.hypot(Math.max(0, Math.abs(lx) - r.hw), Math.max(0, Math.abs(lz) - r.hd));
}

export const propRect = (p: MarketProp): Rect => ({ x: p.x, z: p.z, rot: p.rot, ...PROPS[p.kind] });

/** The level a settlement has reached, read off what layoutSettlement unlocked. */
export function settlementTier(s: Settlement): number {
  const f = s.features;
  return f.lamps.length ? 5 : f.fountain ? 4 : f.lanes.length ? 3 : f.well ? 2 : 1;
}

const seedOf = (id: string) => [...id].reduce((h, c) => (h * 29 + c.charCodeAt(0)) >>> 0, 11);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** A planned prop, in district terms: `rho` beyond the plaza edge, `s` world units along the arc from the axis. */
interface Plan {
  kind: PropKind;
  rho: number;
  s: number;
  level: number;
  /** What its front faces: a point in the same (rho, s) terms, or 'out' / 'in' along the radius, or 'along' the arc. */
  face: { rho: number; s: number } | 'out' | 'in' | 'along';
  /** Turn a little off true, so a pile of crates looks stacked by hand. */
  jitter?: number;
  y?: number;
}

/** Everything a fully grown district will ever have, in the order it is placed. */
export function marketProps(d: District): Market {
  const plaza = districtPlazaRadius(d.size);
  const full = layoutSettlement(d, 99);
  const { lanes, lamps } = full.features;
  const well = full.features.well!;
  const fountain = full.features.fountain!;
  const rand = rng(seedOf(d.squad.id));
  /** The arc of the lanes either side of the axis, in radians (lanes run a little past the houses). */
  const laneArc = lanes[0]!.length / 2;

  const toWorld = (rho: number, s: number): Point => {
    const r = plaza + rho;
    const a = d.angle + s / r;
    return { x: d.x + Math.cos(a) * r, z: d.z + Math.sin(a) * r };
  };
  const polarOf = (p: Point) => ({ r: Math.hypot(p.x - d.x, p.z - d.z), a: wrap(Math.atan2(p.z - d.z, p.x - d.x) - d.angle) });
  const rotToward = (from: Point, to: Point) => Math.atan2(to.x - from.x, to.z - from.z);

  const houses: Rect[] = full.houses.map((h) => {
    const { width, depth } = HOUSES[h.house];
    return { x: h.x, z: h.z, rot: h.rot, hw: width / 2 + PLOT_MARGIN, hd: depth / 2 + PLOT_MARGIN };
  });
  // the path to each front door (houses face the plaza, so it runs toward the district centre)
  const doorsteps: Rect[] = full.houses.map((h) => {
    const { depth } = HOUSES[h.house];
    const reach = depth / 2 + DOORSTEP / 2;
    return { x: h.x + Math.sin(h.rot) * reach, z: h.z + Math.cos(h.rot) * reach, rot: h.rot, hw: 0.7, hd: DOORSTEP / 2 };
  });
  const placed: MarketProp[] = [];

  /** True if a footprint stands clear of houses, lanes, well, fountain, lamps, the plaza and props already placed. */
  const fits = (rect: Rect, y = 0): boolean => {
    const pts = corners(rect);
    for (const p of pts) {
      const { r, a } = polarOf(p);
      if (r < plaza + 0.6 || Math.abs(a) > laneArc + 0.09 || Math.hypot(p.x, p.z) > PLATFORM_RADIUS - 3) return false;
    }
    for (const lane of lanes) {
      const radii = pts.map((p) => polarOf(p));
      const onArc = radii.some((p) => Math.abs(p.a) <= laneArc);
      const inside = radii.every((p) => p.r < lane.radius - LANE_HALF_WIDTH - 0.05);
      const outside = radii.every((p) => p.r > lane.radius + LANE_HALF_WIDTH + 0.05);
      if (onArc && !inside && !outside) return false;
    }
    // only on the market's ground: a ring round the well or the fountain, or a lane's shoulder
    if (distanceToRect(well, rect) < WELL_RING.inner || distanceToRect(fountain, rect) < FOUNTAIN_RING.inner) return false;
    const within = (c: Point, outer: number) => pts.every((p) => dist(p, c) <= outer);
    const onShoulder = pts.every((p) => lanes.some((l) => Math.abs(polarOf(p).r - l.radius) <= LANE_HALF_WIDTH + SHOULDER));
    if (!within(well, WELL_RING.outer) && !within(fountain, FOUNTAIN_RING.outer) && !onShoulder) return false;
    for (const lamp of lamps) if (distanceToRect(lamp, rect) < 0.35) return false;
    for (const h of [...houses, ...doorsteps]) if (rectsOverlap(h, rect)) return false;
    // a stacked prop sits on another; otherwise nothing shares ground
    if (y === 0) for (const p of placed) if (rectsOverlap(propRect(p), rect, 0.08)) return false;
    return true;
  };

  /** Place the first of a few alternatives that fits; returns the one that did. */
  const place = (...alts: Plan[]): Plan | undefined => {
    for (const plan of alts) {
      const at = toWorld(plan.rho, plan.s);
      const tangent = toWorld(plan.rho, plan.s + 1);
      let rot =
        plan.face === 'out' ? rotToward(d, at)
        : plan.face === 'in' ? rotToward(at, d)
        : plan.face === 'along' ? rotToward(at, tangent)
        : rotToward(at, toWorld(plan.face.rho, plan.face.s));
      rot += (rand() - 0.5) * (plan.jitter ?? 0);
      const prop: MarketProp = { kind: plan.kind, x: at.x, z: at.z, y: plan.y ?? 0, rot, level: plan.level };
      if (!fits(propRect(prop), prop.y)) continue;
      placed.push(prop);
      return plan;
    }
    return undefined;
  };
  const R0 = polarOf(well).r - plaza; // the well's row
  const R1 = polarOf(fountain).r - plaza; // the fountain's row
  const [L0, L1] = lanes.map((l) => l.radius - plaza) as [number, number];
  const S = rand() < 0.5 ? 1 : -1; // which side of the well the cart parks on

  /**
   * A spot on the ring round the well (row R0) or the fountain (row R1): `deg` round from the side
   * facing the plaza (positive toward +s), `r` out from the centre. It faces the centre, runs along
   * the ring, or faces away.
   */
  const ring = (row: number, deg: number, r: number, kind: PropKind, level: number, face: 'centre' | 'along' | 'away' = 'centre', extra: Partial<Plan> = {}): Plan => {
    const t = (deg * Math.PI) / 180;
    const [u, v] = [-Math.cos(t) * r, Math.sin(t) * r];
    const target =
      face === 'centre' ? { rho: row, s: 0 }
      : face === 'along' ? { rho: row + u + Math.sin(t), s: v + Math.cos(t) }
      : { rho: row + 2 * u, s: 2 * v };
    return { kind, rho: row + u, s: v, level, face: target, ...extra };
  };

  // Village: a cart unloading by the well, crates (one stacked on another) and a barrel beside it.
  place(
    ring(R0, S * 100, 2.62, 'cart', 2, 'along', { jitter: 0.1 }),
    ring(R0, -S * 100, 2.62, 'cart', 2, 'along', { jitter: 0.1 }),
  );
  const pile = ring(R0, -S * 100, 2.4, 'crate', 2, 'centre', { jitter: 0.5 });
  if (place(pile)) place({ ...pile, y: 0.5, jitter: 0.9 });
  place(ring(R0, -S * 118, 2.45, 'barrel', 2));

  // goods either side of a stall by the fountain, between it and the lanes
  const flank = (side: number, level: number, kinds: [PropKind, PropKind]) =>
    ([-1.22, 1.22] as const).forEach((u, i) => place({ kind: kinds[i]!, rho: R1 + u, s: side * 3.4, level, face: 'in', jitter: 0.2 }));
  const byWell = (kind: PropKind, level: number) =>
    [66, 63, 69, 60, 72].flatMap((deg) => [ring(R0, -S * deg, 2.68, kind, level), ring(R0, S * deg, 2.68, kind, level)]);

  // Town: a notice board and a bench by the well; the first stall, with goods, where the market
  // square will be (by the well, if the houses crowd it); signposts where the inner lane ends.
  place(ring(R0, 0, 3.0, 'noticeboard', 3, 'away'));
  place(ring(R0, -S * 27, 2.35, 'bench', 3), ring(R0, S * 27, 2.35, 'bench', 3));
  const first = place(ring(R1, S * 90, 3.66, 'stall_red', 3), ring(R1, -S * 90, 3.66, 'stall_red', 3), ...byWell('stall_red', 3));
  if (first?.rho === R1) flank(Math.sign(first.s), 3, ['crate', 'barrel']);
  for (const end of [-1, 1]) place({ kind: 'signpost', rho: L0, s: end * (laneArc * (plaza + L0) + 0.55), level: 3, face: 'in' });

  // Borough: the market square — a canopy in the squad colour across the fountain from the stall,
  // with goods; signposts at the ends of the outer lane.
  const canopy = place(ring(R1, -S * 90, 3.62, 'canopy', 4), ring(R1, S * 90, 3.62, 'canopy', 4));
  if (canopy) flank(Math.sign(canopy.s), 4, ['sack', 'crate']);
  for (const end of [-1, 1]) place({ kind: 'signpost', rho: L1, s: end * (laneArc * (plaza + L1) + 0.55), level: 4, face: 'in' });

  // City: a second stall by the well, masts on the lane shoulders at the square's corners for
  // bunting over it, and a planter of flowers before the well.
  place(...byWell('stall_green', 5));
  const mastAt = (rho: number, s: number): Plan => ({ kind: 'mast', rho, s, level: 5, face: 'in' });
  const masts = [-1, 1].map((side) => [
    place(mastAt(L0 + LANE_HALF_WIDTH + 0.15, side * 2.85)),
    place(mastAt(L1 - LANE_HALF_WIDTH - 0.15, side * 2.85)),
  ]);
  place(ring(R0, S * 23, 3.1, 'planter', 5), ring(R0, -S * 23, 3.1, 'planter', 5));

  // The cobbled square spans the fountain's row between the lanes, as far as the market's ground (and
  // short of the nearest house plot).
  const rowHouses = houses.filter((h) => Math.abs(polarOf(h).r - (plaza + R1)) < 1);
  const clear = Math.min(FOUNTAIN_RING.outer, ...rowHouses.map((h) => Math.abs(polarOf(h).a) * (plaza + R1) - h.hw));
  const squareHalf = Math.max(FOUNTAIN_RADIUS + 0.5, clear);
  const square = {
    radius: plaza + R1,
    inner: plaza + L0 + LANE_HALF_WIDTH - 0.2,
    outer: plaza + L1 - LANE_HALF_WIDTH + 0.2,
    start: d.angle - squareHalf / (plaza + R1),
    length: (2 * squareHalf) / (plaza + R1),
  };

  // Bunting along each lane, from lamp to lamp, following the lane's curve.
  const bunting: Bunting[] = [];
  for (const lane of lanes) {
    const posts = lamps
      .filter((l) => Math.abs(polarOf(l).r - lane.radius) < 0.5)
      .map((l) => polarOf(l).a)
      .sort((a, b) => a - b);
    for (let i = 0; i + 1 < posts.length; i++) {
      const [from, to] = [posts[i]!, posts[i + 1]!];
      const path = (t: number) => {
        const a = d.angle + from + (to - from) * t;
        return { x: d.x + Math.cos(a) * lane.radius, z: d.z + Math.sin(a) * lane.radius };
      };
      bunting.push(hang(path, (to - from) * lane.radius, BUNTING_HEIGHT));
    }
  }
  // and a ring of it over the square, mast to mast: well side, both sides, fountain side
  const [[nearA, farA], [nearB, farB]] = masts as [[Plan?, Plan?], [Plan?, Plan?]];
  for (const [a, b] of [[nearA, nearB], [nearA, farA], [nearB, farB], [farA, farB]]) {
    if (!a || !b) continue;
    const [p, q] = [toWorld(a.rho, a.s), toWorld(b.rho, b.s)];
    bunting.push(hang((t) => ({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t }), dist(p, q), MAST_TIE));
  }

  return { props: placed, square, bunting };
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

/** A string of pennants sagging along `path` (t from 0 to 1), tied at `height` at both ends, a pennant every ~0.6 units. */
function hang(path: (t: number) => Point, length: number, height: number): Bunting {
  const n = Math.max(6, Math.round(length / 0.6));
  const sag = Math.min(0.45, 0.04 * length);
  const at = (t: number) => ({ ...path(t), y: height - sag * 4 * t * (1 - t) });
  const points = Array.from({ length: 25 }, (_, i) => at(i / 24));
  const pennants = Array.from({ length: n - 1 }, (_, i) => {
    const t = (i + 1) / n;
    const [p, q] = [at(t - 0.01), at(t + 0.01)];
    return { ...at(t), rot: Math.atan2(-(q.z - p.z), q.x - p.x), accent: i % 2 === 0 };
  });
  return { points, pennants };
}

/** What a district shows at its current level. */
export function layoutMarket(d: District, settlement: Settlement): Market {
  const tier = settlementTier(settlement);
  const all = marketProps(d);
  return {
    props: all.props.filter((p) => p.level <= tier),
    square: tier >= 4 ? all.square : undefined,
    bunting: tier >= 5 ? all.bunting : [],
  };
}
