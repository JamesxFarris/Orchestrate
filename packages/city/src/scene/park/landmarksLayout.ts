import { districtPlazaRadius, PLATFORM_RADIUS, type CityLayout } from '../../layout.ts';
import { inSettlement } from '../settlement/settlementLayout.ts';

/**
 * Landmarks in the open parkland: one site midway between each pair of neighbouring districts, out
 * on the district ring. Pure and deterministic: every city has a fixed, ordered list of sites, each
 * with its landmark (a grand fountain, a statue, a bandstand, a triumphal arch, an obelisk), and the
 * city's overall growth only decides how many are built. Growing adds landmarks; it never moves one.
 * An unbuilt site is a mown clearing, waiting.
 */

export interface Site {
  x: number;
  z: number;
  /** Disc the landmark and its formal garden stay inside. */
  radius: number;
}

export type LandmarkKind = 'fountain' | 'statue' | 'bandstand' | 'arch' | 'obelisk';

export interface Landmark extends Site {
  kind: LandmarkKind;
  /** Rotation about y; the landmark's local +z (its front) faces HQ. */
  rot: number;
  /** Unlock order: 0 is built first. */
  rank: number;
  /** 0 or 1: the second round of a kind looks a little different (the statue holds a scroll, not a lantern). */
  variant: 0 | 1;
}

/** Largest site; the nature agent keeps a disc of radius 12 round each site centre free. */
export const SITE_RADIUS = 11;
/** Smaller than this, a landmark would look like a garden ornament: the site is dropped. */
const MIN_RADIUS = 6;
/** The first five landmarks built, in order; later ones repeat them (see layoutLandmarks). */
const KINDS: LandmarkKind[] = ['fountain', 'statue', 'bandstand', 'arch', 'obelisk'];

/** Room kept round a district: plaza, both rows of task trees (plaza + 8.6, status ring 2.1) and a margin. */
const DISTRICT_CLEAR = 11.5;
/** Footpaths sway 3.2 either side of the radial line, then the path half-width and its hedges. */
const PATH_CLEAR = 3.2 + 1.6 + 2.6;
/** Extra lawn kept between a site and a settlement's outermost yards. */
const SETTLEMENT_CLEAR = 2;

/** Radius of the ring the districts sit on: the mean distance of their centres from HQ. */
export function districtRing(city: CityLayout): number {
  if (!city.districts.length) return 0;
  return city.districts.reduce((sum, d) => sum + Math.hypot(d.x, d.z), 0) / city.districts.length;
}

/** Angles midway between each district and the next one round the ring (two sites for two squads). */
function midAngles(city: CityLayout): number[] {
  const ds = city.districts;
  if (ds.length < 2) return [];
  return ds.map((d, i) => {
    const next = ds[(i + 1) % ds.length]!;
    let gap = next.angle - d.angle;
    while (gap <= 0) gap += Math.PI * 2;
    while (gap > Math.PI * 2) gap -= Math.PI * 2;
    return d.angle + gap / 2;
  });
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const t = Math.min(1, Math.max(0, ((px - ax) * abx + (pz - az) * abz) / Math.max(abx * abx + abz * abz, 1e-6)));
  return Math.hypot(px - ax - abx * t, pz - az - abz * t);
}

/** Does a disc at (x, z) of radius r keep clear of HQ, every district, footpath and settlement? */
function fits(city: CityLayout, x: number, z: number, r: number): boolean {
  const fromHq = Math.hypot(x, z);
  if (fromHq - r < city.plazaRadius + 3 || fromHq + r > PLATFORM_RADIUS - 6) return false;
  for (const d of city.districts) {
    const plaza = districtPlazaRadius(d.size);
    if (Math.hypot(x - d.x, z - d.z) - r < plaza + DISTRICT_CLEAR) return false;
    // the footpath runs (with a sway) along the district's radial line, from HQ's plaza to its own
    const dir = { x: Math.cos(d.angle), z: Math.sin(d.angle) };
    const r0 = city.plazaRadius;
    const r1 = Math.hypot(d.x, d.z) - plaza;
    if (distToSegment(x, z, dir.x * r0, dir.z * r0, dir.x * r1, dir.z * r1) - r < PATH_CLEAR) return false;
  }
  // settlements: sample the disc and a ring just beyond it
  if (inSettlement(city.districts, x, z)) return false;
  for (const k of [0.5, 1]) {
    const rr = r * k + (k === 1 ? SETTLEMENT_CLEAR : 0);
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      if (inSettlement(city.districts, x + Math.cos(a) * rr, z + Math.sin(a) * rr)) return false;
    }
  }
  return true;
}

