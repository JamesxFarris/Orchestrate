import { useGLTF } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { District } from '../../layout.ts';
import { PALETTE } from '../../palette.ts';
import { usePavingTexture } from '../Ground.tsx';
import { KIT_SCALE, layoutMarket, MAST_HEIGHT, PROPS, type PropKind } from './marketLayout.ts';
import type { Settlement } from './settlementLayout.ts';

/**
 * The settlements' public spaces (layout in marketLayout.ts): carts and stalls from the Fantasy Town
 * Kit, and low-poly crates, barrels, sacks, benches, planters, notice boards and signposts, each kind
 * one instanced mesh across every district. Planter flowers, notice-board roofs and the bunting's
 * pennants take the squad colour.
 */

/** Same file Settlements.tsx loads (drei caches it, so this is not a second download). */
const KIT_URL = `${import.meta.env.BASE_URL}models/settlement.glb`;

const KIT_PROPS = ['cart', 'stall_green', 'stall_red'] as const satisfies PropKind[];
type BuiltKind = Exclude<PropKind, (typeof KIT_PROPS)[number]>;

const TIMBER = '#9a6b45';
const TIMBER_LIGHT = '#c09060';
const TIMBER_DARK = '#5e4030';
const IRON = '#4a4a4a';

/** One coloured part of a prop: non-indexed, no uvs, so every part merges with the others. */
function part(g: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0, rotY = 0): THREE.BufferGeometry {
  const p = (g.index ? g.toNonIndexed() : g).rotateY(rotY).translate(x, y, z);
  p.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const n = p.getAttribute('position').count;
  p.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]!), 3));
  if (g !== p) g.dispose();
  return p;
}
const merged = (parts: THREE.BufferGeometry[]) => {
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  parts.forEach((p) => p.dispose());
  return g;
};
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** Low-poly props, base at y = 0, front toward local +z. Sized to PROPS' footprints. */
function buildProps(): Record<BuiltKind, { body: THREE.BufferGeometry; accent?: THREE.BufferGeometry }> {
  return {
    crate: {
      body: merged([
        part(box(0.5, 0.48, 0.5), TIMBER_LIGHT, 0, 0.24),
        part(box(0.54, 0.07, 0.54), TIMBER, 0, 0.04),
        part(box(0.54, 0.07, 0.54), TIMBER, 0, 0.44),
      ]),
    },
    barrel: {
      body: merged([
        part(new THREE.CylinderGeometry(0.22, 0.22, 0.7, 8), TIMBER, 0, 0.35),
        part(new THREE.CylinderGeometry(0.27, 0.27, 0.3, 8), TIMBER, 0, 0.35),
        part(new THREE.CylinderGeometry(0.255, 0.255, 0.06, 8), IRON, 0, 0.13),
        part(new THREE.CylinderGeometry(0.255, 0.255, 0.06, 8), IRON, 0, 0.57),
      ]),
    },
    sack: {
      body: merged([
        part(new THREE.DodecahedronGeometry(0.24, 0).scale(1, 1.15, 0.85), '#d8c49a', 0, 0.26),
        part(new THREE.ConeGeometry(0.09, 0.14, 5), '#c4ad80', 0, 0.56),
      ]),
    },
    bench: {
      body: merged([
        part(box(1.25, 0.08, 0.4), TIMBER, 0, 0.42, 0.02),
        part(box(1.25, 0.24, 0.06), TIMBER, 0, 0.66, -0.19),
        part(box(0.1, 0.42, 0.36), PALETTE.stone, -0.5, 0.21, 0),
        part(box(0.1, 0.42, 0.36), PALETTE.stone, 0.5, 0.21, 0),
      ]),
    },
    planter: {
      body: merged([
        part(box(0.6, 0.36, 0.6), PALETTE.brick, 0, 0.18),
        part(box(0.64, 0.05, 0.64), PALETTE.stone, 0, 0.37),
        part(new THREE.IcosahedronGeometry(0.29, 0).scale(1, 0.6, 1), '#5d8a52', 0, 0.5),
      ]),
      // a few blooms on top, tinted with the squad colour
      accent: merged([
        part(new THREE.OctahedronGeometry(0.08, 0), '#ffffff', 0.11, 0.66, 0.08),
        part(new THREE.OctahedronGeometry(0.075, 0), '#ffffff', -0.13, 0.63, 0.05),
        part(new THREE.OctahedronGeometry(0.08, 0), '#ffffff', 0.02, 0.68, -0.13),
        part(new THREE.OctahedronGeometry(0.065, 0), '#ffffff', -0.06, 0.61, 0.18),
      ]),
    },
    noticeboard: {
      body: merged([
        part(box(0.1, 1.7, 0.1), TIMBER_DARK, -0.55, 0.85),
        part(box(0.1, 1.7, 0.1), TIMBER_DARK, 0.55, 0.85),
        part(box(1.1, 0.75, 0.06), TIMBER_LIGHT, 0, 1.15),
        part(box(0.3, 0.38, 0.01), '#f4efe2', -0.28, 1.2, 0.035),
        part(box(0.26, 0.2, 0.01), '#f4efe2', 0.06, 1.3, 0.035),
        part(box(0.22, 0.3, 0.01), '#efe3c4', 0.33, 1.1, 0.035),
        part(box(0.3, 0.16, 0.01), '#f4efe2', 0.02, 0.97, 0.035),
      ]),
      // a little gable roof in the squad colour
      accent: merged([
        part(box(1.4, 0.05, 0.36).rotateX(0.5), '#ffffff', 0, 1.78, 0.08),
        part(box(1.4, 0.05, 0.36).rotateX(-0.5), '#ffffff', 0, 1.78, -0.08),
      ]),
    },
    canopy: {
      // a trestle table of produce under a striped awning: cream stripes over the squad colour
      body: merged([
        part(box(1.3, 0.07, 0.62), TIMBER_LIGHT, 0, 0.8, 0.05),
        ...[-0.55, 0.55].flatMap((x) => [part(box(0.07, 0.8, 0.07), TIMBER, x, 0.4, 0.3), part(box(0.07, 0.8, 0.07), TIMBER, x, 0.4, -0.2)]),
        ...[-0.72, 0.72].flatMap((x) => [part(box(0.06, 2.05, 0.06), TIMBER_DARK, x, 1.02, 0.52), part(box(0.06, 2.2, 0.06), TIMBER_DARK, x, 1.1, -0.52)]),
        ...[-0.42, 0, 0.42].map((x, i) => part(box(0.32, 0.12, 0.26), ['#c8553d', '#e9b44c', '#7bc950'][i]!, x, 0.89, 0.12)),
        part(box(0.3, 0.2, 0.24), TIMBER_LIGHT, -0.3, 0.94, -0.16),
        part(box(0.3, 0.2, 0.24), TIMBER_LIGHT, 0.25, 0.94, -0.16),
        ...[-0.52, 0, 0.52].map((x) => part(box(0.26, 0.05, 1.22).rotateX(0.22), '#f4efe2', x, 2.17, 0)),
      ]),
      accent: merged([part(box(1.56, 0.04, 1.2).rotateX(0.22), '#ffffff', 0, 2.15, 0), part(box(1.56, 0.16, 0.03), '#ffffff', 0, 1.98, 0.6)]),
    },
    mast: {
      body: merged([
        part(new THREE.CylinderGeometry(0.05, 0.08, MAST_HEIGHT, 6), TIMBER_DARK, 0, MAST_HEIGHT / 2),
        part(new THREE.OctahedronGeometry(0.08, 0), '#e9b44c', 0, MAST_HEIGHT + 0.05),
        part(new THREE.CylinderGeometry(0.11, 0.13, 0.18, 6), PALETTE.stone, 0, 0.09),
      ]),
      // a swallow-tail flag in the squad colour
      accent: merged([part(box(0.5, 0.3, 0.02), '#ffffff', 0.29, MAST_HEIGHT - 0.22, 0)]),
    },
    signpost: {
      body: merged([
        part(box(0.1, 1.9, 0.1), TIMBER_DARK, 0, 0.95),
        part(new THREE.ConeGeometry(0.09, 0.14, 4), TIMBER_DARK, 0, 1.97, 0, Math.PI / 4),
        part(box(0.7, 0.16, 0.04), TIMBER_LIGHT, 0.28, 1.6, 0.06, 0.25),
        part(box(0.6, 0.15, 0.04), TIMBER_LIGHT, -0.22, 1.3, 0.06, -0.6),
        part(box(0.55, 0.15, 0.04), TIMBER_LIGHT, 0.2, 1.02, -0.06, 2.4),
      ]),
    },
  };
}

const builtMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
const accentMaterial = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.75 });
const pennantMaterial = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8, flatShading: true });
const stringMaterial = new THREE.LineBasicMaterial({ color: '#4a4136' });
/** A pennant: a small downward triangle hanging from the string, in its local XY plane. */
const pennantGeometry = new THREE.BufferGeometry().setAttribute(
  'position',
  new THREE.Float32BufferAttribute([-0.2, 0, 0, 0.2, 0, 0, 0, -0.38, 0], 3),
);
pennantGeometry.computeVertexNormals();
const PENNANT_PALE = PALETTE.sand;

interface Item {
  x: number;
  y: number;
  z: number;
  rot: number;
  color?: string;
}

const meshOf = (nodes: Record<string, THREE.Object3D>, name: string) => nodes[name] as THREE.Mesh | undefined;
const noPick = () => null;

export function Market({ settlements }: { settlements: (Settlement & { district: District })[] }) {
  const { nodes } = useGLTF(KIT_URL);
  const kitMaterial = useMemo(() => {
    const m = (meshOf(nodes, 'cottage_body')!.material as THREE.MeshStandardMaterial).clone();
    m.roughness = 0.85;
    return m;
  }, [nodes]);
  useEffect(() => () => kitMaterial.dispose(), [kitMaterial]);
  const built = useMemo(buildProps, []);
  useEffect(() => () => Object.values(built).forEach((b) => [b.body, b.accent].forEach((g) => g?.dispose())), [built]);

  const markets = useMemo(() => settlements.map((s) => ({ district: s.district, ...layoutMarket(s.district, s) })), [settlements]);

  // every prop of a kind, across all districts
  const byKind = useMemo(() => {
    const out = new Map<PropKind, Item[]>((Object.keys(PROPS) as PropKind[]).map((k) => [k, []]));
    for (const { district, props } of markets) for (const p of props) out.get(p.kind)!.push({ ...p, color: district.squad.color });
    return out;
  }, [markets]);

  const pennants = useMemo<Item[]>(
    () =>
      markets.flatMap(({ district, bunting }) =>
        bunting.flatMap((b) => b.pennants.map((p) => ({ ...p, color: p.accent ? district.squad.color : PENNANT_PALE }))),
      ),
    [markets],
  );
  const strings = useMemo(() => {
    const pts: number[] = [];
    for (const { bunting } of markets)
      for (const b of bunting)
        for (let i = 0; i + 1 < b.points.length; i++) {
          const [p, q] = [b.points[i]!, b.points[i + 1]!];
          pts.push(p.x, p.y, p.z, q.x, q.y, q.z);
        }
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }, [markets]);
  useEffect(() => () => strings.dispose(), [strings]);

  return (
    <group>
      {KIT_PROPS.map((kind) => {
        const source = meshOf(nodes, `${kind}_body`);
        return source && <Instances key={kind} items={byKind.get(kind)!} geometry={source.geometry} material={kitMaterial} scale={KIT_SCALE} />;
      })}
      {(Object.keys(built) as BuiltKind[]).map((kind) => (
        <group key={kind}>
          <Instances items={byKind.get(kind)!} geometry={built[kind].body} material={builtMaterial} />
          {built[kind].accent && <Instances items={byKind.get(kind)!} geometry={built[kind].accent!} material={accentMaterial} tinted />}
        </group>
      ))}
      <Instances items={pennants} geometry={pennantGeometry} material={pennantMaterial} tinted shadows={false} />
      {pennants.length > 0 && <lineSegments geometry={strings} material={stringMaterial} raycast={noPick} />}
      {markets.map(({ district, square }) => square && <Square key={district.squad.id} x={district.x} z={district.z} square={square} />)}
    </group>
  );
}

