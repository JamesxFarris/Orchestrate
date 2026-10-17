import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import type { District } from '../../layout.ts';
import { REDUCED_MOTION } from '../../motion.ts';
import { COATS, layoutLife, walkerAt, type Chatter, type Walker } from './lifeLayout.ts';
import type { Settlement } from './settlementLayout.ts';

/**
 * The settlements' ambient life: villagers strolling the lanes and chatting by the well and
 * fountain, smoke rising from chimneys, warm light in some windows. Everything is instanced (one
 * draw per kind, for all districts) and moved by a single useFrame. With reduced motion the
 * villagers stand still and the smoke hangs as a still plume.
 */

/** Puffs per chimney, and how long one takes to rise and fade (seconds). */
const PUFFS = 6;
const PUFF_LIFE = 7;
/** Which way the breeze carries the smoke (world x, z per unit of rise). */
const WIND = { x: 0.85, z: 0.5 };

const SKIN = ['#e8c4a0', '#d6a77e', '#b07f5a', '#8a5f42', '#f0d2b4'];

// Figures are about door height: a tapered coat and a round head. Origins at the feet.
const bodyGeometry = new THREE.CylinderGeometry(0.13, 0.23, 0.68, 7).translate(0, 0.34, 0);
const headGeometry = new THREE.IcosahedronGeometry(0.15, 1).translate(0, 0.84, 0);
const puffGeometry = new THREE.IcosahedronGeometry(1, 0);
const paneGeometry = new THREE.PlaneGeometry(1, 1);

const clothMaterial = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
const skinMaterial = new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true });
const smokeMaterial = new THREE.MeshStandardMaterial({ color: '#ece8e1', roughness: 1, flatShading: true, transparent: true, opacity: 0.5, depthWrite: false });
// Bright enough (and not tone-mapped) that the bloom pass gives the panes a soft halo.
const paneMaterial = new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

export interface LifeSite extends Settlement {
  district: District;
  level: number;
}

type Figure = { kind: 'walker'; w: Walker } | { kind: 'chatter'; c: Chatter };

