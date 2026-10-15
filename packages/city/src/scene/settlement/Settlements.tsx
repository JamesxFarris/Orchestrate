import { useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { CityLayout } from '../../layout.ts';
import { PALETTE } from '../../palette.ts';
import { useCity } from '../../store.ts';
import { usePavingTexture } from '../Ground.tsx';
import { HOUSES, LANE_HALF_WIDTH, layoutSettlement, type HouseName, type HouseSpot, type Lane, type Point } from './settlementLayout.ts';

/**
 * Each district's settlement: houses from Kenney's Fantasy Town Kit (roofs in shades of the squad
 * colour), and the well, lanes, fountain and lamps its level has unlocked. Levels come from the
 * daemon's progress. When a district grows, the new houses rise out of the ground, after the
 * Harvest screen closes so the moment is not hidden behind it.
 */

export const SETTLEMENT_URL = `${import.meta.env.BASE_URL}models/settlement.glb`;
useGLTF.preload(SETTLEMENT_URL);

const RISE_MS = 1100;
const STAGGER_MS = 140;
const HOUSE_NAMES = Object.keys(HOUSES) as HouseName[];

const stoneMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.stone, roughness: 0.9, flatShading: true });
const waterMaterial = new THREE.MeshStandardMaterial({ color: '#6fa7b0', roughness: 0.25, metalness: 0.1 });
const poleMaterial = new THREE.MeshStandardMaterial({ color: '#4a4136', roughness: 0.6 });
const lampMaterial = new THREE.MeshStandardMaterial({ color: '#ffd889', emissive: new THREE.Color('#ffc65a'), emissiveIntensity: 2.2, toneMapped: false });

interface Placed extends HouseSpot {
  key: string;
  color: string;
  /** Index within its house model's instanced meshes. */
  slot: number;
}

/** `?settle=5` shows every district at that level, to preview the city without shipping seven projects. */
const PREVIEW_LEVEL = (() => {
  const n = Number(new URLSearchParams(location.search).get('settle'));
  return Number.isInteger(n) && n >= 1 ? n : undefined;
})();

const prefersReducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const meshOf = (nodes: Record<string, THREE.Object3D>, name: string) => nodes[name] as THREE.Mesh | undefined;

