import type * as THREE from 'three';
import { districtPlazaRadius, PLATFORM_RADIUS, type CityLayout } from '../../layout.ts';
import { rng } from '../rng.ts';
import { inSettlement } from '../settlement/settlementLayout.ts';
import { landmarkSites } from './landmarksLayout.ts';
import { PATH_WIDTH, type DecorTree, type ParkLayout } from './parkLayout.ts';

/**
 * The open parkland's nature: ponds, rock outcrops, fallen logs and stumps, wildflower meadows, ferns
 * and mushrooms under the trees, a wilder woodland edge along the rim, and a little wildlife. Pure and
 * deterministic: the same city always grows the same park. Tidy near HQ, wilder toward the rim.
 */

export interface Pond {
  x: number;
  z: number;
  /** Nominal radius; the shoreline wobbles around it (see `pondRadiusAt`). */
  radius: number;
  /** Radial multipliers, evenly spaced around the pond from angle 0. */
  shape: number[];
  /** A small wooden jetty: its direction from the centre and the radii it runs between (land end first). */
  jetty?: { angle: number; from: number; to: number };
}

export interface Rock {
  x: number;
  z: number;
  scale: number;
  /** Vertical squash: flat shore stones and slabs < 1 < upright boulders. */
  squash: number;
  rot: number;
  mossy: boolean;
}

export interface Log {
  x: number;
  z: number;
  rot: number;
  length: number;
  radius: number;
}

/** Anything placed by position, size and heading: stumps, tufts, ferns, reeds, bushes, lily pads. */
export interface Sprig {
  x: number;
  z: number;
  scale: number;
  rot: number;
}

export interface Flower {
  x: number;
  z: number;
  scale: number;
  color: string;
}

export interface Meadow {
  x: number;
  z: number;
  radius: number;
  colors: string[];
}

export interface Lily extends Sprig {
  bloom: boolean;
}

export interface Bush extends Sprig {
  color: string;
}

export interface Duck {
  pond: number;
  /** Circles the pond centre at this distance. */
  orbit: number;
  phase: number;
  /** Radians per second; negative swims clockwise. */
  speed: number;
}

export interface Deer {
  x: number;
  z: number;
  rot: number;
  scale: number;
  phase: number;
}

export interface Flock {
  x: number;
  z: number;
  radius: number;
  height: number;
  phase: number;
  speed: number;
  size: number;
}

export interface Butterfly {
  x: number;
  z: number;
  /** Wanders within this distance of its meadow's centre. */
  radius: number;
  phase: number;
  color: string;
}

export interface NatureLayout {
  ponds: Pond[];
  lilies: Lily[];
  reeds: Sprig[];
  cattails: Sprig[];
  rocks: Rock[];
  logs: Log[];
  stumps: Sprig[];
  meadows: Meadow[];
  flowers: Flower[];
  tufts: Sprig[];
  ferns: Sprig[];
  mushrooms: Flower[];
  bushes: Bush[];
  /** The woodland edge along the rim, drawn like the decor trees. */
  rimTrees: DecorTree[];
  ducks: Duck[];
  deer: Deer[];
  flocks: Flock[];
  butterflies: Butterfly[];
}

/** Lawn kept beyond each landmark site's own radius (see landmarksLayout.ts), so nature never crowds a garden. */
export const LANDMARK_MARGIN = 1;
/** Kept free beyond a footpath's edge: the hedge line sits 1.1 out and is ~0.9 across. */
export const SHRUB_MARGIN = 2.1;
/** The shoreline (sand, stones, reeds) reaches this far beyond the water's edge, as a multiple of it. */
export const POND_SHORE = 1.3;
/** A meadow's ground patch reaches this far from its centre, as a multiple of its radius. */
export const MEADOW_REACH = 1.25;
/** Tidy lawn kept around the central plaza and the district plazas. */
const PLAZA_MARGIN = 2;
const TASK_SLOT_CLEAR = 3;
const TRUNK = 0.45;
const RIM_MARGIN = 1.2;

