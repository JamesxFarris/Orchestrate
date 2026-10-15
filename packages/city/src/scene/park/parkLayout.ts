import * as THREE from 'three';
import { districtPlazaRadius, PLATFORM_RADIUS, type CityLayout, type Placement } from '../../layout.ts';
import { PALETTE } from '../../palette.ts';
import { rng } from '../rng.ts';
import { inSettlement } from '../settlement/settlementLayout.ts';

export { rng };

export interface DecorTree {
  x: number;
  z: number;
  scale: number;
  variant: 0 | 1; // 0 broadleaf, 1 conifer
  color: string;
  rot: number;
}

export interface ParkLayout {
  /** Winding footpath per squad, from the central plaza edge to the district plaza edge (xz). */
  paths: Map<string, THREE.Vector2[]>;
  /** Where this run's task trees grow, per squad (ring just outside the district plaza). */
  taskSlots: Map<string, THREE.Vector2[]>;
  trees: DecorTree[];
  /** Street lamps along the footpaths: their arm (local +x) reaches over the path. */
  lamps: { x: number; z: number; rot: number }[];
  shrubs: { x: number; z: number; scale: number }[];
  /** Ground route between two agents' towers, following the footpaths. */
  route(fromId: string, toId: string): THREE.Vector3[];
}

export const PATH_WIDTH = 3.2;
const TASK_SLOTS = 18;
/** Distance between street lamps along a footpath (they alternate sides). */
const LAMP_SPACING = 8;

export { districtPlazaRadius };

function distToPolyline(p: THREE.Vector2, line: THREE.Vector2[]): number {
  let best = Infinity;
  const ab = new THREE.Vector2();
  const ap = new THREE.Vector2();
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    ab.subVectors(line[i + 1]!, a);
    ap.subVectors(p, a);
    const t = THREE.MathUtils.clamp(ap.dot(ab) / Math.max(ab.lengthSq(), 1e-6), 0, 1);
    best = Math.min(best, ap.sub(ab.multiplyScalar(t)).length());
  }
  return best;
}

function resample(points: THREE.Vector2[], step: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [points[0]!.clone()];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
    for (let k = 1; k <= n; k++) out.push(a.clone().lerp(b, k / n));
  }
  return out;
}

/** Points every `spacing` along a polyline (by distance travelled), with the direction there. */
function stations(points: THREE.Vector2[], spacing: number): { at: THREE.Vector2; dir: THREE.Vector2 }[] {
  const out: { at: THREE.Vector2; dir: THREE.Vector2 }[] = [];
  let next = spacing / 2;
  let walked = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const len = a.distanceTo(b);
    while (next <= walked + len) {
      out.push({ at: a.clone().lerp(b, (next - walked) / len), dir: b.clone().sub(a).normalize() });
      next += spacing;
    }
    walked += len;
  }
  return out;
}

