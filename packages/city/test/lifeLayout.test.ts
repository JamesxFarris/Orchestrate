import { describe, expect, it } from 'vitest';
import type { District } from '../src/layout.ts';
import { CHIMNEYS, FOUNTAIN_CLEAR, layoutLife, walkerAt, walkerCount, WELL_CLEAR, windowPanes } from '../src/scene/settlement/lifeLayout.ts';
import { HOUSES, layoutSettlement } from '../src/scene/settlement/settlementLayout.ts';

const district = (angle: number, size = 20.25, radius = 64): District => ({
  squad: { id: 'render', name: 'Render & UI', color: '#f2a541', mission: '' },
  angle,
  x: Math.cos(angle) * radius,
  z: Math.sin(angle) * radius,
  size,
});

const d = district(-Math.PI / 4);
const lifeAt = (level: number, at = d) => layoutLife(at, layoutSettlement(at, level), level);
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
/** Times across a few minutes, so every walker is seen at both ends of its beat and in between. */
const TIMES = Array.from({ length: 160 }, (_, i) => i * 1.37);

describe('layoutLife: who lives in town', () => {
  it('is deterministic', () => {
    expect(lifeAt(5)).toEqual(lifeAt(5));
  });

  it('gets busier as the settlement grows: a hamlet has a couple of people, a city a crowd', () => {
    const people = [1, 2, 3, 4, 5, 6].map((level) => {
      const l = lifeAt(level);
      return l.walkers.length + l.chatters.length;
    });
    expect(people[0]).toBeLessThanOrEqual(2);
    for (let i = 1; i < people.length; i++) expect(people[i]).toBeGreaterThan(people[i - 1]!);
    expect(people[4]).toBeGreaterThanOrEqual(18);
    expect(walkerCount(40)).toBe(19);
  });

  it('only gathers people at the well and fountain once they are built', () => {
    expect(lifeAt(1).chatters).toEqual([]);
    expect(lifeAt(2).chatters.length).toBe(2);
    const borough = lifeAt(4);
    const { fountain } = layoutSettlement(d, 4).features;
    expect(borough.chatters.filter((c) => dist(c, fountain!) < FOUNTAIN_CLEAR + 1).length).toBe(3);
  });
});

describe('walkers: strolling the lanes', () => {
  for (const level of [1, 2, 3, 5, 8]) {
    it(`stay on a lane or the front footpath, clear of the lamps, well and fountain (level ${level})`, () => {
      const s = layoutSettlement(d, level);
      const life = layoutLife(d, s, level);
      const radii = [...s.features.lanes.map((l) => l.radius), Math.hypot(s.houses[0]!.x - d.x, s.houses[0]!.z - d.z) - 2.8];
      const at = { x: 0, z: 0, heading: 0, stride: 0 };
      for (const w of life.walkers) {
        // on a lane's cobbled band (half-width 1.1), or on the grass path in front of the first row
        const lane = s.features.lanes.find((l) => Math.abs(w.radius - l.radius) < 0.6);
        if (lane) {
          expect(w.from).toBeGreaterThanOrEqual(lane.start - 1e-9);
          expect(w.from + w.span).toBeLessThanOrEqual(lane.start + lane.length + 1e-9);
        } else expect(Math.abs(w.radius - radii[radii.length - 1]!)).toBeLessThan(0.8);
        for (const t of TIMES) {
          walkerAt(w, t, at);
          const r = Math.hypot(at.x - d.x, at.z - d.z);
          expect(Math.abs(r - w.radius)).toBeLessThan(1e-9);
          if (s.features.well) expect(dist(at, s.features.well)).toBeGreaterThan(WELL_CLEAR + 0.3);
          if (s.features.fountain) expect(dist(at, s.features.fountain)).toBeGreaterThan(FOUNTAIN_CLEAR);
          for (const lamp of s.features.lamps) expect(dist(at, lamp)).toBeGreaterThan(0.25);
          for (const h of s.houses) expect(dist(at, h)).toBeGreaterThan(1.9);
        }
      }
    });
  }

  it('walk back and forth: they reach both ends of their stretch and face the way they go', () => {
    const w = lifeAt(5).walkers[0]!;
    const at = { x: 0, z: 0, heading: 0, stride: 0 };
    const angles = Array.from({ length: 400 }, (_, i) => {
      walkerAt(w, (i / 400) * 2 * w.leg, at);
      return Math.atan2(at.z - w.cz, at.x - w.cx);
    });
    const unwrap = (a: number) => w.from + Math.atan2(Math.sin(a - w.from), Math.cos(a - w.from));
    const swept = angles.map(unwrap);
    expect(Math.min(...swept)).toBeCloseTo(w.from, 2);
    expect(Math.max(...swept)).toBeCloseTo(w.from + w.span, 2);
    // heading points along the step just taken
    const a = walkerAt(w, w.leg * 0.3, { x: 0, z: 0, heading: 0, stride: 0 });
    const b = walkerAt(w, w.leg * 0.3 + 0.1, { x: 0, z: 0, heading: 0, stride: 0 });
    const step = { x: b.x - a.x, z: b.z - a.z };
    expect(Math.sin(a.heading) * step.x + Math.cos(a.heading) * step.z).toBeGreaterThan(0);
  });
});

describe('chimney smoke and lit windows', () => {
  it('smokes only from houses that have a chimney, from its top, and always from at least one', () => {
    const s = layoutSettlement(d, 5);
    const life = layoutLife(d, s, 5);
    expect(life.smoke.length).toBeGreaterThan(0);
    for (const c of life.smoke) {
      const h = s.houses[c.house]!;
      expect(CHIMNEYS[h.house]).toBeDefined();
      expect(c.y).toBe(CHIMNEYS[h.house]!.y);
      expect(dist(c, h)).toBeLessThan(Math.hypot(HOUSES[h.house].width, HOUSES[h.house].depth) / 2);
    }
  });

  it('keeps a house its smoke and lit windows as the town grows around it', () => {
    const town = lifeAt(3);
    const city = lifeAt(5);
    for (const c of town.smoke) expect(city.smoke).toContainEqual(c);
    const key = (w: { house: number; x: number; y: number }) => `${w.house}:${w.x.toFixed(4)}:${w.y}`;
    const cityPanes = new Set(city.windows.map(key));
    for (const w of town.windows) expect(cityPanes.has(key(w))).toBe(true);
  });

  it('lights windows on the front of the house, facing the plaza, never the door', () => {
    const s = layoutSettlement(d, 5);
    const life = layoutLife(d, s, 5);
    expect(life.windows.length).toBeGreaterThan(s.houses.length / 2);
    for (const w of life.windows) {
      const h = s.houses[w.house]!;
      // the pane sits on the side of the house nearer the district centre
      expect(dist(w, d)).toBeLessThan(dist(h, d));
      expect(w.rot).toBe(h.rot);
    }
    expect(windowPanes('cottage')).toEqual([{ x: 0.7, y: 0.7 }]);
    expect(windowPanes('hall')).toHaveLength(5);
  });
});
