import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { District } from '../../layout.ts';
import { PALETTE } from '../../palette.ts';
import { foliageMaterial, TREE, trunkMaterial } from '../park/treeKit.ts';
import { rng } from '../rng.ts';
import type { HouseSpot } from './settlementLayout.ts';
import { layoutYards, levelOfHouse, type YardItem } from './yardsLayout.ts';

/**
 * The yards of every settlement (see yardsLayout.ts): footpaths of stepping stones, flower beds and
 * vegetable plots, kit picket fences and clipped hedges, bushes, small and fruit trees, woodpiles and haystacks.
 * Everything repeated is one instanced draw for the whole city, rebuilt only when a town grows.
 */

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
  g.computeVertexNormals();
  parts.forEach((p) => p.dispose());
  return g;
}
const blob = (r: number, x: number, y: number, z: number, sy = 1) => new THREE.IcosahedronGeometry(r, 0).scale(1, sy, 1).translate(x, y, z);

/** Low-poly yard pieces; base at y = 0, unit size where an item scales them. */
const KIT = {
  stone: new THREE.CylinderGeometry(0.2, 0.24, 0.07, 6).translate(0, 0.035, 0),
  /** A garden bed's raised soil, 1 × 1 before scaling. */
  soil: new THREE.BoxGeometry(1, 0.12, 1).translate(0, 0.06, 0),
  /** A clipped hedge, 1 × 1 in plan before scaling. */
  hedge: new THREE.BoxGeometry(1, 0.55, 1).translate(0, 0.275, 0),
  /** One leafy plant in a bed. */
  leaves: blob(0.15, 0, 0.16, 0, 0.8),
  /** A flower head sitting on a plant. */
  bloom: blob(0.1, 0, 0.31, 0),
  /** Fruit dotted around a small broadleaf canopy (TREE.broadleaf). */
  fruit: merged(
    [
      [1.05, 2.2, 0.45],
      [-0.6, 2.1, 0.95],
      [-0.95, 2.35, -0.55],
      [0.35, 2.05, -1.05],
      [0.75, 2.9, 0.7],
      [-0.2, 2.85, 0.95],
    ].map(([x, y, z]) => blob(0.15, x!, y!, z!)),
  ),
  woodpile: merged(
    [
      [-0.2, 0.11],
      [0, 0.11],
      [0.2, 0.11],
      [-0.1, 0.3],
      [0.1, 0.3],
      [0, 0.49],
    ].map(([x, y]) => new THREE.CylinderGeometry(0.1, 0.1, 1.15, 6).rotateX(Math.PI / 2).translate(x!, y!, 0)),
  ),
  haystack: merged([new THREE.CylinderGeometry(0.52, 0.6, 0.55, 8).translate(0, 0.275, 0), new THREE.ConeGeometry(0.56, 0.5, 8).translate(0, 0.8, 0)]),
};

const dirtMaterial = new THREE.MeshStandardMaterial({ color: '#7a5638', roughness: 1, flatShading: true });
const stoneMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.path, roughness: 0.95, flatShading: true });
const logMaterial = new THREE.MeshStandardMaterial({ color: '#8f6342', roughness: 0.9, flatShading: true });
const hayMaterial = new THREE.MeshStandardMaterial({ color: '#d9b866', roughness: 1, flatShading: true });
const bloomMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7, flatShading: true });

const FLOWERS = ['#f2a541', '#e4572e', '#f4d35e', '#f7f3ea', '#d97bb0', '#b8a9e3', '#e88a6b'];
const FRUIT = ['#d2452e', '#e8862f', '#e9c440'];

type Batch = { matrices: THREE.Matrix4[]; colors?: THREE.Color[] };

interface Props {
  settlements: { district: District; houses: HouseSpot[] }[];
  /** Kit meshes from settlement.glb (the fence). */
  kit: Record<string, THREE.Object3D>;
  material: THREE.Material;
}

