import { districtPlazaRadius, type District } from '../../layout.ts';
import { rng } from '../rng.ts';
import type { HouseName, Point, Settlement } from './settlementLayout.ts';

/**
 * Who lives in a district's settlement, and what of it moves or glows: villagers strolling the
 * lanes, a few chatting by the well and fountain, smoke from some chimneys, lit windows. Pure and
 * deterministic, like the houses: the same district and level always give the same people walking
 * the same beats. The renderer (Life.tsx) only turns these into matrices, once per frame.
 */

/** Someone strolling back and forth along a stretch of an arc around the district centre. */
export interface Walker {
  /** Arc centre (the district's) and radius; the radius is the lane's, nudged off its centre line. */
  cx: number;
  cz: number;
  radius: number;
  /** The stretch walked, in radians around the centre: from `from` to `from + span`, and back. */
  from: number;
  span: number;
  /** Seconds for one leg (end to end). */
  leg: number;
  /** 0–1, where in the round trip they are at t = 0. */
  phase: number;
  /** Index into the clothing colours; -1 wears the squad colour. */
  coat: number;
  /** Height multiplier, so a crowd is not all one size. */
  height: number;
}

/** Someone standing still by the well or the fountain, turned toward it. */
export interface Chatter extends Point {
  /** Rotation about y; the figure's local +z faces this way. */
  rot: number;
  coat: number;
  height: number;
  /** Seconds offset for their small idle sway. */
  phase: number;
}

/** A chimney that smokes: its top in world space. */
export interface Smoke extends Point {
  y: number;
  /** Seconds offset, so chimneys don't puff in step. */
  phase: number;
  /** Index of the house in the settlement, so the renderer can hide it while the house rises. */
  house: number;
}

/** A lit window pane: centre in world space, facing out of the house's front. */
export interface LitWindow extends Point {
  y: number;
  rot: number;
  /** Pane size in world units. */
  width: number;
  height: number;
  /** 0–1, varies the warmth of the light. */
  warmth: number;
  house: number;
}

export interface Life {
  walkers: Walker[];
  chatters: Chatter[];
  smoke: Smoke[];
  windows: LitWindow[];
}

/** Muted clothing: linen, moss, rust, slate, ochre, plum, oatmeal. The renderer maps indices to these. */
export const COATS = ['#e3d6b8', '#7f9a62', '#b8664a', '#6b7f92', '#d4a54e', '#8e6683', '#c9b9a0'];

/** Walking pace in world units per second: an unhurried stroll. */
const PACE = 0.55;
/** How far a walker keeps off a lane's centre line, where the lamps stand. */
const OFF_CENTRE = [0.3, 0.4];
/** Clear distance kept from the well and fountain centres: the stone rim plus a figure's width. */
export const WELL_CLEAR = 1.25;
export const FOUNTAIN_CLEAR = 2.3;
/** The grass footpath in front of the first row of houses, for settlements without lanes yet. */
const FRONT_PATH = 2.2;
/** Settlement arc half-width (matches settlementLayout's ARC). */
const ARC = (70 * Math.PI) / 180;

/** Walkers per level: Hamlet 2, Village 3, Town 6, Borough 9, City 13, then +2 per City level up to 19. */
const WALKERS = [2, 3, 6, 9, 13];
export function walkerCount(level: number): number {
  const l = Math.max(1, level);
  return l <= WALKERS.length ? WALKERS[l - 1]! : Math.min(19, WALKERS[WALKERS.length - 1]! + 2 * (l - WALKERS.length));
}

/**
 * Where each model's chimney top is, in the house's local frame (front door toward +z). Measured
 * from settlement.glb: crofts and townhouses have no chimney.
 */
export const CHIMNEYS: Partial<Record<HouseName, { x: number; y: number; z: number }>> = {
  cottage: { x: 0.7, y: 2.8, z: -0.23 },
  longhouse: { x: 1.4, y: 2.8, z: -0.23 },
  hall: { x: 1.4, y: 4.2, z: -0.23 },
  tallhouse: { x: -0.23, y: 4.2, z: 0.7 },
};

/**
 * Front windows per model, as [x, y] pane centres in the house's local frame. The kit's houses are
 * built from 1.4-unit wall tiles: one window per tile and floor along the front, except the door's.
 */
const FRONT: Record<HouseName, { tiles: number; floors: number; door: number }> = {
  cottage: { tiles: 2, floors: 1, door: 0 },
  croft: { tiles: 2, floors: 1, door: 1 },
  longhouse: { tiles: 3, floors: 1, door: 1 },
  townhouse: { tiles: 2, floors: 2, door: 0 },
  hall: { tiles: 3, floors: 2, door: 1 },
  tallhouse: { tiles: 2, floors: 2, door: 1 },
};
const TILE = 1.4;
/** The window glass sits just behind the front wall's face (z = 1.4); panes go between glass and frame. */
const PANE_Z = 1.365;
const PANE = { width: 0.5, height: 0.55 };

export function windowPanes(house: HouseName): { x: number; y: number }[] {
  const { tiles, floors, door } = FRONT[house];
  const panes: { x: number; y: number }[] = [];
  for (let f = 0; f < floors; f++)
    for (let i = 0; i < tiles; i++) if (f > 0 || i !== door) panes.push({ x: (i - (tiles - 1) / 2) * TILE, y: f * TILE + 0.7 });
  return panes;
}

const seedOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 11);
/** A house-local point (front toward +z), turned by `rot` and placed at (x, z): the same transform the houses use. */
const toWorld = (h: { x: number; z: number; rot: number }, lx: number, lz: number) => ({
  x: h.x + lx * Math.cos(h.rot) + lz * Math.sin(h.rot),
  z: h.z - lx * Math.sin(h.rot) + lz * Math.cos(h.rot),
});

export function layoutLife(d: District, s: Settlement, level: number): Life {
  const rand = rng(seedOf(d.squad.id) ^ 0x51f3);
  const plaza = districtPlazaRadius(d.size);
  const coat = () => (rand() < 0.14 ? -1 : Math.floor(rand() * COATS.length));
  const height = () => 0.88 + rand() * 0.22;

  // Paths to walk: the lanes once a Town has them, plus the footpath in front of the first row.
  // Before lanes, the footpath only runs as wide as the houses already built.
  const spread = s.houses.reduce((m, h) => {
    const a = Math.atan2(h.z - d.z, h.x - d.x) - d.angle;
    return Math.max(m, Math.abs(Math.atan2(Math.sin(a), Math.cos(a))));
  }, 0.15);
  const front = { radius: plaza + FRONT_PATH, start: d.angle - Math.min(ARC, spread + 0.2), length: 2 * Math.min(ARC, spread + 0.2) };
  const paths = s.features.lanes.length ? [...s.features.lanes, front] : [front];

  const walkers: Walker[] = [];
  const n = walkerCount(level);
  for (let i = 0; i < n; i++) {
    const path = paths[i % paths.length]!;
    const side = rand() < 0.5 ? -1 : 1;
    const radius = path.radius + side * (OFF_CENTRE[0]! + rand() * (OFF_CENTRE[1]! - OFF_CENTRE[0]!));
    // a stretch of 35–70% of the path, somewhere along it
    const span = path.length * (0.35 + rand() * 0.35);
    const from = path.start + rand() * (path.length - span);
    walkers.push({ cx: d.x, cz: d.z, radius, from, span, leg: (span * radius) / (PACE * (0.8 + rand() * 0.4)), phase: rand(), coat: coat(), height: height() });
  }

  // A knot of neighbours by the well (on its plaza side) and by the fountain (at its two flanks:
  // the lanes run close past its plaza and outer sides). Angles are relative to "toward the plaza".
  const chatters: Chatter[] = [];
  const gather = (at: Point, ring: number, angles: number[]) => {
    const toward = Math.atan2(d.z - at.z, d.x - at.x);
    for (const off of angles) {
      const a = toward + off + (rand() - 0.5) * 0.2;
      const p = { x: at.x + Math.cos(a) * ring, z: at.z + Math.sin(a) * ring };
      chatters.push({ ...p, rot: Math.atan2(at.x - p.x, at.z - p.z), coat: coat(), height: height(), phase: rand() * 10 });
    }
  };
  if (s.features.well) gather(s.features.well, WELL_CLEAR + 0.35, level >= 3 ? [-0.95, 0, 0.95] : [-0.5, 0.5]);
  if (s.features.fountain) gather(s.features.fountain, FOUNTAIN_CLEAR + 0.3, level >= 5 ? [-1.85, -1.3, 1.35, 1.9] : [-1.6, 1.3, 1.85]);

  // Each house draws its own numbers, so a house keeps its smoke and its lit windows as the town
  // grows around it (a busier town only lights more of them).
  const houseRand = (i: number) => rng(seedOf(d.squad.id) + 7919 * (i + 1));

  // Smoke from about half the chimneys, and always from the first house that has one.
  const smoke: Smoke[] = [];
  const first = s.houses.findIndex((h) => CHIMNEYS[h.house]);
  s.houses.forEach((h, i) => {
    const c = CHIMNEYS[h.house];
    const r = houseRand(i);
    const lit = r() < 0.55 || i === first;
    const phase = r() * 10;
    if (c && lit) smoke.push({ ...toWorld(h, c.x, c.z), y: c.y, phase, house: i });
  });

  // Lamps in some windows: more of them as the town grows busier.
  const windows: LitWindow[] = [];
  const share = 0.3 + Math.min(level, 6) * 0.06;
  s.houses.forEach((h, i) => {
    const r = houseRand(i);
    r(); // skip the two smoke draws
    r();
    for (const pane of windowPanes(h.house)) {
      const lit = r() < share;
      const warmth = r();
      if (lit) windows.push({ ...toWorld(h, pane.x, PANE_Z), y: pane.y, rot: h.rot, ...PANE, warmth, house: i });
    }
  });

  return { walkers, chatters, smoke, windows };
}

/** Where a walker is at time `t` (seconds). Writes into `out` so the render loop allocates nothing. */
export function walkerAt(w: Walker, t: number, out: { x: number; z: number; heading: number; stride: number }) {
  // A round trip is two legs; ease each leg (cosine) so they slow, turn and set off again.
  const u = (t / (2 * w.leg) + w.phase) % 1;
  const back = u >= 0.5;
  const leg = back ? (u - 0.5) * 2 : u * 2;
  const s = 0.5 - 0.5 * Math.cos(Math.PI * leg);
  const a = w.from + w.span * (back ? 1 - s : s);
  out.x = w.cx + Math.cos(a) * w.radius;
  out.z = w.cz + Math.sin(a) * w.radius;
  // tangent of the arc, in the walking direction; heading is a rotation about y for local +z
  const dir = back ? -1 : 1;
  out.heading = Math.atan2(-Math.sin(a) * dir, Math.cos(a) * dir);
  // how fast they are going (0 at the turns, 1 mid-leg), for the bob
  out.stride = Math.sin(Math.PI * leg);
  return out;
}