/** One instanced mesh for a list of items; `tinted` colours each by its squad. */
function Instances({ items, geometry, material, tinted, shadows = true, scale = 1 }: { items: Item[]; geometry: THREE.BufferGeometry; material: THREE.Material; tinted?: boolean; shadows?: boolean; scale?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const gl = useThree((s) => s.gl);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const size = new THREE.Vector3(scale, scale, scale);
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    items.forEach((it, i) => {
      mesh.setMatrixAt(i, m.compose(p.set(it.x, it.y, it.z), q.setFromAxisAngle(up, it.rot), size));
      if (tinted) mesh.setColorAt(i, c.set(it.color ?? '#ffffff'));
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    gl.shadowMap.needsUpdate = true;
  }, [items, tinted, scale, gl]);
  if (!items.length) return null;
  // keyed on the count, so a level-up rebuilds the mesh at its new size
  return <instancedMesh key={items.length} ref={ref} args={[geometry, material, items.length]} castShadow={shadows} receiveShadow raycast={noPick} />;
}

/** The cobbled market square: an arc band of paving joining the two lanes around the fountain. */
function Square({ x, z, square }: { x: number; z: number; square: { inner: number; outer: number; start: number; length: number } }) {
  const paving = usePavingTexture(14);
  // as LaneArc: laid flat, angle a maps to -a; drawn just under the lanes so they stay on top where they meet
  return (
    <mesh position={[x, 0.07, z]} rotation-x={-Math.PI / 2} receiveShadow raycast={noPick}>
      <ringGeometry args={[square.inner, square.outer, 24, 1, -(square.start + square.length), square.length]} />
      <meshStandardMaterial map={paving} roughness={0.9} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
    </mesh>
  );
}