/** Largest radius (in steps of 0.25, up to SITE_RADIUS) a site at (x, z) can have; 0 if none fits. */
function roomAt(city: CityLayout, x: number, z: number): number {
  for (let r = SITE_RADIUS; r >= MIN_RADIUS; r -= 0.25) if (fits(city, x, z, r)) return r;
  return 0;
}

/** A site this roomy is good enough; below it, look a little further out along the ray for more room. */
const ROOMY = 9;
const SLIDE_STEP = 3;

/**
 * Where landmarks may stand: for each pair of neighbouring districts, the point at the angle midway
 * between them on the district ring (`districtRing`), with the largest radius up to SITE_RADIUS that
 * keeps clear of everything else. With up to five squads of usual size that spot always has a full
 * SITE_RADIUS. When neighbouring districts crowd it (many or wide squads), the site slides outward
 * along the same ray, then inward, to the nearest spot with room; a site with no room anywhere on
 * its ray is left out.
 */
export function landmarkSites(city: CityLayout): Site[] {
  const ring = districtRing(city);
  const sites: Site[] = [];
  const offsets = [0];
  for (let k = SLIDE_STEP; k < PLATFORM_RADIUS; k += SLIDE_STEP) offsets.push(k, -k);
  for (const a of midAngles(city)) {
    let best: Site | undefined;
    for (const off of offsets) {
      const at = ring + off;
      if (at - MIN_RADIUS < city.plazaRadius || at + MIN_RADIUS > PLATFORM_RADIUS) continue;
      const x = Math.cos(a) * at;
      const z = Math.sin(a) * at;
      const radius = roomAt(city, x, z);
      if (radius > (best?.radius ?? 0)) best = { x, z, radius };
      if (radius >= ROOMY) break;
    }
    if (best) sites.push(best);
  }
  return sites;
}

/** Direction the default camera looks from (see City.tsx): the first landmark goes where it is seen. */
const FRONT = Math.PI / 4;
const angleBetween = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/**
 * The sites in the order they are built: the one facing the default camera first, then each next
 * one as far round the ring from those already built as possible, so landmarks spread evenly.
 */
function unlockOrder(sites: Site[]): number[] {
  const angles = sites.map((s) => Math.atan2(s.z, s.x));
  const order: number[] = [];
  const left = new Set(angles.keys());
  const pick = (score: (i: number) => number) => {
    let best = -1;
    for (const i of left) if (best < 0 || score(i) > score(best) + 1e-9) best = i;
    left.delete(best);
    order.push(best);
  };
  if (left.size) pick((i) => -angleBetween(angles[i]!, FRONT));
  while (left.size) pick((i) => Math.min(...order.map((j) => angleBetween(angles[i]!, angles[j]!))));
  return order;
}

/**
 * Every landmark the city will ever have, in site order (round the ring). The first five built are
 * one of each kind; after that each takes the kind its neighbours round the ring don't have, used
 * least so far (earliest in KINDS on a tie), so a big city never has two fountains side by side.
 */
export function layoutLandmarks(city: CityLayout): Landmark[] {
  const sites = landmarkSites(city);
  const order = unlockOrder(sites);
  const kinds: LandmarkKind[] = [];
  const used = new Map<LandmarkKind, number>();
  const marks: Landmark[] = [];
  order.forEach((i, rank) => {
    const s = sites[i]!;
    const n = sites.length;
    const neighbours = new Set([kinds[(i + n - 1) % n], kinds[(i + 1) % n]]);
    const score = (k: LandmarkKind) => (neighbours.has(k) ? 100 : 0) + (used.get(k) ?? 0);
    const kind = KINDS.reduce((best, k) => (score(k) < score(best) ? k : best));
    const variant = ((used.get(kind) ?? 0) % 2) as 0 | 1;
    kinds[i] = kind;
    used.set(kind, (used.get(kind) ?? 0) + 1);
    marks[i] = { ...s, kind, rot: Math.atan2(-s.x, -s.z), rank, variant };
  });
  return marks;
}

/**
 * How many landmarks stand, from the districts' settlement levels (Hamlet 1 … City 5): none while
 * the mean is Hamlet, a share for each step of the mean beyond it, all of them once the city's mean
 * reaches City.
 */
export function landmarksBuilt(levels: readonly number[], sites: number): number {
  if (!levels.length || !sites) return 0;
  const mean = levels.reduce((sum, l) => sum + Math.min(Math.max(l, 1), 5), 0) / levels.length;
  return Math.min(sites, Math.max(0, Math.ceil((sites * (mean - 1)) / 4 - 1e-9)));
}
