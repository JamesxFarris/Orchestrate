import { describe, expect, it } from 'vitest';
import { districtPlazaRadius, type District } from '../src/layout.ts';
import { layoutMarket, marketProps, PROPS, settlementTier, type MarketProp } from '../src/scene/settlement/marketLayout.ts';
import { HOUSES, layoutSettlement } from '../src/scene/settlement/settlementLayout.ts';

const district = (angle: number, size = 20.25, id = 'render', radius = 64): District => ({
  squad: { id, name: id, color: '#f2a541', mission: '' },
  angle,
  x: Math.cos(angle) * radius,
  z: Math.sin(angle) * radius,
  size,
});

const d = district(-Math.PI / 4);
/** A spread of districts: big and small, every direction, different squads (and so different seeds). */
const districts = [
  d,
  district(Math.PI / 4, 8.75, 'engine'),
  district(2.2, 14.5, 'gameplay'),
  district(-2.6, 11, 'qa'),
  district(Math.PI, 26, 'platform'),
];
const marketAt = (dd: District, level: number) => layoutMarket(dd, layoutSettlement(dd, level));
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

type Pt = { x: number; z: number };
/** Footprint corners, turned by rot about y (written out here rather than borrowed, so the check is independent). */
const cornersOf = (x: number, z: number, rot: number, hw: number, hd: number): Pt[] => {
  const [c, s] = [Math.cos(rot), Math.sin(rot)];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({ x: x + a! * hw * c + b! * hd * s, z: z - a! * hw * s + b! * hd * c }));
};
const propCorners = (p: MarketProp) => cornersOf(p.x, p.z, p.rot, PROPS[p.kind].hw, PROPS[p.kind].hd);
// separating-axis test for two rectangles
const overlap = (p: Pt[], q: Pt[]) =>
  [p, q].every((poly) =>
    poly.every((a, i) => {
      const b = poly[(i + 1) % 4]!;
      const axis = { x: -(b.z - a.z), z: b.x - a.x };
      const proj = (pts: Pt[]) => pts.map((v) => v.x * axis.x + v.z * axis.z);
      return Math.max(...proj(p)) > Math.min(...proj(q)) && Math.max(...proj(q)) > Math.min(...proj(p));
    }),
  );
/** Closest distance from a point to a convex quad (0 inside). */
const pointToQuad = (p: Pt, q: Pt[]) => {
  const inside = q.every((a, i) => {
    const b = q[(i + 1) % 4]!;
    return (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x) <= 0;
  }) || q.every((a, i) => {
    const b = q[(i + 1) % 4]!;
    return (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x) >= 0;
  });
  if (inside) return 0;
  return Math.min(
    ...q.map((a, i) => {
      const b = q[(i + 1) % 4]!;
      const [dx, dz] = [b.x - a.x, b.z - a.z];
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
    }),
  );
};

describe('marketProps: where the public spaces go', () => {
  it('is deterministic, so a stall never moves between visits', () => {
    for (const dd of districts) expect(marketProps(dd)).toEqual(marketProps(dd));
  });

  it('differs between squads, so every market is its own', () => {
    const a = marketProps(district(0.3, 20.25, 'alpha')).props;
    const b = marketProps(district(0.3, 20.25, 'bravo')).props;
    expect(a).not.toEqual(b);
  });

  it('only adds props as a district grows: each level keeps every earlier prop in place', () => {
    for (const dd of districts) {
      let before: MarketProp[] = [];
      for (let level = 1; level <= 8; level++) {
        const now = marketAt(dd, level).props;
        for (const p of before) expect(now).toContainEqual(p);
        expect(now.length).toBeGreaterThanOrEqual(before.length);
        before = now;
      }
    }
  });

  it('unlocks: a cart by the well, then a stall, bench and notice board, then the square, then bunting and a full market', () => {
    const kinds = (level: number) => new Set(marketAt(d, level).props.map((p) => p.kind));
    const stalls = (level: number) => marketAt(d, level).props.filter((p) => p.kind.startsWith('stall') || p.kind === 'canopy').length;
    expect(marketAt(d, 1)).toEqual({ props: [], square: undefined, bunting: [] });
    expect(kinds(2).has('cart')).toBe(true);
    expect(kinds(2).has('crate')).toBe(true);
    expect(stalls(2)).toBe(0);
    expect(stalls(3)).toBe(1);
    for (const k of ['bench', 'noticeboard', 'signpost'] as const) expect(kinds(3).has(k)).toBe(true);
    expect(marketAt(d, 3).square).toBeUndefined();
    expect(marketAt(d, 4).square).toBeDefined();
    expect(kinds(4).has('canopy')).toBe(true);
    expect(stalls(4)).toBeGreaterThan(stalls(3));
    expect(marketAt(d, 4).bunting).toEqual([]);
    expect(kinds(4).has('planter')).toBe(false);
    expect(marketAt(d, 5).bunting.length).toBeGreaterThan(0);
    expect(kinds(5).has('planter')).toBe(true);
    expect(kinds(5).has('mast')).toBe(true);
    expect(stalls(5)).toBeGreaterThan(stalls(4));
  });

  it('gives even a small district a stall, a cart, a bench and bunting', () => {
    for (const dd of districts) {
      const city = marketAt(dd, 5);
      expect(city.props.some((p) => p.kind.startsWith('stall'))).toBe(true);
      for (const k of ['cart', 'bench', 'noticeboard'] as const) expect(city.props.some((p) => p.kind === k)).toBe(true);
      expect(city.bunting.length).toBeGreaterThan(0);
    }
  });

  it('reads the level off what the settlement has unlocked', () => {
    expect([1, 2, 3, 4, 5, 9].map((level) => settlementTier(layoutSettlement(d, level)))).toEqual([1, 2, 3, 4, 5, 5]);
  });
});