export function Settlements({ layout }: { layout: CityLayout }) {
  const progress = useCity((s) => s.progress);
  const harvestOpen = useCity((s) => !!s.harvest);
  const gl = useThree((s) => s.gl);
  const { nodes } = useGLTF(SETTLEMENT_URL);
  const kitMaterial = useMemo(() => {
    const m = (meshOf(nodes, 'cottage_body')!.material as THREE.MeshStandardMaterial).clone();
    m.roughness = 0.85;
    return m;
  }, [nodes]);
  useEffect(() => () => kitMaterial.dispose(), [kitMaterial]);

  const settlements = useMemo(() => {
    const level = new Map(progress?.districts.map((d) => [d.squad, d.settlement.level]));
    return layout.districts.map((d) => ({ district: d, ...layoutSettlement(d, PREVIEW_LEVEL ?? level.get(d.squad.id) ?? 1) }));
  }, [layout, progress]);

  const houses = useMemo<Placed[]>(() => {
    const slots = new Map<HouseName, number>();
    return settlements.flatMap(({ district, houses }) =>
      houses.map((h, i) => {
        const slot = slots.get(h.house) ?? 0;
        slots.set(h.house, slot + 1);
        return { ...h, key: `${district.squad.id}:${i}`, color: district.squad.color, slot };
      }),
    );
  }, [settlements]);

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

  // one body mesh and one roof mesh per house model
  const bodies = useRef(new Map<HouseName, THREE.InstancedMesh>());
  const roofs = useRef(new Map<HouseName, THREE.InstancedMesh>());

  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const one = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  /** Place a house, sunk by `sink` world units (0 = standing). */
  const place = (h: Placed, sink: number) => {
    m.compose(p.set(h.x, -sink, h.z), q.setFromAxisAngle(up, h.rot), one);
    bodies.current.get(h.house)?.setMatrixAt(h.slot, m);
    roofs.current.get(h.house)?.setMatrixAt(h.slot, m);
  };
  const depthOf = (h: Placed) => HOUSES[h.house].height + 0.2;
  const meshes = () => [...bodies.current.values(), ...roofs.current.values()];

  const known = !!progress || PREVIEW_LEVEL !== undefined;
  useLayoutEffect(() => {
    // houses that went away (a demo reset, a removed squad) must not keep the animation loop alive
    const present = new Set(houses.map((h) => h.key));
    for (const key of rising.current.keys()) if (!present.has(key)) rising.current.delete(key);

    if (!seen.current) {
      // first load: the town is simply there (wait for real progress, or the default level would make it "grow")
      if (known) seen.current = present;
    } else {
      const fresh = houses.filter((h) => !seen.current!.has(h.key));
      for (const h of fresh) {
        seen.current.add(h.key);
        if (!prefersReducedMotion()) rising.current.set(h.key, Infinity);
      }
    }

    const c = new THREE.Color();
    const plaster = new THREE.Color(PALETTE.limestone);
    const shadow = new THREE.Color('#5a3d2c');
    const counts = new Map<HouseName, number>();
    for (const h of houses) {
      place(h, rising.current.has(h.key) ? depthOf(h) : 0);
      bodies.current.get(h.house)?.setColorAt(h.slot, c.set('#ffffff').lerp(plaster, h.shade * 0.35));
      roofs.current.get(h.house)?.setColorAt(h.slot, c.set(h.color).lerp(shadow, 0.08 + h.shade * 0.24));
      counts.set(h.house, (counts.get(h.house) ?? 0) + 1);
    }
    for (const [name, mesh] of [...bodies.current, ...roofs.current]) {
      mesh.count = counts.get(name) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    gl.shadowMap.needsUpdate = true;
  }, [houses, gl, known]);

  useFrame(() => {
    if (!rising.current.size) return;
    const now = performance.now();
    let moved = false;
    for (const h of houses) {
      const start = rising.current.get(h.key);
      if (start === undefined || now < start) continue;
      const t = Math.min(1, (now - start) / RISE_MS);
      place(h, depthOf(h) * (1 - easeOut(t)));
      moved = true;
      if (t >= 1) rising.current.delete(h.key);
    }
    if (!moved) return;
    for (const mesh of meshes()) mesh.instanceMatrix.needsUpdate = true;
    if (!rising.current.size) gl.shadowMap.needsUpdate = true; // shadows are baked: re-bake once everything stands
  });

  // Room for growth in steps of 16 per model, so a level-up rarely has to rebuild the instanced meshes.
  const capacity = useMemo(() => {
    const n = new Map<HouseName, number>();
    for (const h of houses) n.set(h.house, (n.get(h.house) ?? 0) + 1);
    return (name: HouseName) => Math.ceil(((n.get(name) ?? 0) + 1) / 16) * 16;
  }, [houses]);
  const noPick = () => null;
  const fountain = { body: meshOf(nodes, 'fountain_body'), water: meshOf(nodes, 'fountain_water') };
  const lantern = meshOf(nodes, 'lantern_body');

  return (
    <group>
      {HOUSE_NAMES.map((name) =>
        (['body', 'roof'] as const).map((part) => {
          const source = meshOf(nodes, `${name}_${part}`);
          if (!source) return null;
          const refs = part === 'body' ? bodies : roofs;
          return (
            <instancedMesh
              key={`${name}:${part}:${capacity(name)}`}
              ref={(mesh) => {
                if (mesh) refs.current.set(name, mesh);
                else refs.current.delete(name);
              }}
              args={[source.geometry, kitMaterial, capacity(name)]}
              castShadow
              receiveShadow
              raycast={noPick}
            />
          );
        }),
      )}
      {settlements.map(({ district, features }) => (
        <group key={district.squad.id}>
          {features.lanes.map((lane) => (
            <LaneArc key={lane.radius} x={district.x} z={district.z} lane={lane} />
          ))}
          {features.well && <Well at={features.well} />}
          {features.fountain && fountain.body && (
            <group position={[features.fountain.x, 0, features.fountain.z]}>
              <mesh geometry={fountain.body.geometry} material={kitMaterial} castShadow receiveShadow />
              {fountain.water && <mesh geometry={fountain.water.geometry} material={waterMaterial} />}
            </group>
          )}
          {features.lamps.map((lamp, i) => (
            <Lamp key={i} at={lamp} post={lantern?.geometry} material={kitMaterial} />
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
      <ringGeometry args={[lane.radius - LANE_HALF_WIDTH, lane.radius + LANE_HALF_WIDTH, 64, 1, -(lane.start + lane.length), lane.length]} />
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

/** A street lamp from the kit, with a glowing light (bloom picks it up). */
function Lamp({ at, post, material }: { at: Point; post?: THREE.BufferGeometry; material: THREE.Material }) {
  if (post && !post.boundingBox) post.computeBoundingBox();
  const top = post?.boundingBox?.max.y ?? 2.5;
  return (
    <group position={[at.x, 0, at.z]}>
      {post ? (
        <mesh geometry={post} material={material} castShadow />
      ) : (
        <mesh position-y={1.2} material={poleMaterial} castShadow>
          <cylinderGeometry args={[0.07, 0.1, 2.4, 6]} />
        </mesh>
      )}
      <mesh position-y={top - 0.32} material={lampMaterial}>
        <sphereGeometry args={[0.13, 10, 8]} />
      </mesh>
    </group>
  );
}

