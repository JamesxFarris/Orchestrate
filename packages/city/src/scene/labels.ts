import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Screen-space label management, the way city builders do it: every floating label registers its
 * anchor, size and importance; each frame the manager hides labels whose tower is blocked by another
 * building, then lets more important labels win when two overlap on screen.
 */

export type LabelLod = 'far' | 'mid' | 'near';

export interface LabelEntry {
  id: string;
  anchor: THREE.Vector3;
  /** Higher wins overlaps. Focused labels are never hidden. */
  priority: number;
  focus: boolean;
  w: number;
  h: number;
  /** Written by the manager. */
  visible: boolean;
  distance: number;
}

const entries = new Map<string, LabelEntry>();
/** Invisible per-building hit-boxes, used for occlusion tests. */
const blockers = new Map<string, THREE.Object3D>();

export function registerLabel(e: Omit<LabelEntry, 'visible' | 'distance'>): LabelEntry {
  const entry = { ...e, visible: true, distance: 0 };
  entries.set(e.id, entry);
  return entry;
}
export const unregisterLabel = (id: string) => entries.delete(id);
export const registerBlocker = (id: string, o: THREE.Object3D) => blockers.set(id, o);
export const unregisterBlocker = (id: string) => blockers.delete(id);

/** Camera distance thresholds for the three levels of detail. */
export function lodFor(distance: number): LabelLod {
  return distance < 105 ? 'near' : distance < 235 ? 'mid' : 'far';
}

const ray = new THREE.Raycaster();
const dir = new THREE.Vector3();
const ndc = new THREE.Vector3();

export function LabelManager() {
  useFrame(({ camera, size }) => {
    const list = [...entries.values()];
    const objects = [...blockers.entries()];

    for (const e of list) {
      e.distance = camera.position.distanceTo(e.anchor);
      // occlusion: is another building between the camera and this label's anchor?
      dir.subVectors(e.anchor, camera.position).normalize();
      ray.set(camera.position, dir);
      ray.far = e.distance - 1;
      const others = objects.filter(([id]) => id !== e.id).map(([, o]) => o);
      e.visible = e.focus || ray.intersectObjects(others, false).length === 0;
    }

    // declutter: greedy by priority (nearer first on ties)
    const placed: [number, number, number, number][] = [];
    const ordered = list.filter((e) => e.visible).sort((a, b) => b.priority - a.priority || a.distance - b.distance);
    for (const e of ordered) {
      ndc.copy(e.anchor).project(camera);
      if (ndc.z > 1) {
        e.visible = false;
        continue;
      }
      const x = (ndc.x * 0.5 + 0.5) * size.width;
      const y = (-ndc.y * 0.5 + 0.5) * size.height;
      const r: [number, number, number, number] = [x - e.w / 2 - 3, y - e.h - 3, x + e.w / 2 + 3, y + 3];
      const hit = placed.some((p) => r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1]);
      if (hit && !e.focus) e.visible = false;
      else placed.push(r);
    }
  });
  return null;
}