describe('marketProps: never in the way', () => {
  it("keeps clear of every house's footprint, even houses not built yet", () => {
    for (const dd of districts) {
      const houses = layoutSettlement(dd, 99).houses.map((h) => cornersOf(h.x, h.z, h.rot, HOUSES[h.house].width / 2, HOUSES[h.house].depth / 2));
      for (const p of marketProps(dd).props) for (const h of houses) expect(overlap(propCorners(p), h)).toBe(false);
    }
  });

  it('keeps off the lanes, the lamp posts, and the well and fountain with the people round them', () => {
    for (const dd of districts) {
      const { features } = layoutSettlement(dd, 99);
      for (const p of marketProps(dd).props) {
        const quad = propCorners(p);
        for (const lane of features.lanes)
          for (const c of quad) {
            const a = Math.atan2(c.z - dd.z, c.x - dd.x) - lane.start;
            const along = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
            if (along <= lane.length) expect(Math.abs(dist(c, dd) - lane.radius)).toBeGreaterThan(1.1);
          }
        // clear of the well and fountain, and of the villagers who gather round them (~1.6 and ~2.6 out)
        expect(pointToQuad(features.well!, quad)).toBeGreaterThan(1.95);
        expect(pointToQuad(features.fountain!, quad)).toBeGreaterThan(2.95);
        for (const lamp of features.lamps) expect(pointToQuad(lamp, quad)).toBeGreaterThan(0.2);
      }
    }
  });

  it('keeps props apart, except a crate stacked on another', () => {
    for (const dd of districts) {
      const ground = marketProps(dd).props.filter((p) => p.y === 0);
      for (const [i, p] of ground.entries()) for (const q of ground.slice(i + 1)) expect(overlap(propCorners(p), propCorners(q))).toBe(false);
      for (const p of marketProps(dd).props.filter((p) => p.y > 0)) expect(ground.some((q) => q.kind === 'crate' && dist(p, q) < 0.01)).toBe(true);
    }
  });

  it("keeps to the market's own ground, leaving the rest to the yards' gardens and trees", () => {
    // the yards keep 3.5 from the well, 4.5 from the fountain, and 0.25 off each lane's edge
    for (const dd of districts) {
      const { features } = layoutSettlement(dd, 99);
      for (const p of marketProps(dd).props) {
        const quad = propCorners(p);
        const byWell = quad.every((c) => dist(c, features.well!) < 3.5);
        const byFountain = quad.every((c) => dist(c, features.fountain!) < 4.5);
        const onShoulder = quad.every((c) => features.lanes.some((l) => Math.abs(dist(c, dd) - l.radius) < 1.1 + 0.25));
        expect(byWell || byFountain || onShoulder).toBe(true);
      }
    }
  });

  it('stays off the plaza and inside the settlement', () => {
    for (const dd of districts) {
      const plaza = districtPlazaRadius(dd.size);
      for (const p of marketProps(dd).props) {
        expect(dist(p, dd)).toBeGreaterThan(plaza);
        expect(dist(p, dd)).toBeLessThan(plaza + 19);
      }
    }
  });
});

describe('the market square and bunting', () => {
  it('paves the fountain row between the lanes, short of the nearest house', () => {
    for (const dd of districts) {
      const { square } = marketProps(dd);
      const { houses, features } = layoutSettlement(dd, 99);
      const [inner, outer] = features.lanes;
      expect(square!.inner).toBeLessThan(inner!.radius + 1.1);
      expect(square!.outer).toBeGreaterThan(outer!.radius - 1.1);
      // the band's middle is clear of every house
      for (const h of houses) {
        const a = Math.atan2(h.z - dd.z, h.x - dd.x);
        const off = Math.atan2(Math.sin(a - square!.start), Math.cos(a - square!.start));
        if (Math.abs(dist(h, dd) - square!.radius) < 1) expect(off < -0.01 || off > square!.length + 0.01).toBe(true);
      }
    }
  });

  it('hangs pennants from lamp to lamp along the lanes, and mast to mast over the square, above head height', () => {
    for (const dd of districts) {
      const { bunting, props } = marketAt(dd, 5);
      const { features } = layoutSettlement(dd, 5);
      const posts = [...features.lamps, ...props.filter((p) => p.kind === 'mast')];
      const alongLanes = bunting.filter((b) => features.lamps.some((l) => dist(l, b.points[0]!) < 0.01));
      expect(alongLanes.length).toBe(6); // 4 lamps on each of the 2 lanes
      for (const b of bunting) {
        for (const end of [b.points[0]!, b.points.at(-1)!]) expect(posts.some((p) => dist(p, end) < 0.01)).toBe(true);
        for (const p of b.pennants) expect(p.y).toBeGreaterThan(1.65);
        expect(b.pennants.some((p) => p.accent)).toBe(true);
      }
      for (const b of alongLanes)
        for (const p of b.pennants) expect(features.lanes.some((lane) => Math.abs(dist(p, dd) - lane.radius) < 0.01)).toBe(true);
    }
    expect(marketAt(d, 5).bunting.length).toBeGreaterThan(6); // the square's ring too
  });
});
