import type { TeamRole } from '../store.ts';

/**
 * Skyscrapers from Models/buildings.blend, converted by tools/export_buildings.py into
 * public/models/buildings.glb. Every model is normalised to unit height, base at the origin, with
 * three materials: body, glass, trim. Width/depth are in those unit-height coordinates.
 */
export const MODEL_URL = `${import.meta.env.BASE_URL}models/buildings.glb`;

const CATALOG = {
  bldg_00: { w: 4.1167, d: 3.976, look: 'low-rise with gold louvres' },
  bldg_01: { w: 0.4222, d: 0.4153, look: 'tower with a spiked crown' },
  bldg_02: { w: 0.2776, d: 0.2847, look: 'slab with a trimmed spine' },
  bldg_03: { w: 0.3386, d: 0.3072, look: 'tower with a winged crown' },
  bldg_04: { w: 0.139, d: 0.1506, look: 'slender residential tower' },
  bldg_05: { w: 0.2154, d: 0.2154, look: 'round tower with a stepped spire' },
  bldg_06: { w: 0.5787, d: 0.5776, look: 'drum tower with an open crown' },
  bldg_07: { w: 0.5052, d: 0.5052, look: 'triple towers with masts' },
  bldg_08: { w: 0.2348, d: 0.0967, look: 'twin cylinders' },
  bldg_09: { w: 0.722, d: 0.1934, look: 'wide curved slab' },
} as const;

export type ModelName = keyof typeof CATALOG;

/** Which building each kind of role occupies, its target height, and the widest it may get. */
const BY_KIND: Record<string, { model: ModelName; height: number; maxWidth: number }> = {
  master: { model: 'bldg_07', height: 34, maxWidth: 16 },
  architect: { model: 'bldg_05', height: 30, maxWidth: 9 },
  qa_head: { model: 'bldg_01', height: 28, maxWidth: 9 },
  lead: { model: 'bldg_03', height: 22, maxWidth: 9 },
  dev: { model: 'bldg_02', height: 18, maxWidth: 9 },
  qa: { model: 'bldg_06', height: 15, maxWidth: 9 },
  analyst: { model: 'bldg_09', height: 16, maxWidth: 10 },
  product: { model: 'bldg_04', height: 20, maxWidth: 9 },
  design: { model: 'bldg_08', height: 18, maxWidth: 9 },
};

export interface Archetype {
  model: ModelName;
  look: string;
  /** Uniform scale applied to the unit-height model. */
  scale: number;
  /** Roofline (trails and circle links anchor here) — the model's full height. */
  height: number;
  /** Highest point (beacon + label). */
  top: number;
  width: number;
  depth: number;
  footprint: number;
}

export function archetypeFor(role: TeamRole): Archetype {
  const spec = BY_KIND[role.kind] ?? BY_KIND.dev!;
  const m = CATALOG[spec.model];
  const scale = Math.min(spec.height, spec.maxWidth / Math.max(m.w, m.d));
  return {
    model: spec.model,
    look: m.look,
    scale,
    height: scale * 0.8,
    top: scale,
    width: m.w * scale,
    depth: m.d * scale,
    footprint: Math.max(m.w, m.d) * scale,
  };
}
