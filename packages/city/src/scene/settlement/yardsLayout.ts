import { districtPlazaRadius, PLATFORM_RADIUS, type District } from '../../layout.ts';
import { rng } from '../rng.ts';
import { HOUSES, houseCount, houseSpots, layoutSettlement, type HouseSpot, type Point } from './settlementLayout.ts';

/**
 * What grows around a settlement's houses: footpaths, front gardens behind picket fences or hedges,
 * vegetable plots, woodpiles, haystacks, bushes and small trees. Pure and deterministic, like the
 * houses: every district has a fixed list of yard pieces, each tied to the level it appears at, and
 * that list is laid out against every house spot the district will ever build, so growing only adds
 * pieces; nothing moves, and no future house lands on a garden. Lanes, the plaza and the axis around
 * the well and fountain (market ground) stay clear.
 */

export type YardKind =
  | 'path'
  | 'fence'
  | 'hedge'
  | 'flowers'
  | 'crops'
  | 'bush'
  | 'tree'
  | 'conifer'
  | 'fruitTree'
  | 'woodpile'
  | 'haystack';

export interface YardItem {
  kind: YardKind;
  x: number;
  z: number;
  /** Rotation about y. Runs (paths, fences, hedges) and beds lie along the item's local z. */
  rot: number;
  /** Half the footprint along the item's own x and z. For trees and bushes, the canopy's reach. */
  hw: number;
  hd: number;
  /** Size multiplier for trees, bushes and haystacks; 1 otherwise. */
  scale: number;
  /** 0–1, varies colour within the kind. */
  shade: number;
  /** The settlement level this piece appears at. */
  level: number;
}

/** Clearances, in world units. */
const HOUSE_GAP = 0.1;
const ITEM_GAP = 0.08;
const LANE_HALF = 1.1;
/** Kept free along each lane's edge, so carts and stalls on the shoulder have room. */
const LANE_SHOULDER = 0.25;
const WELL_CLEAR = 3.5;
const FOUNTAIN_CLEAR = 4.5;
/** Outer edge of the settlement band (inSettlement covers plaza + 19 and ARC + 0.15). */
const BAND_OUT = 19;
const BAND_ARC = 0.15;
/** Kit fences and hedges are 1.4 long; longer runs are split into pieces about that long. */
const PIECE = 1.4;

const seedOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** The level a district reaches when its `n`-th house (0-based, in build order) stands. */
export function levelOfHouse(n: number): number {
  let level = 1;
  while (houseCount(level, Infinity) <= n) level++;
  return level;
}

/** Corners of an oriented rectangle: centre, rotation, half sizes along local x and z. */
export function rectCorners(c: Point, rot: number, hw: number, hd: number): Point[] {
  const [cos, sin] = [Math.cos(rot), Math.sin(rot)];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
    const lx = a! * hw;
    const lz = b! * hd;
    return { x: c.x + lx * cos + lz * sin, z: c.z - lx * sin + lz * cos };
  });
}

export const houseCorners = (h: HouseSpot) => rectCorners(h, h.rot, HOUSES[h.house].width / 2, HOUSES[h.house].depth / 2);
export const itemCorners = (it: YardItem) => rectCorners(it, it.rot, it.hw, it.hd);

/** Separating-axis test for two convex quads, with `gap` of clearance required between them. */
function overlaps(p: Point[], q: Point[], gap: number): boolean {
  return [p, q].every((poly) =>
    poly.every((a, i) => {
      const b = poly[(i + 1) % poly.length]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const axis = { x: -(b.z - a.z) / len, z: (b.x - a.x) / len };
      const proj = (pts: Point[]) => pts.map((v) => v.x * axis.x + v.z * axis.z);
      return Math.max(...proj(p)) + gap > Math.min(...proj(q)) && Math.max(...proj(q)) + gap > Math.min(...proj(p));
    }),
  );
}