export function Life({ sites, rising }: { sites: LifeSite[]; rising: RefObject<Map<string, number>> }) {
  const lives = useMemo(
    () =>
      sites.map((s) => {
        const life = layoutLife(s.district, s, s.level);
        const key = (i: number) => `${s.district.squad.id}:${i}`;
        return { ...life, squad: s.district.squad, key };
      }),
    [sites],
  );
  const figures = useMemo(
    () =>
      lives.flatMap((l) => [
        ...l.walkers.map((w) => ({ fig: { kind: 'walker', w } as Figure, coat: w.coat, height: w.height, squad: l.squad.color })),
        ...l.chatters.map((c) => ({ fig: { kind: 'chatter', c } as Figure, coat: c.coat, height: c.height, squad: l.squad.color })),
      ]),
    [lives],
  );
  const smoke = useMemo(() => lives.flatMap((l) => l.smoke.map((s) => ({ ...s, key: l.key(s.house) }))), [lives]);
  const windows = useMemo(() => lives.flatMap((l) => l.windows.map((w) => ({ ...w, key: l.key(w.house) }))), [lives]);

  const bodies = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const puffs = useRef<THREE.InstancedMesh>(null);
  const panes = useRef<THREE.InstancedMesh>(null);

  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const s = useMemo(() => new THREE.Vector3(), []);
  const e = useMemo(() => new THREE.Euler(), []);
  const at = useMemo(() => ({ x: 0, z: 0, heading: 0, stride: 0 }), []);

  /** Panes and puffs of houses still rising out of the ground stay hidden until they stand. */
  const hidden = (key: string) => rising.current?.has(key) ?? false;
  const wasRising = useRef(false);
  const dirty = useRef(true);

  const placePanes = () => {
    const mesh = panes.current;
    if (!mesh) return;
    windows.forEach((w, i) => {
      m.compose(p.set(w.x, w.y, w.z), q.setFromEuler(e.set(0, w.rot, 0)), hidden(w.key) ? s.setScalar(0) : s.set(w.width, w.height, 1));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };

  // Colours and the window panes are fixed for a layout; set them once.
  useLayoutEffect(() => {
    const c = new THREE.Color();
    const muted = new THREE.Color('#8a8580');
    figures.forEach((f, i) => {
      bodies.current?.setColorAt(i, f.coat < 0 ? c.set(f.squad).lerp(muted, 0.25) : c.set(COATS[f.coat]!));
      heads.current?.setColorAt(i, c.set(SKIN[i % SKIN.length]!));
    });
    const warm = new THREE.Color('#ffc46b');
    const amber = new THREE.Color('#ff9f45');
    windows.forEach((w, i) => panes.current?.setColorAt(i, c.copy(warm).lerp(amber, w.warmth).multiplyScalar(1.15 + w.warmth * 0.35)));
    for (const mesh of [bodies.current, heads.current, panes.current]) if (mesh?.instanceColor) mesh.instanceColor.needsUpdate = true;
    placePanes();
    dirty.current = true;
  }, [figures, windows, smoke]);

  useFrame((state) => {
    const anyRising = (rising.current?.size ?? 0) > 0;
    if (anyRising || wasRising.current) placePanes();
    const settle = wasRising.current && !anyRising;
    wasRising.current = anyRising;
    // with reduced motion nothing moves: draw once (and again when houses finish rising)
    if (REDUCED_MOTION && !dirty.current && !anyRising && !settle) return;
    dirty.current = false;
    const t = REDUCED_MOTION ? 0 : state.clock.elapsedTime;

    const body = bodies.current;
    const head = heads.current;
    if (body && head) {
      figures.forEach(({ fig, height }, i) => {
        let y = 0;
        let rot: number;
        let lean = 0;
        if (fig.kind === 'walker') {
          walkerAt(fig.w, t, at);
          p.set(at.x, 0, at.z);
          // a small step bob and a slight forward lean, both fading as they slow to turn
          y = Math.abs(Math.sin(t * 6.5 + fig.w.phase * 20)) * 0.045 * at.stride;
          lean = 0.06 * at.stride;
          rot = at.heading;
        } else {
          p.set(fig.c.x, 0, fig.c.z);
          // chatting: a slow look from side to side
          rot = fig.c.rot + Math.sin(t * 0.7 + fig.c.phase) * 0.35;
          lean = Math.sin(t * 1.3 + fig.c.phase * 2) * 0.025;
        }
        p.y = y;
        m.compose(p, q.setFromEuler(e.set(lean, rot, 0, 'YXZ')), s.set(1, height, 1));
        body.setMatrixAt(i, m);
        head.setMatrixAt(i, m);
      });
      body.instanceMatrix.needsUpdate = true;
      head.instanceMatrix.needsUpdate = true;
    }

    const puff = puffs.current;
    if (puff) {
      smoke.forEach((c, ci) => {
        const gone = hidden(c.key);
        for (let k = 0; k < PUFFS; k++) {
          // each puff rises, swells and bends downwind, wobbling a little, then thins away; a new
          // one takes its place at the chimney
          const u = ((t + c.phase) / PUFF_LIFE + k / PUFFS) % 1;
          const rise = 0.15 + u * 2.4;
          const drift = u * u * 1.6;
          const wobble = Math.sin(u * 7 + k * 2.1 + c.phase) * 0.12 * u;
          const swell = 0.85 + ((k * 0.37 + c.phase) % 1) * 0.35;
          const size = gone ? 0 : (0.12 + u * 0.55) * swell * (u < 0.7 ? Math.min(1, u * 8) : (1 - u) / 0.3);
          p.set(c.x + WIND.x * drift + wobble * WIND.z, c.y + rise, c.z + WIND.z * drift - wobble * WIND.x);
          m.compose(p, q.setFromEuler(e.set(u * 2 + k, k * 1.3, 0)), s.set(size, size * 0.8, size));
          puff.setMatrixAt(ci * PUFFS + k, m);
        }
      });
      puff.instanceMatrix.needsUpdate = true;
    }
  });

  // These move across the whole town, so a bounding sphere would be stale: skip culling (four cheap draws).
  const noPick = () => null;
  return (
    <group>
      {figures.length > 0 && (
        <>
          <instancedMesh key={`b${figures.length}`} ref={bodies} args={[bodyGeometry, clothMaterial, figures.length]} receiveShadow raycast={noPick} frustumCulled={false} />
          <instancedMesh key={`h${figures.length}`} ref={heads} args={[headGeometry, skinMaterial, figures.length]} raycast={noPick} frustumCulled={false} />
        </>
      )}
      {smoke.length > 0 && <instancedMesh key={`s${smoke.length}`} ref={puffs} args={[puffGeometry, smokeMaterial, smoke.length * PUFFS]} raycast={noPick} frustumCulled={false} />}
      {windows.length > 0 && <instancedMesh key={`w${windows.length}`} ref={panes} args={[paneGeometry, paneMaterial, windows.length]} raycast={noPick} frustumCulled={false} />}
    </group>
  );
}