/** Wildflowers: pale and warm, a few blues and lilacs. A meadow picks three or four. */
export const FLOWER_COLORS = ['#f6efe0', '#f4d35e', '#f2a541', '#e88aa6', '#b8a9e3', '#7fa7d9', '#e4572e', '#fbe7b5'];
const MUSHROOM_COLORS = ['#c8553d', '#c8553d', '#d9b48a', '#b07a4f', '#efe3cf'];
const BUTTERFLY_COLORS = ['#f6efe0', '#f4d35e', '#f2a541', '#b8a9e3', '#9fd3e6'];
const BUSH_COLORS = ['#5d8a52', '#678f58', '#6f9a5b', '#56804c', '#7a9a5e'];
const RIM_CANOPY = ['#5d8a52', '#678f58', '#4f7a48', '#6f9a5b', '#7fae68'];

/** Distance from the pond centre to its water's edge in a direction (world angle). */
export function pondRadiusAt(p: Pond, angle: number): number {
  const n = p.shape.length;
  const t = ((((angle / (2 * Math.PI)) % 1) + 1) % 1) * n;
  const i = Math.floor(t);
  const k = t - i;
  return p.radius * (p.shape[i % n]! * (1 - k) + p.shape[(i + 1) % n]! * k);
}

/** How far the pond and its shore reach from the centre at most. */
export const pondReach = (p: Pond) => p.radius * Math.max(...p.shape) * POND_SHORE;

function distToPolyline(x: number, z: number, line: THREE.Vector2[]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const abx = b.x - a.x;
    const abz = b.y - a.y;
    const t = Math.min(1, Math.max(0, ((x - a.x) * abx + (z - a.y) * abz) / Math.max(abx * abx + abz * abz, 1e-6)));
    best = Math.min(best, Math.hypot(x - a.x - abx * t, z - a.y - abz * t));
  }
  return best;
}

/** Ground footprint of everything that stands on the lawn, as discs (for tests and overlap checks). */
export function natureFootprints(n: NatureLayout): { x: number; z: number; r: number; kind: string }[] {
  const at = <T extends { x: number; z: number }>(kind: string, list: T[], r: (t: T) => number) => list.map((t) => ({ x: t.x, z: t.z, r: r(t), kind }));
  return [
    ...at('pond', n.ponds, pondReach),
    ...at('meadow', n.meadows, (m) => m.radius * MEADOW_REACH),
    ...at('rock', n.rocks, (r) => r.scale * 1.1),
    ...at('log', n.logs, (l) => l.length / 2),
    ...at('stump', n.stumps, (s) => s.scale * 0.55),
    ...at('flower', n.flowers, (f) => f.scale * 0.15),
    ...at('tuft', n.tufts, (t) => t.scale * 0.45),
    ...at('fern', n.ferns, (f) => f.scale * 0.8),
    ...at('mushroom', n.mushrooms, (m) => m.scale * 0.2),
    ...at('bush', n.bushes, (b) => b.scale * 0.95),
    ...at('rimTree', n.rimTrees, (t) => t.scale * 1.3),
    ...at('deer', n.deer, (d) => d.scale * 1.2),
  ];
}