/** Distance from a point to a convex quad (0 inside it). */
function distanceTo(poly: Point[], p: Point): number {
  let best = Infinity;
  // a point inside is on the same side of every edge (whichever way the corners wind)
  const sides = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    const [ex, ez] = [b.x - a.x, b.z - a.z];
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.z - a.z) * ez) / (ex * ex + ez * ez)));
    best = Math.min(best, Math.hypot(a.x + ex * t - p.x, a.z + ez * t - p.z));
    return Math.sign(ex * (p.z - a.z) - ez * (p.x - a.x));
  });
  return sides.every((s) => s >= 0) || sides.every((s) => s <= 0) ? 0 : best;
}

/** Nearest and farthest distance of a quad from a point: how far around the district centre it reaches. */
export function radialRange(poly: Point[], c: Point): [number, number] {
  return [distanceTo(poly, c), Math.max(...poly.map((v) => Math.hypot(v.x - c.x, v.z - c.z)))];
}

/** What a yard piece must keep clear of, for one district. */
interface Site {
  centre: Point;
  plaza: number;
  arc: number;
  lanes: number[];
  well: Point;
  fountain: Point;
  houses: Point[][];
  angle: number;
}

function siteOf(d: District, spots: HouseSpot[]): Site {
  const { features } = layoutSettlement(d, 4);
  const lanes = features.lanes;
  return {
    centre: { x: d.x, z: d.z },
    plaza: districtPlazaRadius(d.size),
    // lanes overrun the house arc by 0.06 rad either side
    arc: lanes[0]!.length / 2 - 0.06,
    lanes: lanes.map((l) => l.radius),
    well: features.well!,
    fountain: features.fountain!,
    houses: spots.map(houseCorners),
    angle: d.angle,
  };
}

interface Placed {
  item: YardItem;
  poly: Point[];
  /** Pieces of one fence or hedge touch each other; nothing else may. */
  group: number;
}

/** True where a piece may go: inside the band, off the plaza, lanes, market axis, houses and other pieces. */
function clear(site: Site, item: YardItem, poly: Point[], group: number, placed: Placed[]): boolean {
  const { centre, plaza } = site;
  const off = Math.atan2(item.z - centre.z, item.x - centre.x) - site.angle;
  if (Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) > site.arc + BAND_ARC) return false;
  if (Math.hypot(item.x, item.z) > PLATFORM_RADIUS - 3) return false;
  const [near, far] = radialRange(poly, centre);
  if (far > plaza + BAND_OUT + 0.6 || Math.hypot(item.x - centre.x, item.z - centre.z) > plaza + BAND_OUT) return false;
  // a footpath runs right up to the plaza's edge; everything else stays on the grass
  if (near < plaza + (item.kind === 'path' ? 0.05 : 0.6)) return false;
  for (const r of site.lanes) if (near < r + LANE_HALF + LANE_SHOULDER && far > r - LANE_HALF - LANE_SHOULDER) return false;
  if (distanceTo(poly, site.well) < WELL_CLEAR || distanceTo(poly, site.fountain) < FOUNTAIN_CLEAR) return false;
  if (site.houses.some((h) => overlaps(poly, h, HOUSE_GAP))) return false;
  return !placed.some((p) => p.group !== group && overlaps(poly, p.poly, ITEM_GAP));
}