export function buildParkLayout(city: CityLayout): ParkLayout {
  const rand = rng(1337);
  const paths = new Map<string, THREE.Vector2[]>();
  const taskSlots = new Map<string, THREE.Vector2[]>();

  for (const d of city.districts) {
    const dir = new THREE.Vector2(Math.cos(d.angle), Math.sin(d.angle));
    const perp = new THREE.Vector2(-dir.y, dir.x);
    const centre = new THREE.Vector2(d.x, d.z);
    const r0 = city.plazaRadius - 0.5;
    const r1 = centre.length() - districtPlazaRadius(d.size) + 0.5;
    const at = (r: number, sway: number) => dir.clone().multiplyScalar(r).add(perp.clone().multiplyScalar(sway));
    const curve = new THREE.CatmullRomCurve3(
      [at(r0, 0), at(r0 + (r1 - r0) * 0.33, 3.2), at(r0 + (r1 - r0) * 0.66, -3.2), at(r1, 0)].map((v) => new THREE.Vector3(v.x, 0, v.y)),
    );
    paths.set(d.squad.id, curve.getPoints(48).map((v) => new THREE.Vector2(v.x, v.z)));

    // task trees: an arc on the side of the district plaza facing HQ, flanking the footpath (two rows)
    const slots: THREE.Vector2[] = [];
    const ring = districtPlazaRadius(d.size);
    const offsets = [-16, 16, -32, 32, -48, 48, -64, 64, -80, 80].map(THREE.MathUtils.degToRad);
    for (let i = 0; i < TASK_SLOTS; i++) {
      const row = i < offsets.length ? 0 : 1;
      const off = offsets[i % offsets.length]! + (row ? Math.sign(offsets[i % offsets.length]!) * 0.12 : 0);
      const a = d.angle + Math.PI + off;
      const r = ring + 4.2 + row * 4.4;
      slots.push(new THREE.Vector2(d.x + Math.cos(a) * r, d.z + Math.sin(a) * r));
    }
    taskSlots.set(d.squad.id, slots);
  }

  const reserved = [...taskSlots.values()].flat();
  const allPaths = [...paths.values()];

  // street lamps on the hedge line, alternating sides, the arm turned to reach over the path
  const lamps: ParkLayout['lamps'] = [];
  for (const line of allPaths) {
    stations(line, LAMP_SPACING).forEach(({ at: onPath, dir }, i) => {
      const side = i % 2 ? 1 : -1;
      const n = new THREE.Vector2(-dir.y, dir.x).multiplyScalar(side);
      const at = onPath.clone().add(n.clone().multiplyScalar(PATH_WIDTH / 2 + 1.1));
      // local +x is (cos r, -sin r) in xz: point it back at the path
      lamps.push({ x: at.x, z: at.y, rot: Math.atan2(n.y, -n.x) });
    });
  }
  const nearLamp = (x: number, z: number, d: number) => lamps.some((l) => Math.hypot(l.x - x, l.z - z) < d);
  const free = (p: THREE.Vector2, clearance: number) => {
    if (p.length() < city.plazaRadius + 3) return false;
    for (const d of city.districts) if (p.distanceTo(new THREE.Vector2(d.x, d.z)) < districtPlazaRadius(d.size) + 2) return false;
    for (const line of allPaths) if (distToPolyline(p, line) < PATH_WIDTH / 2 + clearance) return false;
    for (const s of reserved) if (p.distanceTo(s) < 4) return false;
    if (nearLamp(p.x, p.y, 3)) return false;
    // the far side of each district plaza is its settlement (see settlement/settlementLayout.ts)
    if (inSettlement(city.districts, p.x, p.y)) return false;
    return true;
  };

  const trees: DecorTree[] = [];
  for (let i = 0; i < 900 && trees.length < 190; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * (PLATFORM_RADIUS - 7);
    const p = new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r);
    if (!free(p, 1.5)) continue;
    if (trees.some((t) => Math.hypot(t.x - p.x, t.z - p.y) < 3.4)) continue;
    trees.push({
      x: p.x,
      z: p.y,
      scale: 0.8 + rand() * 0.7,
      variant: rand() < 0.3 ? 1 : 0,
      color: PALETTE.canopy[Math.floor(rand() * PALETTE.canopy.length)]!,
      rot: rand() * Math.PI * 2,
    });
  }

  // low hedges/shrubs lining both sides of each path
  const shrubs: ParkLayout['shrubs'] = [];
  for (const line of allPaths) {
    const even = resample(line, 2.6);
    for (let i = 2; i < even.length - 2; i++) {
      const t = even[i + 1]!.clone().sub(even[i - 1]!).normalize();
      const n = new THREE.Vector2(-t.y, t.x);
      for (const side of [-1, 1]) {
        if (rand() < 0.25) continue;
        const p = even[i]!.clone().add(n.clone().multiplyScalar(side * (PATH_WIDTH / 2 + 1.1)));
        if (nearLamp(p.x, p.y, 1.4)) continue; // the hedge makes way for the lamp
        shrubs.push({ x: p.x, z: p.y, scale: 0.55 + rand() * 0.35 });
      }
    }
  }

  const inDistrict = (p: Placement) => !!p.squad && p.role.kind !== 'lead';
  const route = (fromId: string, toId: string): THREE.Vector3[] => {
    const a = city.byId.get(fromId);
    const b = city.byId.get(toId);
    if (!a || !b) return [];
    const pa = new THREE.Vector2(a.x, a.z);
    const pb = new THREE.Vector2(b.x, b.z);
    let pts: THREE.Vector2[];
    if (inDistrict(a) && inDistrict(b) && a.squad!.id === b.squad!.id) pts = [pa, pb];
    else {
      pts = [pa];
      if (inDistrict(a)) pts.push(...[...paths.get(a.squad!.id)!].reverse());
      if (inDistrict(b)) pts.push(...paths.get(b.squad!.id)!);
      pts.push(pb);
    }
    return resample(pts, 0.8).map((p) => new THREE.Vector3(p.x, 0, p.y));
  };

  return { paths, taskSlots, trees, shrubs, lamps, route };
}
