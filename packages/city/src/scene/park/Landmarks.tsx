import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactElement } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CityLayout } from '../../layout.ts';
import { PALETTE } from '../../palette.ts';
import { useCity } from '../../store.ts';
import { usePavingTexture } from '../Ground.tsx';
import { landmarksBuilt, layoutLandmarks, SITE_RADIUS, type Landmark, type LandmarkKind } from './landmarksLayout.ts';
import { foliageMaterial } from './treeKit.ts';

/**
 * The parkland's landmarks: a grand tiered fountain, a statue of an engineer on a stepped plinth,
 * a domed bandstand, a triumphal arch and an obelisk, each in a formal garden (paving, clipped
 * hedges, flower beds, benches, lamps). How many stand follows the whole city's growth (see
 * landmarksBuilt); an unbuilt site is a mown clearing. A new landmark rises out of the ground
 * after the Harvest screen closes. Everything is modelled for a site of SITE_RADIUS and scaled
 * down to fit a smaller one; geometries and materials are shared by every site.
 */

/** `?settle=N` previews every district at level N (as in Settlements.tsx), and so the landmarks it earns. */
const PREVIEW_LEVEL = (() => {
  const n = Number(new URLSearchParams(location.search).get('settle'));
  return Number.isInteger(n) && n >= 1 ? n : undefined;
})();

const prefersReducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const RISE_MS = 1800;
const noPick = () => null;

// ---------------------------------------------------------------- materials

const flat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...extra });

