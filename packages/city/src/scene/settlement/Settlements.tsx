import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { CityLayout } from '../../layout.ts';
import { PALETTE } from '../../palette.ts';
import { useCity } from '../../store.ts';
import { usePavingTexture } from '../Ground.tsx';
import { foliageMaterial } from '../park/treeKit.ts';
import { layoutSettlement, type HouseSpot, type Lane, type Point } from './settlementLayout.ts';

/**
 * Each district's settlement: houses (white walls, roofs in shades of the squad colour), and the
 * well, lanes, fountain and lamps its level has unlocked. Levels come from the daemon's progress.
 * When a district grows, the new houses rise out of the ground, after the Harvest screen closes so
 * the moment is not hidden behind it.
 */

const RISE_MS = 1100;
const STAGGER_MS = 140;
const ROOF_H = 1.25;

/** Unit gable roof: ridge along z, base on y = 0, 1 wide and 1 deep. */
const ROOF = (() => {
  const shape = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
  return new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
})();
const WALLS = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const wallMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, flatShading: true });
const stoneMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.stone, roughness: 0.9, flatShading: true });
const waterMaterial = new THREE.MeshStandardMaterial({ color: '#6fa7b0', roughness: 0.25, metalness: 0.1 });
const poleMaterial = new THREE.MeshStandardMaterial({ color: '#4a4136', roughness: 0.6 });
const lampMaterial = new THREE.MeshStandardMaterial({ color: '#ffd889', emissive: new THREE.Color('#ffc65a'), emissiveIntensity: 2.2, toneMapped: false });

interface Placed extends HouseSpot {
  key: string;
  color: string;
}

/** `?settle=5` shows every district at that level, to preview the city without shipping seven projects. */
const PREVIEW_LEVEL = (() => {
  const n = Number(new URLSearchParams(location.search).get('settle'));
  return Number.isInteger(n) && n >= 1 ? n : undefined;
})();

const prefersReducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

