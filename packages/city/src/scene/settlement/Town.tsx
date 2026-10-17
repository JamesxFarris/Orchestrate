import { useGLTF } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { TOWN, type Road, type TownPiece, type TownPieceName } from './townLayout.ts';

/** Kenney city-kit pieces (tools/build-town.mjs): one node per piece, one child mesh per material. */
export const TOWN_URL = `${import.meta.env.BASE_URL}models/town.glb`;
useGLTF.preload(TOWN_URL);

/**
 * Every town piece in every district, drawn as one instanced mesh per piece part: a few dozen draw
 * calls however big the cities get. Shadows are baked once per change (static shadows).
 */
export function TownPieces({ pieces }: { pieces: TownPiece[] }) {
  const byPiece = useMemo(() => {
    const m = new Map<TownPieceName, TownPiece[]>();
    for (const p of pieces) m.set(p.piece, [...(m.get(p.piece) ?? []), p]);
    return [...m];
  }, [pieces]);
  return (
    <group>
      {byPiece.map(([name, list]) => (
        <PieceInstances key={name} name={name} list={list} />
      ))}
    </group>
  );
}

function PieceInstances({ name, list }: { name: TownPieceName; list: TownPiece[] }) {
  const { nodes } = useGLTF(TOWN_URL);
  const gl = useThree((s) => s.gl);
  const parts = useMemo(
    () =>
      Array.from({ length: TOWN[name].parts }, (_, i) => nodes[`${name}_${i}`] as THREE.Mesh | undefined).filter((m): m is THREE.Mesh => !!m),
    [nodes, name],
  );
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    const tint = new THREE.Color();
    for (const mesh of meshes.current) {
      if (!mesh) continue;
      list.forEach((t, i) => {
        mesh.setMatrixAt(i, m.compose(p.set(t.x, 0, t.z), q.setFromAxisAngle(up, t.rot), one));
        // a light wash of the tint over the kit colours; untinted pieces keep theirs
        mesh.setColorAt(i, t.tint ? c.set('#ffffff').lerp(tint.set(t.tint), 0.55) : c.set('#ffffff'));
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    gl.shadowMap.needsUpdate = true;
  }, [list, gl]);

  // room for growth in steps of 8, so a level-up rarely rebuilds the meshes
  const capacity = Math.ceil(list.length / 8) * 8;
  const noPick = () => null;
  return (
    <>
      {parts.map((part, i) => (
        <instancedMesh
          key={`${i}:${capacity}`}
          ref={(el) => void (meshes.current[i] = el)}
          args={[part.geometry, part.material as THREE.Material, capacity]}
          castShadow
          receiveShadow
          raycast={noPick}
        />
      ))}
    </>
  );
}

const asphalt = new THREE.MeshStandardMaterial({ color: '#6c6a66', roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const kerb = new THREE.MeshStandardMaterial({ color: '#d6ccb8', roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const paint = new THREE.MeshBasicMaterial({ color: '#efe6d2', polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });

/** The ring road around the old village: asphalt, pale kerbs both sides, a dashed centre line. */
export function RingRoad({ x, z, road }: { x: number; z: number; road: Road }) {
  // RingGeometry sweeps in its own XY plane; laid flat (rotate -90° about x), angle a maps to -a.
  const theta = -(road.start + road.length);
  const dashes = useMemo(() => {
    const out: { a: number }[] = [];
    const step = 3.2 / road.radius; // a dash and a gap every 3.2 units
    for (let a = 0.6 / road.radius; a < road.length; a += step) out.push({ a });
    return out;
  }, [road]);
  const dash = 1.6 / road.radius;
  return (
    <group position={[x, 0, z]} rotation-x={-Math.PI / 2}>
      <mesh position-z={0.09} material={asphalt} receiveShadow>
        <ringGeometry args={[road.radius - road.halfWidth, road.radius + road.halfWidth, 96, 1, theta, road.length]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position-z={0.12} material={kerb} receiveShadow>
          <ringGeometry args={[road.radius + side * road.halfWidth - 0.45, road.radius + side * road.halfWidth + 0.45, 96, 1, theta, road.length]} />
        </mesh>
      ))}
      {dashes.map(({ a }) => (
        <mesh key={a} position-z={0.11} material={paint}>
          <ringGeometry args={[road.radius - 0.1, road.radius + 0.1, 2, 1, theta + a, dash]} />
        </mesh>
      ))}
    </group>
  );
}
