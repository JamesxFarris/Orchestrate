import { PALETTE } from '../palette.ts';
import type { TeamRole } from '../store.ts';

export interface Segment {
  shape: 'box' | 'cylinder';
  /** Width (x) / diameter for cylinders. */
  w: number;
  /** Depth (z); ignored for cylinders. */
  d: number;
  h: number;
  /** Base height above ground. */
  y: number;
  sides?: number;
  body?: string;
  floorH?: number;
  colW?: number;
}

export type Extra =
  | { kind: 'spire'; y: number; h: number }
  | { kind: 'antenna'; y: number; h: number }
  | { kind: 'helipad'; y: number; r: number }
  | { kind: 'dome'; y: number; r: number }
  | { kind: 'crown'; y: number; r: number }
  | { kind: 'hvac'; y: number; w: number; d: number }
  | { kind: 'garden'; y: number; w: number; d: number };

export interface Archetype {
  name: string;
  segments: Segment[];
  extras: Extra[];
  /** Roof height of the tallest segment (cards, trails and circle links anchor here). */
  height: number;
  /** Highest point including spires/antennas (beacon goes here). */
  top: number;
  footprint: number;
}

function stack(name: string, parts: Omit<Segment, 'y'>[], extras: (roof: number) => Extra[], topExtra = 0): Archetype {
  let y = 0;
  const segments = parts.map((p) => {
    const s = { ...p, y };
    y += p.h;
    return s;
  });
  return {
    name,
    segments,
    extras: extras(y),
    height: y,
    top: y + topExtra,
    footprint: Math.max(...parts.map((p) => Math.max(p.w, p.shape === 'box' ? p.d : p.w))),
  };
}

/** Each role gets its own silhouette so the org chart reads from across the city. */
export function archetypeFor(role: TeamRole): Archetype {
  switch (role.kind) {
    case 'master':
      return stack(
        'HQ spire',
        [
          { shape: 'box', w: 7.4, d: 7.4, h: 13, body: PALETTE.payne },
          { shape: 'box', w: 5.8, d: 5.8, h: 11, body: PALETTE.payne },
          { shape: 'box', w: 4.2, d: 4.2, h: 9, body: PALETTE.payne },
        ],
        (roof) => [{ kind: 'spire', y: roof, h: 8 }],
        8,
      );
    case 'architect':
      return stack(
        'glass rotunda tower',
        [{ shape: 'cylinder', w: 5, d: 5, h: 24, sides: 40, body: '#53646f', colW: 0.8 }],
        (roof) => [
          { kind: 'crown', y: roof, r: 2.5 },
          { kind: 'antenna', y: roof, h: 4.5 },
        ],
        4.5,
      );
    case 'qa_head':
      return stack(
        'hex tower',
        [
          { shape: 'cylinder', w: 5.6, d: 5.6, h: 8, sides: 6, body: PALETTE.onyx, colW: 0.9 },
          { shape: 'cylinder', w: 4.6, d: 4.6, h: 12, sides: 6, body: PALETTE.onyx, colW: 0.9 },
        ],
        (roof) => [{ kind: 'dome', y: roof, r: 1.7 }],
        1.7,
      );
    case 'lead':
      return stack(
        'setback tower',
        [
          { shape: 'box', w: 5.6, d: 5.6, h: 10, body: PALETTE.payne },
          { shape: 'box', w: 4.2, d: 4.2, h: 7 },
        ],
        (roof) => [
          { kind: 'garden', y: 10, w: 5.6, d: 5.6 },
          { kind: 'helipad', y: roof, r: 1.9 },
        ],
        0.4,
      );
    case 'dev':
      return stack(
        'office slab',
        [{ shape: 'box', w: 6.6, d: 3.8, h: 13, colW: 0.66 }],
        (roof) => [{ kind: 'hvac', y: roof, w: 6.6, d: 3.8 }],
        1.2,
      );
    case 'qa':
      return stack(
        'test lab',
        [
          { shape: 'box', w: 6.4, d: 5.2, h: 5.5, body: '#55606a', floorH: 1.3, colW: 1.1 },
          { shape: 'box', w: 3.8, d: 3.8, h: 3.5, body: '#55606a', floorH: 1.3, colW: 1.1 },
        ],
        (roof) => [{ kind: 'dome', y: roof, r: 1.9 }],
        1.9,
      );
    case 'analyst':
      return stack(
        'archive rotunda',
        [{ shape: 'cylinder', w: 6, d: 6, h: 8, sides: 28, body: '#5b5f63', floorH: 1.4, colW: 1.2 }],
        (roof) => [{ kind: 'dome', y: roof, r: 3 }],
        3,
      );
    default:
      return stack(
        'studio',
        [{ shape: 'box', w: 5, d: 5, h: 9 }],
        (roof) => [{ kind: 'garden', y: roof, w: 5, d: 5 }],
        0.6,
      );
  }
}