export function Settlements({ layout }: { layout: CityLayout }) {
  const progress = useCity((s) => s.progress);
  const harvestOpen = useCity((s) => !!s.harvest);
  const gl = useThree((s) => s.gl);

  const settlements = useMemo(() => {
    const level = new Map(progress?.districts.map((d) => [d.squad, d.settlement.level]));
    return layout.districts.map((d) => ({ district: d, ...layoutSettlement(d, PREVIEW_LEVEL ?? level.get(d.squad.id) ?? 1) }));
  }, [layout, progress]);

  const houses = useMemo<Placed[]>(
    () => settlements.flatMap(({ district, houses }) => houses.map((h, i) => ({ ...h, key: `${district.squad.id}:${i}`, color: district.squad.color }))),
    [settlements],
  );

  // Which houses are new, and when each starts rising. key -> start time; Infinity = waiting for
  // the Harvest screen to close.
  const seen = useRef<Set<string> | undefined>(undefined);
  const rising = useRef(new Map<string, number>());

  // start the queued rises once nothing covers the city
  useEffect(() => {
    if (harvestOpen) return;
    let k = 0;
    const now = performance.now();
    for (const [key, start] of rising.current) if (start === Infinity) rising.current.set(key, now + 250 + k++ * STAGGER_MS);
  }, [harvestOpen, houses]);

  const walls = useRef<THREE.InstancedMesh>(null);
  const roofs = useRef<THREE.InstancedMesh>(null);
  const roofMaterial = useMemo(() => foliageMaterial(), []);
  useEffect(() => () => roofMaterial.dispose(), [roofMaterial]);

  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const s = useMemo(() => new THREE.Vector3(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  /** Place house i, sunk by `sink` world units (0 = standing). */
  const place = (i: number, h: Placed, sink: number) => {
    q.setFromAxisAngle(up, h.rot);
    m.compose(p.set(h.x, -sink, h.z), q, s.set(h.width, h.height, h.depth));
    walls.current?.setMatrixAt(i, m);
    m.compose(p.set(h.x, h.height - sink, h.z), q, s.set(h.width * 1.16, ROOF_H, h.depth * 1.22));
    roofs.current?.setMatrixAt(i, m);
  };
  const depthOf = (h: Placed) => h.height + ROOF_H + 0.2;

  useLayoutEffect(() => {
    if (!seen.current) {
      seen.current = new Set(houses.map((h) => h.key)); // first load: the town is simply there
    } else {
      const fresh = houses.filter((h) => !seen.current!.has(h.key));
      for (const h of fresh) {
        seen.current.add(h.key);
        if (!prefersReducedMotion()) rising.current.set(h.key, Infinity);
      }
    }

    const c = new THREE.Color();
    const wall = new THREE.Color('#f6f1e6');
    const shadow = new THREE.Color('#5a3d2c');
    houses.forEach((h, i) => {
      place(i, h, rising.current.has(h.key) ? depthOf(h) : 0);
      walls.current?.setColorAt(i, c.copy(wall).lerp(new THREE.Color(PALETTE.limestone), h.shade * 0.6));
      roofs.current?.setColorAt(i, c.set(h.color).lerp(shadow, 0.12 + h.shade * 0.28));
    });
    for (const r of [walls, roofs]) {
      if (!r.current) continue;
      r.current.count = houses.length;
      r.current.instanceMatrix.needsUpdate = true;
      if (r.current.instanceColor) r.current.instanceColor.needsUpdate = true;
      r.current.computeBoundingSphere();
    }
    gl.shadowMap.needsUpdate = true;
  }, [houses, gl]);

  useFrame(() => {
    if (!rising.current.size) return;
    const now = performance.now();
    let moved = false;
    houses.forEach((h, i) => {
      const start = rising.current.get(h.key);
      if (start === undefined || now < start) return;
      const t = Math.min(1, (now - start) / RISE_MS);
      place(i, h, depthOf(h) * (1 - easeOut(t)));
      moved = true;
      if (t >= 1) rising.current.delete(h.key);
    });
    if (!moved) return;
    for (const r of [walls, roofs]) if (r.current) r.current.instanceMatrix.needsUpdate = true;
    if (!rising.current.size) gl.shadowMap.needsUpdate = true; // shadows are baked: re-bake once everything stands
  });

  // Room for growth in steps of 32, so a level-up rarely has to rebuild the instanced meshes.
  const capacity = Math.ceil((houses.length + 1) / 32) * 32;
  const noPick = () => null;
  return (
    <group>
      <instancedMesh ref={walls} args={[WALLS, wallMaterial, capacity]} castShadow receiveShadow raycast={noPick} />
      <instancedMesh ref={roofs} args={[ROOF, roofMaterial, capacity]} castShadow receiveShadow raycast={noPick} />
      {settlements.map(({ district, features }) => (
        <group key={district.squad.id}>
          {features.lanes.map((lane) => (
            <LaneArc key={lane.radius} x={district.x} z={district.z} lane={lane} />
          ))}
          {features.well && <Well at={features.well} />}
          {features.fountain && <Fountain at={features.fountain} />}
          {features.lamps.map((lamp, i) => (
            <Lamp key={i} at={lamp} />
          ))}
        </group>
      ))}
    </group>
  );
}

/** A cobbled lane curving between the rows of houses. */
function LaneArc({ x, z, lane }: { x: number; z: number; lane: Lane }) {
  const paving = usePavingTexture(14);
  // RingGeometry sweeps in its own XY plane; laid flat (rotate -90° about x), angle a maps to -a.
  return (
    <mesh position={[x, 0.075, z]} rotation-x={-Math.PI / 2} receiveShadow>
      <ringGeometry args={[lane.radius - 1.1, lane.radius + 1.1, 64, 1, -(lane.start + lane.length), lane.length]} />
      <meshStandardMaterial map={paving} roughness={0.9} polygonOffset polygonOffsetFactor={-3} polygonOffsetUnits={-3} />
    </mesh>
  );
}

function Well({ at }: { at: Point }) {
  return (
    <group position={[at.x, 0, at.z]}>
      <mesh position-y={0.35} material={stoneMaterial} castShadow>
        <cylinderGeometry args={[0.85, 0.95, 0.7, 10]} />
      </mesh>
      <mesh position-y={0.69} rotation-x={-Math.PI / 2} material={waterMaterial}>
        <circleGeometry args={[0.62, 10]} />
      </mesh>
      {[-0.7, 0.7].map((dx) => (
        <mesh key={dx} position={[dx, 1.15, 0]} material={poleMaterial} castShadow>
          <boxGeometry args={[0.12, 1.6, 0.12]} />
        </mesh>
      ))}
      <mesh position-y={2.05} rotation-y={Math.PI / 4} castShadow>
        <coneGeometry args={[1.2, 0.7, 4]} />
        <meshStandardMaterial color={PALETTE.brick} roughness={0.8} flatShading />
      </mesh>
    </group>
  );
}

function Fountain({ at }: { at: Point }) {
  return (
    <group position={[at.x, 0, at.z]}>
      <mesh position-y={0.25} material={stoneMaterial} castShadow receiveShadow>
        <cylinderGeometry args={[1.9, 2.05, 0.5, 16]} />
      </mesh>
      <mesh position-y={0.51} rotation-x={-Math.PI / 2} material={waterMaterial}>
        <circleGeometry args={[1.65, 16]} />
      </mesh>
      <mesh position-y={0.95} material={stoneMaterial} castShadow>
        <cylinderGeometry args={[0.28, 0.4, 0.9, 10]} />
      </mesh>
      <mesh position-y={1.45} material={stoneMaterial} castShadow>
        <cylinderGeometry args={[0.75, 0.55, 0.25, 12]} />
      </mesh>
      <mesh position-y={1.58} rotation-x={-Math.PI / 2} material={waterMaterial}>
        <circleGeometry args={[0.6, 12]} />
      </mesh>
    </group>
  );
}

/** A street lamp; the glass glows (bloom picks it up). */
function Lamp({ at }: { at: Point }) {
  return (
    <group position={[at.x, 0, at.z]}>
      <mesh position-y={1.2} material={poleMaterial} castShadow>
        <cylinderGeometry args={[0.07, 0.1, 2.4, 6]} />
      </mesh>
      <mesh position-y={2.5} material={lampMaterial}>
        <sphereGeometry args={[0.22, 10, 8]} />
      </mesh>
    </group>
  );
}