/** Every yard piece a district will ever have, in a fixed order. */
export function yardItems(d: District): YardItem[] {
  const spots = houseSpots(d);
  const site = siteOf(d, spots);
  const placed: Placed[] = [];
  const seed = seedOf(d.squad.id);
  let groups = 0;

  /** Place all of `items` or none of them; they share a group, so a fence's pieces may meet. */
  const tryAll = (items: YardItem[]) => {
    const group = groups++;
    const polys = items.map(itemCorners);
    if (!items.every((it, i) => clear(site, it, polys[i]!, group, placed))) return false;
    items.forEach((item, i) => placed.push({ item, poly: polys[i]!, group }));
    return true;
  };

  /** Spots in a house's own frame: lx across its front, lz toward the plaza (its front door). */
  const local = (h: HouseSpot, lx: number, lz: number): Point => {
    const [c, s] = [Math.cos(h.rot), Math.sin(h.rot)];
    return { x: h.x + lx * c + lz * s, z: h.z - lx * s + lz * c };
  };
  const piece = (h: HouseSpot, kind: YardKind, lx: number, lz: number, hw: number, hd: number, level: number, extra: Partial<YardItem> = {}): YardItem => ({
    kind,
    ...local(h, lx, lz),
    rot: h.rot,
    hw,
    hd,
    scale: 1,
    shade: 0,
    level,
    ...extra,
  });
  /** A fence or hedge from a to b (house frame), split into kit-length pieces. */
  const run = (h: HouseSpot, kind: 'fence' | 'hedge', a: [number, number], b: [number, number], level: number, shade: number): YardItem[] => {
    const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(len / PIECE));
    const rot = h.rot + Math.atan2(dx, dz);
    return Array.from({ length: n }, (_, i) => ({
      kind,
      ...local(h, a[0] + (dx * (i + 0.5)) / n, a[1] + (dz * (i + 0.5)) / n),
      rot,
      hw: kind === 'fence' ? 0.07 : 0.18,
      hd: len / n / 2,
      scale: 1,
      shade,
      level,
    }));
  };
  /** A tree or bush; its footprint is roughly the canopy's reach. */
  const plant = (h: HouseSpot, kind: YardKind, lx: number, lz: number, scale: number, level: number, shade: number, rot: number): YardItem => {
    const reach = kind === 'bush' ? 0.85 : kind === 'conifer' ? 0.95 : 1.2;
    return { kind, ...local(h, lx, lz), rot, hw: reach * scale, hd: reach * scale, scale, shade, level };
  };

  const rowOf = (h: HouseSpot) => {
    const r = Math.hypot(h.x - d.x, h.z - d.z);
    return site.lanes.filter((lane) => r > lane).length;
  };
  const houses = spots.map((h, i) => ({ h, i, row: rowOf(h), built: levelOfHouse(i), W: HOUSES[h.house].width / 2, D: HOUSES[h.house].depth / 2, rand: rng(seed + 101 + i * 7919) }));

  /** A spot around the district centre, turned to face the plaza like a house. */
  const at = (r: number, off: number): HouseSpot => {
    const a = d.angle + off;
    return { x: d.x + Math.cos(a) * r, z: d.z + Math.sin(a) * r, rot: Math.atan2(-Math.cos(a), -Math.sin(a)), house: 'cottage', shade: 0 };
  };

  // 1. Front gardens on the plaza row: a footpath from the door to the plaza, flower beds under the
  //    windows, and (from Village) a picket fence or a clipped hedge with a gate for the path.
  for (const { h, row, built, W, D, rand } of houses) {
    if (row !== 0) continue;
    const door = local(h, 0, D);
    const room = Math.hypot(door.x - d.x, door.z - d.z) - site.plaza - 0.1;
    if (room < 1.4) continue;
    tryAll([piece(h, 'path', 0, D + 0.12 + (room - 0.12) / 2, 0.42, (room - 0.12) / 2, built, { shade: rand() })]);

    const deep = Math.min(2.4, room - 0.55);
    const style = rand();
    // a hedge is thicker than a fence, so it stands a little further from the walls
    const yard = W + (style >= 0.45 && style < 0.75 ? 0.34 : 0.2);
    const sides = rand() < 0.5 ? [1, -1] : [-1, 1];
    sides.forEach((s, k) => {
      const bedW = yard - 0.35 - 0.72;
      const bedD = Math.min(0.55, (deep - 0.6) / 2);
      if (bedW < 0.45 || bedD < 0.3) return;
      // the second bed waits for a Village; now and then it is a bush instead
      const level = Math.max(built, 1 + k);
      if (k === 1 && rand() < 0.3) {
        tryAll([plant(h, 'bush', s * (0.72 + bedW / 2), D + 0.3 + bedD, Math.min(0.62, bedW / 1.6), level, rand(), rand() * 6)]);
      } else {
        tryAll([piece(h, 'flowers', s * (0.72 + bedW / 2), D + 0.3 + bedD, bedW / 2, bedD, level, { shade: rand() })]);
      }
    });

    if (style < 0.75) {
      const kind = style < 0.45 ? 'fence' : 'hedge';
      const level = Math.max(built, 2);
      const shade = rand();
      const front = D + deep;
      tryAll([
        ...run(h, kind, [-yard, D - 0.45], [-yard, front], level, shade),
        ...run(h, kind, [-yard, front], [-0.6, front], level, shade),
        ...run(h, kind, [0.6, front], [yard, front], level, shade),
        ...run(h, kind, [yard, front], [yard, D - 0.45], level, shade),
      ]);
    }
  }

  /**
   * Up to `count` bushes and young trees at random spots in the band, where they fit; `bushes` of
   * them are bushes. They appear from `level` on, a few one level earlier.
   */
  const scatter = (rand: () => number, count: number, level: number, bushes: number, from = site.plaza + 1) => {
    let added = 0;
    for (let k = 0; k < count * 15 && added < count; k++) {
      const spot = at(from + rand() * (site.plaza + BAND_OUT - from), (rand() * 2 - 1) * (site.arc + 0.1));
      const when = rand() < 0.3 ? Math.max(1, level - 1) : level;
      const item =
        rand() < bushes
          ? plant(spot, 'bush', 0, 0, 0.4 + rand() * 0.3, when, rand(), rand() * 6)
          : plant(spot, rand() < 0.3 ? 'conifer' : 'tree', 0, 0, 0.5 + rand() * 0.25, when, rand(), rand() * 6);
      if (tryAll([item])) added++;
    }
  };
  // Wild trees on ground no house or lane will ever need, out behind the front row, so even a
  // hamlet sits among a few trees rather than on bare grass; the town later grows in around them.
  scatter(rng(seed + 4242), 12, 2, 0.15, site.lanes[0]!);

  // 2. In the gap between two neighbours on a row, once both stand: a young tree, or a bush when
  //    the gap is tight. Larger trees are tried first, so the widest gaps get the biggest trees.
  const offsetOf = (p: Point) => {
    const a = Math.atan2(p.z - d.z, p.x - d.x) - d.angle;
    return Math.atan2(Math.sin(a), Math.cos(a));
  };
  for (const row of [0, 1, 2]) {
    const line = houses.filter((h) => h.row === row).sort((a, b) => offsetOf(a.h) - offsetOf(b.h));
    line.slice(1).forEach((b, k) => {
      const a = line[k]!;
      const rand = rng(seed + 202 + a.i * 131 + b.i);
      const r = (Math.hypot(a.h.x - d.x, a.h.z - d.z) + Math.hypot(b.h.x - d.x, b.h.z - d.z)) / 2 - (row === 0 ? 0.3 : 0);
      const spot = at(r, (offsetOf(a.h) + offsetOf(b.h)) / 2 + (rand() - 0.5) * 0.01);
      const level = Math.max(a.built, b.built, rand() < 0.6 ? 3 : 4);
      const kind: YardKind = row === 2 && rand() < 0.35 ? 'conifer' : rand() < 0.3 ? 'fruitTree' : 'tree';
      const [shade, rot] = [rand(), rand() * 6];
      const options = [plant(spot, kind, 0, 0, 0.78, level, shade, rot), plant(spot, kind, 0, 0, 0.62, level, shade, rot), plant(spot, 'bush', 0, 0, 0.6, level, shade, rot)];
      options.some((o) => tryAll([o]));
    });
  }

  // 3. Beside each house: a woodpile against the wall, a bush, a small tree, now and then a haystack.
  for (const { h, row, built, W, D, rand } of houses) {
    const sides = rand() < 0.5 ? [1, -1] : [-1, 1];
    // the first bush comes with the house, on whichever side has room; a second one later
    let first = true;
    for (const s of sides) {
      if (tryAll([plant(h, 'bush', s * (W + 0.6), -D * 0.1, 0.42 + rand() * 0.2, Math.max(built, first ? 1 : 4), rand(), rand() * 6)])) first = false;
    }
    if (rand() < 0.4) {
      const s = sides[1]!;
      tryAll([piece(h, 'woodpile', s * (W + 0.45), -D * 0.25, 0.3, 0.62, Math.max(built, 3), { shade: rand() })]);
    }
    sides.forEach((s, k) => {
      if (rand() < 0.35) return;
      const kind = rand() < 0.25 ? 'fruitTree' : 'tree';
      const scale = 0.5 + rand() * 0.18;
      tryAll([plant(h, kind, s * (W + 1.05), -D * 0.5, scale, Math.max(built, k === 0 ? 3 : 5), rand(), rand() * 6)]);
    });
    if (row > 0 && rand() < 0.25) {
      const s = sides[0]!;
      const scale = 0.8 + rand() * 0.25;
      tryAll([piece(h, 'haystack', s * (W + 0.95), -D * 0.2, 0.62 * scale, 0.62 * scale, Math.max(built, 4), { scale, shade: rand(), rot: rand() * 6 })]);
    }
  }

  // 4. Back gardens on the outer row, where the town meets the fields: a vegetable plot, fenced in
  //    on some plots, with a fruit tree or a haystack at the bottom of the garden.
  for (const { h, row, built, W, D, rand } of houses) {
    if (row !== 2) continue;
    const plotW = Math.min(W - 0.15, 1.5);
    tryAll([piece(h, 'crops', (rand() - 0.5) * 0.4, -D - 0.85, plotW, 0.5, Math.max(built, 3), { rot: h.rot + Math.PI / 2, hw: 0.5, hd: plotW, shade: rand() })]);
    if (rand() < 0.45) {
      const yard = W + 0.2;
      const shade = rand();
      tryAll([
        ...run(h, 'fence', [-yard, -D + 0.3], [-yard, -D - 1.6], Math.max(built, 4), shade),
        ...run(h, 'fence', [-yard, -D - 1.6], [yard, -D - 1.6], Math.max(built, 4), shade),
        ...run(h, 'fence', [yard, -D - 1.6], [yard, -D + 0.3], Math.max(built, 4), shade),
      ]);
    }
    const s = rand() < 0.5 ? 1 : -1;
    if (rand() < 0.6) tryAll([plant(h, 'fruitTree', s * (W + 0.6), -D - 1.2, 0.55 + rand() * 0.15, Math.max(built, 5), rand(), rand() * 6)]);
    else tryAll([piece(h, 'haystack', s * (W + 0.5), -D - 1.0, 0.55, 0.55, Math.max(built, 4), { scale: 0.85, shade: rand(), rot: rand() * 6 })]);
  }

  // 5. The town's edges and leftover nooks fill with greenery as it grows: groves at the ends of
  //    the arc, then bushes and young trees wherever there is still room.
  const fill = rng(seed + 31337);
  for (const side of [-1, 1]) {
    for (let r = site.plaza + 2; r < site.plaza + BAND_OUT; r += 2.3) {
      const spot = at(r, side * (site.arc + 0.03 + fill() * 0.1));
      const pick = fill();
      const kind: YardKind = pick < 0.35 ? 'conifer' : pick < 0.75 ? 'tree' : 'bush';
      const scale = kind === 'bush' ? 0.55 + fill() * 0.25 : 0.55 + fill() * 0.3;
      tryAll([plant(spot, kind, 0, 0, scale, 1 + Math.floor(fill() * 4), fill(), fill() * 6)]);
    }
  }
  scatter(fill, 36, 4, 0.55);

  return placed.map((p) => p.item);
}

/** The yard pieces standing at a level. */
export function layoutYards(d: District, level: number): YardItem[] {
  return yardItems(d).filter((it) => it.level <= level);
}