const MAT = {
  marble: flat('#ebe6dc'),
  stone: flat(PALETTE.limestone),
  stoneDark: flat(PALETTE.stone),
  bronze: flat('#5f8f7f', { roughness: 0.55, metalness: 0.35 }),
  gold: flat('#d9a441', { roughness: 0.35, metalness: 0.6, emissive: new THREE.Color('#8a5a12'), emissiveIntensity: 0.35 }),
  timber: flat(PALETTE.timber),
  iron: flat('#3d3a35', { roughness: 0.6 }),
  soil: flat('#6b5240', { roughness: 1 }),
  flowers: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true }),
  lawn: new THREE.MeshStandardMaterial({ color: '#b2c78f', roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  lamp: new THREE.MeshStandardMaterial({ color: '#ffd889', emissive: new THREE.Color('#ffc65a'), emissiveIntensity: 2.2, toneMapped: false }),
  water: new THREE.MeshStandardMaterial({ color: '#5fa8b8', roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.92 }),
  hedge: foliageMaterial('#4f7f47'),
};

/** Flowing water: bright streaks sliding along the surface (down a falling sheet, along a jet). */
const flowTime = { value: 0 };
function flowMaterial(along: 'x' | 'y', speed: number, bands: number, threads: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uTime: flowTime, uSpeed: { value: speed }, uBands: { value: bands }, uThreads: { value: threads } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSpeed;
      uniform float uBands;
      uniform float uThreads;
      varying vec2 vUv;
      void main() {
        float t = vUv.${along};
        float across = vUv.${along === 'x' ? 'y' : 'x'};
        // fine threads running along the flow, brightening in pulses that travel with it
        float threads = smoothstep(0.35, 1.0, 0.5 + 0.5 * sin(across * uThreads + sin(across * 23.0) * 3.0));
        float pulse = 0.55 + 0.45 * sin((t + uTime * uSpeed) * uBands + across * 9.0);
        float streak = threads * pulse;
        vec3 col = mix(vec3(0.6, 0.83, 0.9), vec3(1.0), 0.3 + streak * 0.7);
        gl_FragColor = vec4(col, 0.28 + streak * 0.5);
      }
    `,
  });
}
const FALL = flowMaterial('y', 0.5, 9, 150);
const JET = flowMaterial('x', -0.8, 14, 25);

// ---------------------------------------------------------------- geometry helpers

/** Merge parts into one flat-shaded geometry; `color` paints them (for vertex-coloured materials). */
function merged(parts: THREE.BufferGeometry[], color?: string): THREE.BufferGeometry {
  const c = new THREE.Color(color ?? '#ffffff');
  const flatParts = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    if (g !== p) p.dispose();
    for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
    if (color !== undefined) {
      const n = g.attributes.position!.count;
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [c.r, c.g, c.b]), 3));
    }
    return g;
  });
  const g = mergeGeometries(flatParts, false)!;
  g.computeVertexNormals();
  flatParts.forEach((p) => p.dispose());
  return g;
}

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const cyl = (rt: number, rb: number, h: number, seg: number, x = 0, y = 0, z = 0) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y + h / 2, z);

/** A limb or rod: a cylinder from a to b. */
function rod(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, seg = 6): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  const g = new THREE.CylinderGeometry(rb, ra, dir.length(), seg).translate(0, dir.length() / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  return g.translate(a.x, a.y, a.z);
}

/** Positions round a circle, `angle` in radians measured from local +z (the front). */
const around = (r: number, angle: number) => ({ x: Math.sin(angle) * r, z: Math.cos(angle) * r });
const deg = THREE.MathUtils.degToRad;

// ---------------------------------------------------------------- the formal garden (same at every site)

/** Garden rings, at SITE_RADIUS. Four paved walks cross it on the axes; the front one points at HQ. */
const G = { lawn: 10.8, paving: 7.4, kerb: 7.75, bedIn: 8.05, bedOut: 8.95, hedge: 9.7, walk: 2.4 };
/** Hedges and beds fill each quarter between the walks. */
const QUARTER_FROM = deg(13);
const QUARTER_TO = deg(77);

function pavingGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.CircleGeometry(G.paving, 48)];
  for (let i = 0; i < 4; i++) parts.push(new THREE.PlaneGeometry(G.walk, G.lawn - G.paving + 0.6).translate(0, (G.paving + G.lawn) / 2 - 0.3, 0).rotateZ((i * Math.PI) / 2));
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!;
  parts.forEach((p) => p.dispose());
  g.rotateX(-Math.PI / 2);
  // world-scale slabs: one texture repeat (4 slabs) every 3.2 units
  const pos = g.attributes.position!;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) (uv[i * 2] = pos.getX(i) / 3.2), (uv[i * 2 + 1] = pos.getZ(i) / 3.2);
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function hedgeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let q = 0; q < 4; q++) {
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = q * (Math.PI / 2) + QUARTER_FROM + ((i + 0.5) / n) * (QUARTER_TO - QUARTER_FROM);
      const p = around(G.hedge, a);
      parts.push(box(1.32, 1.0, 0.95).rotateY(a).translate(p.x, 0, p.z));
    }
    // clipped cones where the hedge meets each walk
    for (const end of [QUARTER_FROM - deg(4), QUARTER_TO + deg(4)]) {
      const p = around(G.hedge, q * (Math.PI / 2) + end);
      parts.push(cyl(0.05, 0.75, 2.2, 7, p.x, 0.15, p.z), cyl(0.5, 0.5, 0.2, 7, p.x, 0, p.z));
    }
  }
  return merged(parts);
}

const BLOOMS = [PALETTE.vermilion, PALETTE.amber, PALETTE.lavender, '#f4f1e8', '#e98fa5', '#f2c94c'];

function bedGeometries(): { soil: THREE.BufferGeometry; flowers: THREE.BufferGeometry } {
  const soil: THREE.BufferGeometry[] = [];
  const flowers: THREE.BufferGeometry[] = [];
  let k = 0;
  for (let q = 0; q < 4; q++) {
    const start = q * (Math.PI / 2) + QUARTER_FROM;
    const len = QUARTER_TO - QUARTER_FROM;
    // RingGeometry sweeps counter-clockwise in its XY plane; laid flat it maps angle t to (cos t, -sin t)
    soil.push(new THREE.RingGeometry(G.bedIn, G.bedOut, 14, 1, Math.PI / 2 - start - len, len).rotateX(-Math.PI / 2).translate(0, 0.11, 0));
    // two rows of blooms, a colour per quarter with a contrasting edge
    for (const [r, colour] of [[G.bedIn + 0.25, BLOOMS[(q * 2 + 1) % BLOOMS.length]!], [G.bedOut - 0.3, BLOOMS[(q * 2) % BLOOMS.length]!]] as const) {
      const n = 16;
      for (let i = 0; i < n; i++) {
        const p = around(r, start + ((i + 0.5) / n) * len);
        const s = 0.26 + ((k++ * 7) % 5) * 0.025;
        flowers.push(merged([new THREE.IcosahedronGeometry(s, 0).scale(1, 0.8, 1).translate(p.x, 0.32, p.z)], colour));
      }
    }
  }
  return { soil: merged(soil), flowers: mergeGeometries(flowers, false)! };
}

/** Benches on the diagonals, facing the centre. */
function benchGeometries(r: number): { wood: THREE.BufferGeometry; iron: THREE.BufferGeometry } {
  const wood: THREE.BufferGeometry[] = [];
  const iron: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const a = deg(45) + (i * Math.PI) / 2;
    const p = around(r, a);
    const place = (g: THREE.BufferGeometry) => g.rotateY(a + Math.PI).translate(p.x, 0, p.z);
    wood.push(place(box(1.9, 0.1, 0.55, 0, 0.45, 0)), place(box(1.9, 0.42, 0.08, 0, 0.6, -0.27)));
    for (const x of [-0.8, 0.8]) iron.push(place(box(0.08, 0.45, 0.5, x, 0, 0)), place(box(0.08, 0.6, 0.08, x, 0.45, -0.27)));
  }
  return { wood: merged(wood), iron: merged(iron) };
}

/** Lamps flanking the mouth of each walk, where it leaves the paving. */
function lampGeometries(): { posts: THREE.BufferGeometry; globes: THREE.BufferGeometry } {
  const posts: THREE.BufferGeometry[] = [];
  const globes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++)
    for (const side of [-1, 1]) {
      const a = (i * Math.PI) / 2 + side * Math.atan2(G.walk / 2 + 0.55, G.paving);
      const p = around(G.paving + 0.2, a);
      posts.push(cyl(0.16, 0.2, 0.3, 6, p.x, 0, p.z), cyl(0.06, 0.08, 2.6, 6, p.x, 0.3, p.z), cyl(0.22, 0.12, 0.12, 6, p.x, 2.85, p.z));
      globes.push(new THREE.IcosahedronGeometry(0.24, 1).translate(p.x, 3.15, p.z));
    }
  return { posts: merged(posts), globes: merged(globes) };
}

const GARDEN = {
  paving: pavingGeometry(),
  kerb: new THREE.RingGeometry(G.paving - 0.05, G.kerb, 48).rotateX(-Math.PI / 2),
  lawn: new THREE.CircleGeometry(G.lawn, 48).rotateX(-Math.PI / 2),
  hedge: hedgeGeometry(),
  ...bedGeometries(),
  lamps: lampGeometries(),
};
const BENCH_NEAR = benchGeometries(6.4);

function Garden() {
  const paving = usePavingTexture(1);
  const pavingMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ map: paving, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    [paving],
  );
  useEffect(() => () => pavingMaterial.dispose(), [pavingMaterial]);
  return (
    <group>
      <mesh geometry={GARDEN.lawn} material={MAT.lawn} position-y={0.03} receiveShadow raycast={noPick} />
      <mesh geometry={GARDEN.paving} material={pavingMaterial} position-y={0.07} receiveShadow raycast={noPick} />
      <mesh geometry={GARDEN.kerb} material={MAT.stoneDark} position-y={0.1} receiveShadow raycast={noPick} />
      <mesh geometry={GARDEN.soil} material={MAT.soil} receiveShadow raycast={noPick} />
      <mesh geometry={GARDEN.flowers} material={MAT.flowers} castShadow raycast={noPick} />
      <mesh geometry={GARDEN.hedge} material={MAT.hedge} castShadow receiveShadow raycast={noPick} />
      <mesh geometry={GARDEN.lamps.posts} material={MAT.iron} castShadow raycast={noPick} />
      <mesh geometry={GARDEN.lamps.globes} material={MAT.lamp} raycast={noPick} />
      <mesh geometry={BENCH_NEAR.wood} material={MAT.timber} castShadow raycast={noPick} />
      <mesh geometry={BENCH_NEAR.iron} material={MAT.iron} castShadow raycast={noPick} />
    </group>
  );
}

// ---------------------------------------------------------------- the grand fountain

const FOUNTAIN = (() => {
  const basinR = 5.0;
  const lathe = (pts: [number, number][], seg = 14) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  return {
    basinR,
    // outer wall with a rounded coping, inner wall, and the basin floor under the water
    basin: merged([
      lathe([[basinR - 0.45, 0.62], [basinR - 0.5, 0.95], [basinR + 0.05, 1.0], [basinR + 0.15, 0.85], [basinR, 0.7], [basinR, 0]], 28),
      cyl(basinR + 0.35, basinR + 0.45, 0.18, 28),
    ]),
    // pedestal, lower bowl, stem, upper bowl, finial: one turned column
    column: merged([
      lathe([
        [0.001, 0.6], [1.1, 0.6], [1.0, 0.9], [0.55, 1.2], [0.45, 2.0], [0.7, 2.3], [2.5, 2.55], [2.6, 2.85], [2.3, 2.9],
        [0.42, 2.9], [0.3, 3.6], [0.38, 4.0], [1.45, 4.2], [1.5, 4.45], [1.3, 4.5], [0.3, 4.5], [0.22, 5.0], [0.35, 5.3], [0.001, 5.9],
      ]),
    ]),
    pool: new THREE.CircleGeometry(basinR - 0.45, 28).rotateX(-Math.PI / 2).translate(0, 0.62, 0),
    bowl1: new THREE.CircleGeometry(2.32, 16).rotateX(-Math.PI / 2).translate(0, 2.83, 0),
    bowl2: new THREE.CircleGeometry(1.32, 14).rotateX(-Math.PI / 2).translate(0, 4.43, 0),
    // water sheets falling from each bowl's lip into the one below
    fall1: new THREE.CylinderGeometry(2.62, 2.85, 2.25, 20, 1, true).translate(0, 0.62 + 2.25 / 2, 0),
    fall2: new THREE.CylinderGeometry(1.52, 1.62, 1.6, 16, 1, true).translate(0, 2.85 + 1.6 / 2, 0),
    // the crown jet, and eight arcs leaping from the rim toward the column
    crown: new THREE.CylinderGeometry(0.06, 0.2, 2.2, 8, 1, true).translate(0, 5.9 + 1.1, 0),
    arcs: (() => {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 8; i++) {
        const a = deg(22.5) + (i * Math.PI) / 4;
        const p = (r: number, y: number) => new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r);
        const curve = new THREE.QuadraticBezierCurve3(p(basinR - 0.35, 1.0), p(basinR - 1.6, 4.4), p(2.9, 0.65));
        parts.push(new THREE.TubeGeometry(curve, 16, 0.12, 6, false));
      }
      return mergeGeometries(parts, false)!;
    })(),
    ripple: new THREE.RingGeometry(0.85, 1.0, 32).rotateX(-Math.PI / 2),
  };
})();

function Fountain({ still }: { still: boolean }) {
  const ripples = useRef<THREE.Mesh[]>([]);
  const crown = useRef<THREE.Mesh>(null);
  const rippleMats = useMemo(() => [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: '#e8f6f8', transparent: true, depthWrite: false, opacity: 0.5 })), []);
  useEffect(() => () => rippleMats.forEach((m) => m.dispose()), [rippleMats]);
  useFrame((state) => {
    if (still) return;
    const t = state.clock.elapsedTime;
    ripples.current.forEach((m, i) => {
      const k = (t * 0.35 + i / 3) % 1;
      m.scale.setScalar(2.9 + k * 1.7);
      rippleMats[i]!.opacity = 0.55 * (1 - k);
    });
    if (crown.current) crown.current.scale.y = 1 + Math.sin(t * 2.4) * 0.12 + Math.sin(t * 5.1) * 0.05;
  });
  return (
    <group>
      <mesh geometry={FOUNTAIN.basin} material={MAT.marble} castShadow receiveShadow raycast={noPick} />
      <mesh geometry={FOUNTAIN.column} material={MAT.marble} castShadow receiveShadow raycast={noPick} />
      <mesh geometry={FOUNTAIN.pool} material={MAT.water} raycast={noPick} />
      <mesh geometry={FOUNTAIN.bowl1} material={MAT.water} raycast={noPick} />
      <mesh geometry={FOUNTAIN.bowl2} material={MAT.water} raycast={noPick} />
      <mesh geometry={FOUNTAIN.fall1} material={FALL} raycast={noPick} />
      <mesh geometry={FOUNTAIN.fall2} material={FALL} raycast={noPick} />
      <mesh geometry={FOUNTAIN.arcs} material={JET} raycast={noPick} />
      <mesh ref={crown} geometry={FOUNTAIN.crown} material={FALL} position-y={5.9} raycast={noPick} />
      {rippleMats.map((m, i) => (
        <mesh
          key={i}
          ref={(el) => void (el && (ripples.current[i] = el))}
          geometry={FOUNTAIN.ripple}
          material={m}
          position-y={0.64}
          scale={3.4 + i * 0.5}
          raycast={noPick}
        />
      ))}
    </group>
  );
}
// the crown jet scales about its nozzle: re-centre it at the origin, the mesh is placed at the nozzle
FOUNTAIN.crown.translate(0, -5.9, 0);

// ---------------------------------------------------------------- the statue

const STATUE = (() => {
  const plinthTop = 0.6 + 0.6 + 0.35 + 2.4 + 0.35;
  const plinth = merged([
    box(5.0, 0.6, 5.0),
    box(3.9, 0.6, 3.9, 0, 0.6),
    box(2.7, 0.35, 2.7, 0, 1.2),
    box(2.2, 2.4, 2.2, 0, 1.55),
    box(2.75, 0.35, 2.75, 0, 3.95),
  ]);
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const body = [
    // stepping forward, in a long work coat, cap on
    rod(v(0.32, 0, 0.35), v(0.28, 1.9, 0.05), 0.26, 0.3),
    rod(v(-0.32, 0, -0.25), v(-0.28, 1.9, 0), 0.26, 0.3),
    box(0.42, 0.28, 0.75, 0.32, 0, 0.5),
    box(0.42, 0.28, 0.75, -0.32, 0, -0.1),
    cyl(0.58, 0.95, 2.2, 8, 0, 1.4),
    cyl(0.72, 0.6, 0.8, 8, 0, 3.55),
    cyl(0.22, 0.25, 0.3, 6, 0, 4.3),
    new THREE.IcosahedronGeometry(0.46, 1).translate(0, 4.85, 0.02),
    cyl(0.5, 0.5, 0.18, 10, 0, 5.12),
    box(0.62, 0.06, 0.45, 0, 5.12, 0.42),
  ];
  // variant 0 holds a lantern high and a scroll at the side; variant 1 holds up a star and a book
  const raisedArm = [rod(v(0.66, 4.1, 0), v(1.05, 5.0, 0.3), 0.2, 0.17), rod(v(1.05, 5.0, 0.3), v(1.2, 6.05, 0.45), 0.17, 0.14), new THREE.IcosahedronGeometry(0.17, 0).translate(1.2, 6.12, 0.45)];
  const lowArm = [rod(v(-0.66, 4.1, 0), v(-0.8, 3.15, 0.2), 0.2, 0.17), rod(v(-0.8, 3.15, 0.2), v(-0.55, 2.75, 0.75), 0.17, 0.14)];
  return {
    plinthTop,
    plinth,
    figure: [
      merged([...body, ...raisedArm, ...lowArm, rod(v(1.2, 6.12, 0.45), v(1.2, 5.75, 0.45), 0.03, 0.03), box(0.5, 0.08, 0.5, 1.2, 5.75, 0.45), box(0.55, 0.12, 0.55, 1.2, 5.05, 0.45), cyl(0.12, 0.42, 0.3, 4, 1.2, 5.65, 0.45).rotateY(0), new THREE.CylinderGeometry(0.13, 0.13, 1.0, 7).rotateZ(Math.PI / 2).translate(-0.55, 2.72, 0.85)]),
      merged([...body, ...raisedArm, ...lowArm, box(0.75, 0.95, 0.18, -0.5, 2.3, 0.9)]),
    ],
    // glowing heart of the lantern / the gilded star
    lantern: new THREE.BoxGeometry(0.38, 0.55, 0.38).translate(1.2, 5.4, 0.45),
    star: new THREE.OctahedronGeometry(0.55, 0).scale(1, 1.3, 0.45).translate(1.2, 6.75, 0.45),
    // clipped box topiary at the plinth corners
    topiary: merged(
      [-1, 1].flatMap((sx) => [-1, 1].flatMap((sz) => [box(1.1, 1.1, 1.1, sx * 3.6, 0, sz * 3.6), new THREE.IcosahedronGeometry(0.62, 0).translate(sx * 3.6, 1.65, sz * 3.6)])),
    ),
  };
})();

function Statue({ variant }: { variant: 0 | 1 }) {
  return (
    <group>
      <mesh geometry={STATUE.plinth} material={MAT.stone} castShadow receiveShadow raycast={noPick} />
      <group position-y={STATUE.plinthTop}>
        <mesh geometry={STATUE.figure[variant]} material={MAT.bronze} castShadow raycast={noPick} />
        {variant === 0 ? (
          <mesh geometry={STATUE.lantern} material={MAT.lamp} raycast={noPick} />
        ) : (
          <mesh geometry={STATUE.star} material={MAT.gold} castShadow raycast={noPick} />
        )}
      </group>
      <mesh geometry={STATUE.topiary} material={MAT.hedge} castShadow receiveShadow raycast={noPick} />
    </group>
  );
}

// ---------------------------------------------------------------- the bandstand

const BANDSTAND = (() => {
  const r = 4.0;
  const colH = 3.4;
  const deckY = 1.0;
  const cols: THREE.BufferGeometry[] = [];
  const rails: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    const p = around(r - 0.35, a);
    cols.push(cyl(0.3, 0.3, 0.25, 8, p.x, deckY, p.z), cyl(0.15, 0.18, colH, 8, p.x, deckY + 0.25, p.z), cyl(0.3, 0.17, 0.25, 8, p.x, deckY + 0.25 + colH, p.z));
    // a low rail between neighbouring columns, except at the front steps
    if (i === 7) continue;
    const q = around(r - 0.35, a + Math.PI / 4);
    const mid = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 };
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    const ang = Math.atan2(q.x - p.x, q.z - p.z);
    rails.push(box(0.1, 0.1, len, 0, deckY + 0.85, 0).rotateY(ang).translate(mid.x, 0, mid.z));
    for (let k = 1; k < 6; k++) {
      const t = k / 6;
      rails.push(box(0.05, 0.85, 0.05, p.x + (q.x - p.x) * t, deckY, p.z + (q.z - p.z) * t));
    }
  }
  const top = deckY + 0.25 + colH + 0.25;
  return {
    base: merged([
      cyl(r + 0.7, r + 0.8, 0.35, 8).rotateY(Math.PI / 8),
      cyl(r, r + 0.1, deckY, 8).rotateY(Math.PI / 8),
      // front steps (toward HQ)
      box(2.0, 0.35, 1.0, 0, 0.3, r + 0.3),
      box(2.0, 0.35, 0.7, 0, 0.6, r + 0.1),
    ]),
    columns: merged(cols),
    rails: merged(rails),
    eaves: merged([cyl(r + 0.25, r + 0.15, 0.45, 8, 0, top).rotateY(Math.PI / 8), cyl(r + 0.45, r + 0.35, 0.15, 8, 0, top + 0.45).rotateY(Math.PI / 8)]),
    dome: merged([
      new THREE.SphereGeometry(r + 0.3, 8, 4, Math.PI / 8, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.62, 1).translate(0, top + 0.55, 0),
      cyl(0.55, 0.65, 0.7, 8, 0, top + 0.5 + (r + 0.3) * 0.62 - 0.1),
      new THREE.ConeGeometry(0.75, 0.9, 8).translate(0, top + 0.5 + (r + 0.3) * 0.62 + 1.0, 0),
    ]),
    finial: merged([new THREE.IcosahedronGeometry(0.28, 0).translate(0, top + 0.5 + (r + 0.3) * 0.62 + 1.65, 0), cyl(0.04, 0.04, 0.7, 4, 0, top + 0.5 + (r + 0.3) * 0.62 + 1.8)]),
  };
})();

function Bandstand() {
  return (
    <group>
      <mesh geometry={BANDSTAND.base} material={MAT.stone} castShadow receiveShadow raycast={noPick} />
      <mesh geometry={BANDSTAND.columns} material={MAT.marble} castShadow receiveShadow raycast={noPick} />
      <mesh geometry={BANDSTAND.rails} material={MAT.iron} castShadow raycast={noPick} />
      <mesh geometry={BANDSTAND.eaves} material={MAT.marble} castShadow receiveShadow raycast={noPick} />
      <mesh geometry={BANDSTAND.dome} material={MAT.bronze} castShadow receiveShadow raycast={noPick} />
      <mesh geometry={BANDSTAND.finial} material={MAT.gold} castShadow raycast={noPick} />
    </group>
  );
}

// ---------------------------------------------------------------- the triumphal arch

const ARCH = (() => {
  const w = 8.4;
  const h = 7.2;
  const depth = 2.4;
  const open = 1.7; // half-width of the archway
  const spring = 4.4; // where the arch springs
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0).lineTo(w / 2, 0).lineTo(w / 2, h).lineTo(-w / 2, h).lineTo(-w / 2, 0);
  const hole = new THREE.Path();
  hole.moveTo(-open, 0).lineTo(-open, spring);
  hole.absarc(0, spring, open, Math.PI, 0, true);
  hole.lineTo(open, 0).lineTo(-open, 0);
  shape.holes.push(hole);
  const body = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 }).translate(0, 0, -depth / 2);
  const cols: THREE.BufferGeometry[] = [];
  for (const x of [-3.55, -2.35, 2.35, 3.55])
    for (const z of [-1, 1]) {
      const zz = z * (depth / 2 + 0.25);
      cols.push(box(0.75, 0.9, 0.75, x, 0, zz), cyl(0.26, 0.3, 4.9, 8, x, 0.9, zz), box(0.7, 0.3, 0.7, x, 5.8, zz));
    }
  return {
    body: merged([
      body,
      box(w + 0.5, 0.35, depth + 0.9, 0, h - 0.6), // cornice
      box(w - 0.6, 1.5, depth - 0.2, 0, h - 0.25), // attic
      box(w - 0.2, 0.25, depth + 0.1, 0, h + 1.25),
      box(w + 0.6, 0.3, depth + 1.0, 0, 0), // plinth course
    ]),
    columns: merged(cols),
    // keystones and a gilded inscription panel on both faces
    panels: merged([box(3.2, 0.9, 0.12, 0, h + 0.05, depth / 2 - 0.05), box(3.2, 0.9, 0.12, 0, h + 0.05, -depth / 2 - 0.07)]),
    // bronze urns on the attic corners and laurel wreaths over the arch
    bronze: merged([
      ...[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) =>
          new THREE.LatheGeometry([[0.001, 0], [0.35, 0], [0.18, 0.2], [0.45, 0.6], [0.4, 0.95], [0.22, 1.05], [0.001, 1.15]].map(([r, y]) => new THREE.Vector2(r, y)), 8).translate(sx * 3.5, h + 1.5, sz * 0.7),
        ),
      ),
      new THREE.TorusGeometry(0.55, 0.13, 5, 12).translate(0, spring + open + 0.6, depth / 2 + 0.1),
      new THREE.TorusGeometry(0.55, 0.13, 5, 12).translate(0, spring + open + 0.6, -depth / 2 - 0.1),
    ]),
  };
})();

function Arch() {
  return (
    <group>
      <mesh geometry={ARCH.body} material={MAT.stone} castShadow receiveShadow raycast={noPick} />
      <mesh geometry={ARCH.columns} material={MAT.marble} castShadow receiveShadow raycast={noPick} />
      <mesh geometry={ARCH.panels} material={MAT.gold} raycast={noPick} />
      <mesh geometry={ARCH.bronze} material={MAT.bronze} castShadow raycast={noPick} />
    </group>
  );
}

// ---------------------------------------------------------------- the obelisk

const OBELISK = (() => {
  const shaftY = 0.5 * 3 + 2.0;
  const shaftH = 12.5;
  return {
    base: merged([box(5.6, 0.5, 5.6), box(4.5, 0.5, 4.5, 0, 0.5), box(3.4, 0.5, 3.4, 0, 1.0), box(2.4, 1.7, 2.4, 0, 1.5), box(2.8, 0.3, 2.8, 0, 3.2)]),
    // square shaft (4-sided cylinder turned to face the axes), tapering
    shaft: cyl(0.62, 1.0, shaftH, 4, 0, shaftY + 0.3).rotateY(Math.PI / 4),
    tip: new THREE.ConeGeometry(0.62, 1.4, 4).rotateY(Math.PI / 4).translate(0, shaftY + 0.3 + shaftH + 0.7, 0),
    // bronze lamps of remembrance on the four corners of the lowest step
    braziers: merged(
      [-1, 1].flatMap((sx) => [-1, 1].flatMap((sz) => [cyl(0.25, 0.35, 0.9, 6, sx * 2.35, 0.5, sz * 2.35), cyl(0.5, 0.25, 0.35, 6, sx * 2.35, 1.4, sz * 2.35)])),
    ),
    flames: merged([-1, 1].flatMap((sx) => [-1, 1].map((sz) => new THREE.IcosahedronGeometry(0.3, 0).scale(1, 1.4, 1).translate(sx * 2.35, 1.95, sz * 2.35)))),
    // a gilded band and a plaque facing HQ
    plaque: box(1.4, 0.9, 0.08, 0, 1.9, 1.22),
  };
})();

function Obelisk() {
  return (
    <group>
      <mesh geometry={OBELISK.base} material={MAT.stone} castShadow receiveShadow raycast={noPick} />
      <mesh geometry={OBELISK.shaft} material={MAT.marble} castShadow receiveShadow raycast={noPick} />
      <mesh geometry={OBELISK.tip} material={MAT.gold} castShadow raycast={noPick} />
      <mesh geometry={OBELISK.braziers} material={MAT.bronze} castShadow raycast={noPick} />
      <mesh geometry={OBELISK.flames} material={MAT.lamp} raycast={noPick} />
      <mesh geometry={OBELISK.plaque} material={MAT.gold} raycast={noPick} />
    </group>
  );
}

// ---------------------------------------------------------------- an unbuilt site

const CLEARING = {
  lawn: new THREE.CircleGeometry(SITE_RADIUS * 0.72, 32).rotateX(-Math.PI / 2),
  // surveyor's pegs round the edge and a stake with a little flag where the landmark will stand
  pegs: merged(
    Array.from({ length: 10 }, (_, i) => {
      const p = around(SITE_RADIUS * 0.72, (i / 10) * Math.PI * 2);
      return new THREE.DodecahedronGeometry(0.32, 0).scale(1, 0.6, 1).translate(p.x, 0.12, p.z);
    }),
  ),
  stake: merged([cyl(0.06, 0.06, 1.8, 5)]),
  flag: new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.8, 0), new THREE.Vector3(0, 1.35, 0), new THREE.Vector3(0.65, 1.58, 0)]),
};
CLEARING.flag.computeVertexNormals();

function Clearing() {
  return (
    <group>
      <mesh geometry={CLEARING.lawn} material={MAT.lawn} position-y={0.03} receiveShadow raycast={noPick} />
      <mesh geometry={CLEARING.pegs} material={MAT.stoneDark} castShadow raycast={noPick} />
      <mesh geometry={CLEARING.stake} material={MAT.timber} castShadow raycast={noPick} />
      <mesh geometry={CLEARING.flag} raycast={noPick}>
        <meshStandardMaterial color={PALETTE.vermilion} side={THREE.DoubleSide} flatShading />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------- all sites

const CENTREPIECE: Record<LandmarkKind, (props: { mark: Landmark; still: boolean }) => ReactElement> = {
  fountain: ({ still }) => <Fountain still={still} />,
  statue: ({ mark }) => <Statue variant={mark.variant} />,
  bandstand: () => <Bandstand />,
  arch: () => <Arch />,
  obelisk: () => <Obelisk />,
};

/** Tallest centrepiece; a rising landmark starts this far below the lawn. */
const SINK = 16;

export function Landmarks({ layout }: { layout: CityLayout }) {
  const progress = useCity((s) => s.progress);
  const harvestOpen = useCity((s) => !!s.harvest);
  const gl = useThree((s) => s.gl);
  const marks = useMemo(() => layoutLandmarks(layout), [layout]);
  const built = useMemo(() => {
    const levels = layout.districts.map((d) => PREVIEW_LEVEL ?? progress?.districts.find((p) => p.squad === d.squad.id)?.settlement.level ?? 1);
    return landmarksBuilt(levels, marks.length);
  }, [layout, progress, marks.length]);
  const still = useMemo(prefersReducedMotion, []);

  // Which landmarks are new, and when each starts rising: rank -> start time (Infinity = waiting
  // for the Harvest screen to close). On first load the city simply has what it has earned.
  const known = !!progress || PREVIEW_LEVEL !== undefined;
  const seen = useRef<number | undefined>(undefined);
  const rising = useRef(new Map<number, number>());
  const centres = useRef(new Map<number, THREE.Group>());

  useLayoutEffect(() => {
    if (seen.current === undefined) {
      if (known) seen.current = built;
    } else if (built > seen.current) {
      for (let r = seen.current; r < built; r++) if (!still) rising.current.set(r, Infinity);
      seen.current = built;
    } else seen.current = built;
    for (const r of rising.current.keys()) if (r >= built) rising.current.delete(r);
    gl.shadowMap.needsUpdate = true;
  }, [built, known, still, gl]);

  useEffect(() => {
    if (harvestOpen) return;
    const now = performance.now();
    let k = 0;
    for (const [r, start] of rising.current) if (start === Infinity) rising.current.set(r, now + 400 + k++ * 900);
  }, [harvestOpen, built]);

  useFrame((_, dt) => {
    if (!still) flowTime.value += dt;
    if (!rising.current.size) return;
    const now = performance.now();
    for (const [r, start] of rising.current) {
      const g = centres.current.get(r);
      const t = start === Infinity ? 0 : Math.min(Math.max((now - start) / RISE_MS, 0), 1);
      if (g) g.position.y = -SINK * (1 - easeOut(t));
      if (t >= 1) rising.current.delete(r);
    }
    gl.shadowMap.needsUpdate = true;
  });

  return (
    <group>
      {marks.map((m) => {
        const Centre = CENTREPIECE[m.kind];
        const up = m.rank < built;
        return (
          <group key={m.rank} position={[m.x, 0, m.z]} rotation-y={m.rot} scale={m.radius / SITE_RADIUS}>
            {up ? (
              <>
                <Garden />
                <group
                  ref={(g) => void (g ? centres.current.set(m.rank, g) : centres.current.delete(m.rank))}
                  position-y={rising.current.has(m.rank) ? -SINK : 0}
                >
                  <Centre mark={m} still={still} />
                </group>
              </>
            ) : (
              <Clearing />
            )}
          </group>
        );
      })}
    </group>
  );
}