export function buildNatureLayout(city: CityLayout, park: ParkLayout): NatureLayout {
  const rand = rng(4242);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
  const sites = landmarkSites(city);
  const districts = city.districts.map((d) => ({ x: d.x, z: d.z, r: districtPlazaRadius(d.size) }));
  const slots = [...park.taskSlots.values()].flat();
  const lines = [...park.paths.values()];
  const trees: DecorTree[] = [...park.trees];
  const occupied: { x: number; z: number; r: number }[] = [];

  const inner = city.plazaRadius + 10;
  const outer = PLATFORM_RADIUS - 12;
  /** 0 by HQ, 1 at the woodland edge. */
  const wild = (x: number, z: number) => Math.min(1, Math.max(0, (Math.hypot(x, z) - inner) / (outer - inner)));

  /** The far side of each district is its settlement; sample the disc's edge as well as its centre. */
  const settled = (x: number, z: number, r: number) => {
    if (inSettlement(city.districts, x, z)) return true;
    const rings = r > 4 ? [r + 0.6, r / 2] : [r + 0.6];
    for (const rr of rings) for (let k = 0; k < 16; k++) if (inSettlement(city.districts, x + Math.cos(k * 0.3927) * rr, z + Math.sin(k * 0.3927) * rr)) return true;
    return false;
  };

  /** True if a disc of radius r at (x, z) is open lawn. `canopy` keeps it out from under the trees too. */
  const fits = (x: number, z: number, r: number, canopy = false) => {
    const R = Math.hypot(x, z);
    if (R + r > PLATFORM_RADIUS - RIM_MARGIN || R - r < city.plazaRadius + PLAZA_MARGIN) return false;
    for (const d of districts) if (Math.hypot(x - d.x, z - d.z) - r < d.r + PLAZA_MARGIN) return false;
    for (const s of sites) if (Math.hypot(x - s.x, z - s.z) - r < s.radius + LANDMARK_MARGIN) return false;
    for (const s of slots) if (Math.hypot(x - s.x, z - s.y) - r < TASK_SLOT_CLEAR) return false;
    for (const o of occupied) if (Math.hypot(x - o.x, z - o.z) < o.r + r) return false;
    for (const t of trees) if (Math.hypot(x - t.x, z - t.z) - r < (canopy ? 1.3 * t.scale : TRUNK)) return false;
    if (settled(x, z, r)) return false;
    for (const line of lines) if (distToPolyline(x, z, line) - r < PATH_WIDTH / 2 + SHRUB_MARGIN) return false;
    return true;
  };
  const randomSpot = (rMin: number, rMax: number) => {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rMin * rMin + rand() * (rMax * rMax - rMin * rMin));
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  };

  // ponds: in the biggest open stretches of lawn, well apart from each other
  const ponds: Pond[] = [];
  for (let n = 0; n < 3; n++) {
    let best: { x: number; z: number; radius: number } | undefined;
    for (let i = 0; i < 1000; i++) {
      // the first pond prefers the middle lawn (falling back to anywhere), the others go wherever there is room
      const p = randomSpot(inner, n === 0 && i < 600 ? 88 : PLATFORM_RADIUS - 8);
      if (n === 0 && i === 600 && best) break;
      if (ponds.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 34)) continue;
      const radius = [7.5, 6.5, 5.5, 4.5, 3.8].find((r) => fits(p.x, p.z, r * 1.2 * POND_SHORE + 0.5, true));
      if (radius && (!best || radius > best.radius)) best = { ...p, radius };
    }
    if (!best) break;
    const [p1, p2] = [rand() * 6.3, rand() * 6.3];
    const shape = Array.from({ length: 14 }, (_, i) => {
      const a = (i / 14) * Math.PI * 2;
      return 1 + 0.12 * Math.sin(2 * a + p1) + 0.07 * Math.sin(3 * a + p2) + (rand() - 0.5) * 0.06;
    });
    const pond: Pond = { ...best, shape };
    if (n !== 1) {
      // the jetty faces HQ, so it reads from the usual camera angles
      const angle = Math.atan2(-pond.z, -pond.x);
      const edge = pondRadiusAt(pond, angle);
      pond.jetty = { angle, from: edge * 1.15, to: edge * 0.58 };
    }
    ponds.push(pond);
    occupied.push({ x: pond.x, z: pond.z, r: pondReach(pond) });
  }

  const lilies: Lily[] = [];
  const reeds: Sprig[] = [];
  const cattails: Sprig[] = [];
  const rocks: Rock[] = [];
  const ducks: Duck[] = [];
  const nearJetty = (p: Pond, a: number, by: number) => !!p.jetty && Math.abs(Math.atan2(Math.sin(a - p.jetty.angle), Math.cos(a - p.jetty.angle))) < by;
  ponds.forEach((p, pi) => {
    const minR = p.radius * Math.min(...p.shape);
    for (let i = 0, n = 13 + Math.floor(rand() * 7); i < n; i++) {
      const a = rand() * Math.PI * 2;
      if (nearJetty(p, a, 0.4)) continue;
      const r = pondRadiusAt(p, a) * (0.5 + rand() * 0.32);
      lilies.push({ x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, scale: 0.9 + rand() * 0.7, rot: rand() * 6.3, bloom: rand() < 0.3 });
    }
    // reeds and cattails in one or two beds along the shore
    for (let bed = 0, beds = 1 + (rand() < 0.6 ? 1 : 0); bed < beds; bed++) {
      const centre = (p.jetty?.angle ?? 0) + Math.PI * (bed ? 0.55 : 1.15) + (rand() - 0.5) * 0.6;
      for (let i = 0; i < 16; i++) {
        const a = centre + (rand() - 0.5) * 1.3;
        if (nearJetty(p, a, 0.6)) continue;
        const r = pondRadiusAt(p, a) * (0.86 + rand() * 0.2);
        const spot = { x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, scale: 0.7 + rand() * 0.6, rot: rand() * 6.3 };
        (i % 3 === 0 ? cattails : reeds).push(spot);
      }
    }
    // shore stones, with gaps
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + rand() * 0.2;
      if (rand() < 0.35 || nearJetty(p, a, 0.3)) continue;
      const r = pondRadiusAt(p, a) * (1.1 + rand() * 0.1);
      rocks.push({ x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, scale: 0.25 + rand() * 0.28, squash: 0.45 + rand() * 0.25, rot: rand() * 6.3, mossy: rand() < 0.3 });
    }
    for (let i = 0, n = 2 + Math.floor(rand() * 2); i < n; i++)
      ducks.push({ pond: pi, orbit: minR * (0.2 + rand() * 0.22), phase: rand() * 6.3, speed: (rand() < 0.5 ? -1 : 1) * (0.05 + rand() * 0.05) });
  });

  // the woodland edge: a loose band of trees and undergrowth just inside the rim
  const rimTrees: DecorTree[] = [];
  for (let i = 0; i < 3000 && rimTrees.length < 130; i++) {
    const p = randomSpot(PLATFORM_RADIUS - 15, PLATFORM_RADIUS - 3);
    const scale = 0.85 + rand() * 0.75;
    if (trees.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < 2.9)) continue;
    if (!fits(p.x, p.z, scale * 1.3)) continue;
    const tree: DecorTree = { ...p, scale, variant: rand() < 0.45 ? 1 : 0, color: pick(RIM_CANOPY), rot: rand() * 6.3 };
    rimTrees.push(tree);
    trees.push(tree);
  }
  const bushes: Bush[] = [];
  for (let i = 0; i < 3000 && bushes.length < 170; i++) {
    const p = randomSpot(PLATFORM_RADIUS - 16, PLATFORM_RADIUS - 2.5);
    const scale = 0.55 + rand() * 0.6;
    if (!fits(p.x, p.z, scale * 0.95)) continue;
    bushes.push({ ...p, scale, rot: rand() * 6.3, color: pick(BUSH_COLORS) });
    occupied.push({ x: p.x, z: p.z, r: scale * 0.95 });
  }

  // a few deer grazing in clearings near the rim
  const deer: Deer[] = [];
  for (let i = 0, herds = 0; i < 600 && herds < 2; i++) {
    const c = randomSpot(PLATFORM_RADIUS - 24, PLATFORM_RADIUS - 9);
    if (!fits(c.x, c.z, 4.5)) continue;
    herds++;
    const facing = rand() * 6.3;
    for (let k = 0, n = 2 + herds - 1; k < n; k++) {
      const a = facing + k * 2.2 + rand() * 0.6;
      const x = c.x + Math.cos(a) * 2;
      const z = c.z + Math.sin(a) * 2;
      const scale = k ? 0.85 + rand() * 0.15 : 1.05;
      if (!fits(x, z, scale * 1.2)) continue;
      deer.push({ x, z, rot: facing + (rand() - 0.5) * 1.6, scale, phase: rand() * 6.3 });
      occupied.push({ x, z, r: scale * 1.2 });
    }
  }

  // rock outcrops: boulder clusters, mossier and more frequent toward the rim
  for (let i = 0, made = 0; i < 1500 && made < 18; i++) {
    const c = randomSpot(inner, PLATFORM_RADIUS - 4);
    const w = wild(c.x, c.z);
    if (rand() > 0.12 + 0.88 * w * w || !fits(c.x, c.z, 1.5)) continue;
    made++;
    const n = 2 + Math.floor(rand() * (2 + w * 3));
    for (let k = 0; k < n; k++) {
      const a = rand() * Math.PI * 2;
      const d = k ? 1.4 + rand() * 1.6 : 0;
      const x = c.x + Math.cos(a) * d;
      const z = c.z + Math.sin(a) * d;
      const scale = k ? 0.45 + rand() * 0.7 : 1 + rand() * 0.6 * (0.5 + w);
      if (!fits(x, z, scale * 1.1)) continue;
      rocks.push({ x, z, scale, squash: 0.6 + rand() * 0.6, rot: rand() * 6.3, mossy: rand() < 0.2 + 0.5 * w });
      occupied.push({ x, z, r: scale * 1.1 });
    }
  }
  // lone boulders scattered along the woodland edge
  for (let i = 0, made = 0; i < 600 && made < 22; i++) {
    const p = randomSpot(PLATFORM_RADIUS - 18, PLATFORM_RADIUS - 3);
    const scale = 0.4 + rand() * 0.8;
    if (!fits(p.x, p.z, scale * 1.1)) continue;
    made++;
    rocks.push({ ...p, scale, squash: 0.5 + rand() * 0.6, rot: rand() * 6.3, mossy: rand() < 0.6 });
    occupied.push({ x: p.x, z: p.z, r: scale * 1.1 });
  }

  // fallen logs and stumps beside trees
  const logs: Log[] = [];
  const stumps: Sprig[] = [];
  for (let i = 0; i < 400 && logs.length < 12; i++) {
    const t = pick(trees);
    if (rand() > 0.25 + wild(t.x, t.z)) continue;
    const a = rand() * Math.PI * 2;
    const d = 2.6 + rand() * 1.8;
    const x = t.x + Math.cos(a) * d;
    const z = t.z + Math.sin(a) * d;
    const length = 2.4 + rand() * 1.8;
    if (!fits(x, z, length / 2)) continue;
    logs.push({ x, z, rot: rand() * Math.PI, length, radius: 0.24 + rand() * 0.14 });
    occupied.push({ x, z, r: length / 2 });
  }
  for (let i = 0; i < 400 && stumps.length < 16; i++) {
    const t = pick(trees);
    if (rand() > 0.3 + wild(t.x, t.z)) continue;
    const a = rand() * Math.PI * 2;
    const d = 1.8 + rand() * 2;
    const x = t.x + Math.cos(a) * d;
    const z = t.z + Math.sin(a) * d;
    const scale = 0.7 + rand() * 0.6;
    if (!fits(x, z, scale * 0.55)) continue;
    stumps.push({ x, z, scale, rot: rand() * 6.3 });
    occupied.push({ x, z, r: scale * 0.55 });
  }

  // wildflower meadows: drifts of three or four colours in the open lawn, butterflies above them
  const meadows: Meadow[] = [];
  const flowers: Flower[] = [];
  const tufts: Sprig[] = [];
  const butterflies: Butterfly[] = [];
  for (let i = 0; i < 1200 && meadows.length < 16; i++) {
    const c = randomSpot(inner - 4, PLATFORM_RADIUS - 6);
    const w = wild(c.x, c.z);
    // the meadow's ground patch reaches MEADOW_REACH × radius; its middle is out from under the trees.
    // In a crowded city a meadow makes do with less room.
    if (rand() > 0.35 + 0.65 * w || !fits(c.x, c.z, 1.5, true)) continue;
    const radius = [4 + rand() * 3.5, 4, 3].find((r) => fits(c.x, c.z, r * MEADOW_REACH));
    if (!radius || meadows.some((m) => Math.hypot(m.x - c.x, m.z - c.z) < (m.radius + radius) * MEADOW_REACH + 6)) continue;
    const colors = [...FLOWER_COLORS].sort(() => rand() - 0.5).slice(0, 3 + (rand() < 0.5 ? 1 : 0));
    meadows.push({ ...c, radius, colors });
    // each colour grows in its own drift, so the patch reads as patches rather than confetti
    colors.forEach((color, ci) => {
      const da = rand() * Math.PI * 2;
      const dd = rand() * radius * 0.4;
      const dx = c.x + Math.cos(da) * dd;
      const dz = c.z + Math.sin(da) * dd;
      const n = Math.round(radius * radius * (ci === 0 ? 2.6 : 1.6));
      for (let k = 0; k < n; k++) {
        const a = rand() * Math.PI * 2;
        // dense in the drift, thinning out toward the meadow's edge
        const r = radius * 0.9 * Math.pow(rand(), 0.75);
        const x = dx + Math.cos(a) * r;
        const z = dz + Math.sin(a) * r;
        const scale = 0.75 + rand() * 0.5;
        if (Math.hypot(x - c.x, z - c.z) > radius || !fits(x, z, scale * 0.15)) continue;
        flowers.push({ x, z, scale, color });
      }
    });
    for (let k = 0; k < 6 + radius * 2; k++) {
      const a = rand() * Math.PI * 2;
      const r = radius * (0.7 + rand() * 0.5);
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r;
      const scale = 0.7 + rand() * 0.6;
      if (fits(x, z, scale * 0.45)) tufts.push({ x, z, scale, rot: rand() * 6.3 });
    }
    for (let k = 0, n = 2 + Math.floor(rand() * 2); k < n; k++) butterflies.push({ ...c, radius: radius * 0.8, phase: rand() * 6.3, color: pick(BUTTERFLY_COLORS) });
  }

  // tall grass: scattered tufts, thicker toward the rim
  for (let i = 0; i < 4000 && tufts.length < 800; i++) {
    const p = randomSpot(inner - 6, PLATFORM_RADIUS - 2);
    const w = wild(p.x, p.z);
    if (rand() > 0.05 + 0.95 * w * w) continue;
    const scale = 0.7 + rand() * 0.7;
    if (!fits(p.x, p.z, scale * 0.45)) continue;
    // a tuft rarely grows alone
    for (let k = 0; k < 3; k++) {
      const x = p.x + (rand() - 0.5) * 1.6;
      const z = p.z + (rand() - 0.5) * 1.6;
      if (k === 0 || fits(x, z, scale * 0.45)) tufts.push({ x: k ? x : p.x, z: k ? z : p.z, scale: scale * (k ? 0.8 : 1), rot: rand() * 6.3 });
    }
  }

  // ferns and mushrooms in the shade of the trees
  const ferns: Sprig[] = [];
  const mushrooms: Flower[] = [];
  for (const t of trees) {
    const w = wild(t.x, t.z);
    if (rand() > 0.15 + 0.6 * w) continue;
    for (let k = 0, n = 1 + Math.floor(rand() * 3); k < n; k++) {
      const a = rand() * Math.PI * 2;
      const d = 1.2 + rand() * 1.4;
      const x = t.x + Math.cos(a) * d;
      const z = t.z + Math.sin(a) * d;
      const scale = 0.7 + rand() * 0.6;
      if (ferns.some((f) => Math.hypot(f.x - x, f.z - z) < 1.1)) continue;
      if (fits(x, z, scale * 0.8)) ferns.push({ x, z, scale, rot: rand() * 6.3 });
    }
    if (rand() < 0.25) {
      const a = rand() * Math.PI * 2;
      const d = 0.7 + rand() * 0.8;
      const x = t.x + Math.cos(a) * d;
      const z = t.z + Math.sin(a) * d;
      const scale = 0.8 + rand() * 0.5;
      if (fits(x, z, scale * 0.2)) mushrooms.push({ x, z, scale, color: pick(MUSHROOM_COLORS) });
    }
  }
  // fairy rings: a circle of toadstools near a tree
  for (let i = 0, rings = 0; i < 300 && rings < 9; i++) {
    const t = pick(trees);
    const a = rand() * Math.PI * 2;
    const cx = t.x + Math.cos(a) * 2.6;
    const cz = t.z + Math.sin(a) * 2.6;
    const r = 1 + rand() * 0.6;
    if (!fits(cx, cz, r + 0.3)) continue;
    rings++;
    const color = pick(MUSHROOM_COLORS);
    for (let k = 0, n = 8 + Math.floor(rand() * 4); k < n; k++) {
      if (rand() < 0.15) continue;
      const b = (k / n) * Math.PI * 2 + rand() * 0.2;
      mushrooms.push({ x: cx + Math.cos(b) * r, z: cz + Math.sin(b) * r, scale: 0.7 + rand() * 0.5, color });
    }
  }

  // birds wheeling high over the park
  const flocks: Flock[] = [];
  for (let i = 0; i < 3; i++) {
    const c = randomSpot(30, 90);
    flocks.push({ ...c, radius: 14 + rand() * 12, height: 22 + rand() * 8, phase: rand() * 6.3, speed: (rand() < 0.5 ? -1 : 1) * (0.07 + rand() * 0.04), size: 3 + Math.floor(rand() * 3) });
  }

  return { ponds, lilies, reeds, cattails, rocks, logs, stumps, meadows, flowers, tufts, ferns, mushrooms, bushes, rimTrees, ducks, deer, flocks, butterflies };
}