export function Yards({ settlements, kit, material }: Props) {
  const foliage = useMemo(() => foliageMaterial(), []);
  useEffect(() => () => foliage.dispose(), [foliage]);

  // The kit fence sits on a tile's edge; centre it so a piece runs along its own z.
  const fence = useMemo(() => {
    const g = (kit.fence_body as THREE.Mesh | undefined)?.geometry.clone();
    if (!g) return undefined;
    g.computeBoundingBox();
    const box = g.boundingBox!;
    return g.translate(-(box.min.x + box.max.x) / 2, 0, -(box.min.z + box.max.z) / 2);
  }, [kit]);
  useEffect(() => () => fence?.dispose(), [fence]);

  // Each district's yards depend only on how far it has grown, so a level-up elsewhere leaves them be.
  const items = useMemo(() => settlements.flatMap(({ district, houses }) => layoutYards(district, levelOfHouse(Math.max(0, houses.length - 1)))), [settlements]);

  const batches = useMemo(() => {
    const out: Record<string, Batch> = {};
    const add = (name: string, m: THREE.Matrix4, color?: THREE.Color) => {
      const b = (out[name] ??= { matrices: [] });
      b.matrices.push(m);
      if (color) (b.colors ??= []).push(color);
    };
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    const at = (x: number, y: number, z: number, rot: number, sx: number, sy: number, sz: number) =>
      new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, rot), new THREE.Vector3(sx, sy, sz));
    /** A point in an item's own frame. */
    const local = (it: YardItem, lx: number, lz: number) => {
      const [c, s] = [Math.cos(it.rot), Math.sin(it.rot)];
      return { x: it.x + lx * c + lz * s, z: it.z - lx * s + lz * c };
    };
    const green = (shade: number, k = 1) => new THREE.Color(PALETTE.canopy[Math.floor(shade * PALETTE.canopy.length)]!).multiplyScalar(k);

    for (const it of items) {
      const rand = rng(Math.floor(it.x * 7919 + it.z * 104729) >>> 0);
      switch (it.kind) {
        case 'path': {
          // stepping stones, alternating a little either side of the line
          const n = Math.max(2, Math.round((it.hd * 2) / 0.55));
          for (let i = 0; i < n; i++) {
            const p = local(it, (i % 2 ? 0.1 : -0.1) + (rand() - 0.5) * 0.06, -it.hd + ((i + 0.5) * 2 * it.hd) / n);
            const s = 0.9 + rand() * 0.3;
            add('stone', at(p.x, 0, p.z, rand() * 6, s, 1, s));
          }
          break;
        }
        case 'fence':
          add('fence', at(it.x, 0, it.z, it.rot, 1, 1, (it.hd * 2) / 1.4));
          break;
        case 'hedge':
          add('hedge', at(it.x, 0, it.z, it.rot, it.hw * 2, 1, it.hd * 2 + 0.04), green(0.4 + it.shade * 0.2, 0.85));
          break;
        case 'flowers':
        case 'crops': {
          add('soil', at(it.x, 0, it.z, it.rot, it.hw * 2, 1, it.hd * 2));
          // plants in rows along the bed; flowers carry a bloom in one or two colours
          const cols = Math.max(1, Math.floor((it.hw * 2) / 0.32));
          const rows = Math.max(1, Math.floor((it.hd * 2) / 0.3));
          const palette = [FLOWERS[Math.floor(it.shade * FLOWERS.length)]!, FLOWERS[Math.floor(rand() * FLOWERS.length)]!];
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const p = local(it, -it.hw + ((c + 0.5) * 2 * it.hw) / cols, -it.hd + ((r + 0.5) * 2 * it.hd) / rows);
              const s = it.kind === 'crops' ? 0.85 + rand() * 0.35 : 0.8 + rand() * 0.3;
              add('leaves', at(p.x, 0.08, p.z, rand() * 6, s, it.kind === 'crops' ? s * 1.1 : s, s), green(it.kind === 'crops' ? (c % 2) * 0.5 + 0.1 : rand(), it.kind === 'crops' ? 1.05 : 0.9));
              if (it.kind === 'flowers') add('bloom', at(p.x, 0.08, p.z, 0, s, s, s), new THREE.Color(palette[(r + c) % 2]!));
            }
          }
          break;
        }
        case 'bush':
          add('bush', at(it.x, 0.02, it.z, it.rot, it.scale, it.scale * (0.8 + rand() * 0.35), it.scale), green(it.shade, 0.92));
          break;
        case 'tree':
        case 'fruitTree':
        case 'conifer': {
          const m = at(it.x, 0, it.z, it.rot, it.scale, it.scale, it.scale);
          add('trunk', m);
          add(it.kind === 'conifer' ? 'conifer' : 'broadleaf', m, green(it.shade));
          if (it.kind === 'fruitTree') add('fruit', m, new THREE.Color(FRUIT[Math.floor(rand() * FRUIT.length)]!));
          break;
        }
        case 'woodpile':
          add('woodpile', at(it.x, 0, it.z, it.rot, 1, 1, (it.hd * 2) / 1.15));
          break;
        case 'haystack':
          add('haystack', at(it.x, 0, it.z, it.rot, it.scale, it.scale * (0.9 + rand() * 0.2), it.scale));
          break;
      }
    }
    return out;
  }, [items]);

  const draws: [string, THREE.BufferGeometry | undefined, THREE.Material, boolean][] = [
    ['stone', KIT.stone, stoneMaterial, false],
    ['soil', KIT.soil, dirtMaterial, false],
    ['leaves', KIT.leaves, foliage, true],
    ['bloom', KIT.bloom, bloomMaterial, false],
    ['fence', fence, material, true],
    ['hedge', KIT.hedge, foliage, true],
    ['bush', TREE.shrub, foliage, true],
    ['trunk', TREE.trunk, trunkMaterial, true],
    ['broadleaf', TREE.broadleaf, foliage, true],
    ['conifer', TREE.conifer, foliage, true],
    ['fruit', KIT.fruit, bloomMaterial, false],
    ['woodpile', KIT.woodpile, logMaterial, true],
    ['haystack', KIT.haystack, hayMaterial, true],
  ];
  return (
    <group>
      {draws.map(([name, geometry, mat, shadow]) => {
        const batch = batches[name];
        if (!geometry || !batch) return null;
        return <Instances key={`${name}:${batch.matrices.length}`} geometry={geometry} material={mat} batch={batch} shadow={shadow} />;
      })}
    </group>
  );
}

const noPick = () => null;

function Instances({ geometry, material, batch, shadow }: { geometry: THREE.BufferGeometry; material: THREE.Material; batch: Batch; shadow: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const gl = useThree((s) => s.gl);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    batch.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    batch.colors?.forEach((c, i) => mesh.setColorAt(i, c));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    gl.shadowMap.needsUpdate = true; // shadows are baked: re-bake when the yards change
  }, [batch, gl]);
  return <instancedMesh ref={ref} args={[geometry, material, batch.matrices.length]} castShadow={shadow} receiveShadow raycast={noPick} />;
}
