import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REDUCED_MOTION } from '../../motion.ts';
import { PALETTE } from '../../palette.ts';
import { rng } from '../rng.ts';
import { buildNatureLayout, pondRadiusAt, type Pond } from './natureLayout.ts';
import type { CityLayout } from '../../layout.ts';
import type { DecorTree, ParkLayout } from './parkLayout.ts';
import { foliageMaterial, TREE, trunkMaterial } from './treeKit.ts';

// ---------------------------------------------------------------- kit

const C = {
  rock: '#aaa59b',
  moss: '#8c9d5c',
  meadow: '#b9c77e',
  bark: PALETTE.trunk,
  heartwood: '#d6b68a',
  stem: '#6f8f4f',
  reed: '#7d9a52',
  cattail: '#6b4a32',
  lily: '#5f9150',
  lilyBloom: '#f6d9e0',
  cap: '#efe3cf',
  water: '#6aa7b4',
  deep: '#5795a7',
  mud: '#a8997a',
  sand: '#d3c6a2',
  plank: '#9a6b47',
  post: '#6e4b33',
  duck: '#8a7660',
  drake: '#3f7a4f',
  beak: '#e2a33b',
  deer: '#9b6a44',
  belly: '#e9dcc6',
  hoof: '#4a3a2e',
  bird: '#3f434a',
};

/** Paint a geometry one flat colour (as a vertex colour), ready to merge with differently coloured parts. */
function paint(g: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const n = geo.getAttribute('position').count;
  geo.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]!), 3));
  if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(n * 2).fill(0), 2));
  return geo;
}

function kit(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  parts.forEach((p) => p.dispose());
  return g;
}

/** A boulder: a jittered icosahedron, half sunk. Mossy ones are green wherever they face the sky. */
function rockGeometry(seed: number, mossy: boolean): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const pos = g.getAttribute('position');
  // jitter by position, so the faces of the (non-indexed) polyhedron stay joined
  const hash = (x: number, y: number, z: number) => {
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 4.1) * 43758.5453;
    return h - Math.floor(h);
  };
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const k = 0.72 + hash(Math.round(x * 100), Math.round(y * 100), Math.round(z * 100)) * 0.5;
    pos.setXYZ(i, x * k, y * k * 0.85, z * k);
  }
  g.translate(0, 0.3, 0);
  g.computeVertexNormals();
  const rock = new THREE.Color(C.rock);
  const moss = new THREE.Color(C.moss);
  const normal = g.getAttribute('normal');
  const colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const face = Math.floor(i / 3) * 3;
    const up = (normal.getY(face) + normal.getY(face + 1) + normal.getY(face + 2)) / 3;
    const c = mossy && up > 0.72 ? moss : rock;
    colors.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

/** Blades fanned out from a point: tall grass, reeds and fern fronds are all this, shaped differently. */
function fan(count: number, blade: () => THREE.BufferGeometry, lean: number, color: string, seed: number): THREE.BufferGeometry {
  const rand = rng(seed);
  return kit(
    Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2 + rand() * 0.5;
      return paint(blade().rotateX(lean * (0.7 + rand() * 0.6)).rotateY(a), color);
    }),
  );
}

const leaf = (w: number, h: number, flat: number) => new THREE.ConeGeometry(w, h, 3).scale(1, 1, flat).translate(0, h / 2, 0);

const KIT = {
  rock: [rockGeometry(1, false), rockGeometry(2, false)],
  mossyRock: [rockGeometry(3, true), rockGeometry(4, true)],
  /** Lies along x, one unit long, radius one, resting on the ground. */
  log: kit([
    paint(new THREE.CylinderGeometry(1, 1, 1, 7, 1, true).rotateZ(Math.PI / 2).translate(0, 1, 0), C.bark),
    paint(new THREE.CircleGeometry(1, 7).rotateY(Math.PI / 2).translate(0.5, 1, 0), C.heartwood),
    paint(new THREE.CircleGeometry(1, 7).rotateY(-Math.PI / 2).translate(-0.5, 1, 0), C.heartwood),
  ]),
  stump: kit([
    paint(new THREE.CylinderGeometry(0.4, 0.52, 0.55, 7, 1, true).translate(0, 0.275, 0), C.bark),
    paint(new THREE.CircleGeometry(0.4, 7).rotateX(-Math.PI / 2).translate(0, 0.55, 0), C.heartwood),
    ...[0, 2.1, 4.2].map((a) => paint(new THREE.ConeGeometry(0.16, 0.5, 4).rotateZ(1.2).translate(0.42, 0.08, 0).rotateY(a), C.bark)),
  ]),
  flowerHead: new THREE.IcosahedronGeometry(0.17, 0).scale(1, 0.6, 1).translate(0, 0.46, 0),
  flowerStem: new THREE.CylinderGeometry(0.018, 0.025, 0.44, 3).translate(0, 0.22, 0),
  tuft: fan(9, () => leaf(0.06, 0.85, 0.4), 0.38, '#ffffff', 5),
  // diamond fronds, widest mid-way, arching out low
  fern: fan(8, () => new THREE.OctahedronGeometry(1).scale(0.2, 0.62, 0.035).translate(0, 0.62, 0), 1.0, '#ffffff', 6),
  reed: fan(5, () => leaf(0.045, 1.7, 0.5), 0.15, C.reed, 7),
  cattail: kit([
    paint(new THREE.CylinderGeometry(0.022, 0.03, 1.9, 4).translate(0, 0.95, 0), C.reed),
    paint(new THREE.CylinderGeometry(0.075, 0.075, 0.36, 6).translate(0, 1.55, 0), C.cattail),
    paint(leaf(0.05, 1.1, 0.4).rotateX(0.35), C.reed),
    paint(leaf(0.05, 0.9, 0.4).rotateX(-0.4), C.reed),
  ]),
  mushroomStem: new THREE.CylinderGeometry(0.05, 0.07, 0.24, 5).translate(0, 0.12, 0),
  mushroomCap: new THREE.SphereGeometry(0.17, 7, 2, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1).translate(0, 0.22, 0),
  /** A meadow's ground: a ragged disc of warmer grass, fading out at its edge (vertex alpha). */
  meadow: (() => {
    const n = 13;
    const pos: number[] = [0, 0, 0];
    const col: number[] = [1, 1, 1, 0.75];
    for (const [r, alpha] of [[0.6, 0.6], [1, 0]] as const)
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const k = r * (0.82 + 0.18 * Math.abs(Math.sin(i * 2.39 + r * 5)));
        pos.push(Math.cos(a) * k, 0, Math.sin(a) * k);
        col.push(1, 1, 1, alpha);
      }
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const [a, b] = [1 + i, 1 + ((i + 1) % n)];
      idx.push(0, b, a, a, b, b + n, a, b + n, a + n);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  })(),
  /** A lily pad with its notch. */
  lily: new THREE.CircleGeometry(0.55, 9, 0.35, Math.PI * 2 - 0.7).rotateX(-Math.PI / 2),
  lilyBloom: new THREE.ConeGeometry(0.16, 0.16, 6).rotateX(Math.PI).translate(0, 0.1, 0),
  /** Faces +x. */
  duck: kit([
    paint(new THREE.IcosahedronGeometry(0.22, 0).scale(1.35, 0.6, 0.85).translate(0, 0.07, 0), C.duck),
    paint(new THREE.ConeGeometry(0.1, 0.22, 4).rotateZ(Math.PI / 2 + 0.5).translate(-0.3, 0.14, 0), C.duck),
    paint(new THREE.IcosahedronGeometry(0.11, 0).translate(0.22, 0.25, 0), C.drake),
    paint(new THREE.ConeGeometry(0.04, 0.12, 4).rotateZ(-Math.PI / 2).translate(0.35, 0.23, 0), C.beak),
  ]),
  /** Body and legs, facing +x; the head is separate so it can graze. */
  deerBody: kit([
    paint(new THREE.BoxGeometry(1.05, 0.42, 0.38).translate(0, 0.9, 0), C.deer),
    paint(new THREE.BoxGeometry(0.9, 0.12, 0.3).translate(0, 0.7, 0), C.belly),
    paint(new THREE.BoxGeometry(0.1, 0.16, 0.12).rotateZ(0.5).translate(-0.56, 1.05, 0), C.belly),
    ...[
      [0.4, 0.13],
      [0.4, -0.13],
      [-0.4, 0.13],
      [-0.4, -0.13],
    ].map(([x, z]) => paint(new THREE.BoxGeometry(0.09, 0.75, 0.09).translate(x!, 0.38, z!), C.hoof)),
  ]),
  /** Neck and head, pivoting at the shoulder (origin). */
  deerHead: kit([
    paint(new THREE.BoxGeometry(0.16, 0.62, 0.16).translate(0, 0.31, 0).rotateZ(-0.55), C.deer),
    paint(new THREE.BoxGeometry(0.34, 0.18, 0.17).translate(0.12, 0, 0).rotateZ(-0.25).translate(0.34, 0.54, 0), C.deer),
    paint(new THREE.BoxGeometry(0.08, 0.08, 0.1).translate(0.53, 0.47, 0), C.hoof),
    paint(new THREE.ConeGeometry(0.05, 0.18, 3).translate(0.3, 0.72, 0.08).rotateX(0.0), C.deer),
    paint(new THREE.ConeGeometry(0.05, 0.18, 3).translate(0.3, 0.72, -0.08), C.deer),
  ]),
  /** Faces +x, wing tips at ±z; flaps by scaling y. */
  bird: (() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0.18, 0, 0, -0.14, 0, 0, -0.05, 0.12, 0.55, 0.18, 0, 0, -0.05, 0.12, -0.55, -0.14, 0, 0], 3));
    g.computeVertexNormals();
    return g;
  })(),
  /** One wing, hinged on the x axis, reaching out along +z. */
  wing: (() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0.08, 0, 0, -0.1, 0, 0, 0.1, 0, 0.2, -0.1, 0, 0, -0.14, 0, 0.16, 0.1, 0, 0.2], 3));
    g.computeVertexNormals();
    return g;
  })(),
};

const flat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, ...extra });
const MAT = {
  painted: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }),
  white: flat('#ffffff'),
  stem: flat(C.stem),
  cap: flat(C.cap),
  lily: flat(C.lily, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }),
  bloom: flat(C.lilyBloom),
  water: flat(C.water, { roughness: 0.25, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
  deep: flat(C.deep, { roughness: 0.2, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  mud: flat(C.mud, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  meadow: flat(C.meadow, { roughness: 1, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  sand: flat(C.sand, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  plank: flat(C.plank),
  bird: flat(C.bird, { side: THREE.DoubleSide }),
  wing: flat('#ffffff', { side: THREE.DoubleSide }),
};

// ---------------------------------------------------------------- static instances

const noPick = () => null;
const dummy = new THREE.Object3D();
type Place<T> = (item: T, o: THREE.Object3D, i: number) => void;

/** One instanced draw for a list of items; `place` poses the dummy for each. Static: laid out once. */
function Instances<T>({ items, geometry, material, place, color, shadow = false }: {
  items: T[];
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  place: Place<T>;
  color?: (item: T, i: number) => string;
  shadow?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const gl = useThree((s) => s.gl);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const c = new THREE.Color();
    items.forEach((it, i) => {
      dummy.position.set(0, 0, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      place(it, dummy, i);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (color) mesh.setColorAt(i, c.set(color(it, i)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    if (shadow) gl.shadowMap.needsUpdate = true;
  }, [items, place, color, shadow, gl]);
  if (!items.length) return null;
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} castShadow={shadow} receiveShadow raycast={noPick} />;
}

type XZ = { x: number; z: number };
type Spr = XZ & { scale: number; rot: number };
const atScale: Place<Spr> = (s, o) => (o.position.set(s.x, 0, s.z), o.rotation.set(0, s.rot, 0), o.scale.setScalar(s.scale));
const atScaleRaised: Place<Spr> = (s, o) => (o.position.set(s.x, 0.04, s.z), o.rotation.set(0, s.rot, 0), o.scale.setScalar(s.scale));
const atRock: Place<{ x: number; z: number; scale: number; squash: number; rot: number }> = (r, o) => (
  o.position.set(r.x, 0, r.z), o.rotation.set(0, r.rot, 0), o.scale.set(r.scale, r.scale * r.squash, r.scale)
);
const atLog: Place<{ x: number; z: number; rot: number; length: number; radius: number }> = (l, o) => (
  o.position.set(l.x, -0.04, l.z), o.rotation.set(0, l.rot, 0), o.scale.set(l.length, l.radius, l.radius)
);
const atFlower: Place<{ x: number; z: number; scale: number }> = (f, o) => (o.position.set(f.x, 0, f.z), o.scale.setScalar(f.scale));
const atLily: Place<Spr> = (l, o) => (o.position.set(l.x, 0.1, l.z), o.rotation.set(0, l.rot, 0), o.scale.setScalar(l.scale));
const atPatch: Place<Spr> = (s, o) => (o.position.set(s.x, 0.012, s.z), o.rotation.set(0, s.rot, 0), o.scale.setScalar(s.scale));
const atTree: Place<DecorTree> = (t, o) => (o.position.set(t.x, 0, t.z), o.rotation.set(0, t.rot, 0), o.scale.setScalar(t.scale));
const colorOf = (f: { color: string }) => f.color;
const shade = (palette: string[]) => (_: unknown, i: number) => palette[(i * 7) % palette.length]!;
const stoneShade = (_: unknown, i: number) => ['#ffffff', '#f1efe9', '#e4e1da', '#f7f3ea'][i % 4]!;
const TUFT = ['#9cb874', '#a7bd7a', '#93b06c', '#b1c27f', '#8aa866'];
const FERN = ['#6a9a55', '#77a65e', '#5f8f4e', '#82ad66'];
const tuftColor = shade(TUFT);
const fernColor = shade(FERN);

// ---------------------------------------------------------------- ponds

/** The shoreline scaled by k; `wobble` roughens it so the banks don't run parallel to the water. */
function pondShape(p: Pond, k: number, wobble = 0, count = p.shape.length): THREE.Shape {
  const pts = Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    const r = pondRadiusAt(p, a) * k * (1 + wobble * Math.sin(i * 2.7 + k * 9) * Math.cos(i * 1.3 + p.x));
    return new THREE.Vector2(Math.cos(a) * r, -Math.sin(a) * r);
  });
  return new THREE.Shape(pts);
}

/** Water layered over a muddy bank and a sandy shore, with a darker deep middle; plus the jetty. */
function PondMesh({ pond }: { pond: Pond }) {
  const layers = useMemo(
    () =>
      (
        [
          [1.13, 0.05, 21, MAT.sand, 0.02],
          [1.045, 0.02, 21, MAT.mud, 0.03],
          [1.0, 0, 14, MAT.water, 0.045],
          [0.55, 0.12, 9, MAT.deep, 0.05],
        ] as const
      ).map(([k, wobble, count, material, y]) => ({ geometry: new THREE.ShapeGeometry(pondShape(pond, k, wobble, count)).rotateX(-Math.PI / 2), material, y })),
    [pond],
  );
  const jetty = useMemo(() => {
    const j = pond.jetty;
    if (!j) return undefined;
    const len = j.from - j.to;
    const parts: THREE.BufferGeometry[] = [];
    for (let s = 0; s < len; s += 0.42) parts.push(new THREE.BoxGeometry(0.34, 0.08, 1.5).translate(j.from - s - 0.17, 0.32, 0));
    for (const s of [0.3, len * 0.5, len - 0.2]) for (const side of [-0.68, 0.68]) parts.push(new THREE.CylinderGeometry(0.08, 0.08, 0.7, 5).translate(j.from - s, 0.12, side));
    const g = mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!;
    parts.forEach((p) => p.dispose());
    return g.rotateY(-j.angle);
  }, [pond]);
  useEffect(() => () => (layers.forEach((l) => l.geometry.dispose()), jetty?.dispose()), [layers, jetty]);
  return (
    <group position={[pond.x, 0, pond.z]}>
      {layers.map((l, i) => (
        <mesh key={i} geometry={l.geometry} material={l.material} position-y={l.y} receiveShadow raycast={noPick} />
      ))}
      {jetty && <mesh geometry={jetty} material={MAT.plank} castShadow receiveShadow raycast={noPick} />}
    </group>
  );
}

// ---------------------------------------------------------------- wildlife

/** Ducks paddling, deer grazing, birds wheeling and butterflies over the meadows. Still under reduced motion. */
function Wildlife({ nature }: { nature: ReturnType<typeof buildNatureLayout> }) {
  const ducks = useRef<THREE.InstancedMesh>(null);
  const deerBody = useRef<THREE.InstancedMesh>(null);
  const deerHead = useRef<THREE.InstancedMesh>(null);
  const birds = useRef<THREE.InstancedMesh>(null);
  const wingsL = useRef<THREE.InstancedMesh>(null);
  const wingsR = useRef<THREE.InstancedMesh>(null);
  const birdList = useMemo(() => nature.flocks.flatMap((f) => Array.from({ length: f.size }, (_, k) => ({ f, k }))), [nature]);
  const drawn = useRef(false);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const head = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const s = useMemo(() => new THREE.Vector3(), []);
  const e = useMemo(() => new THREE.Euler(), []);

  useLayoutEffect(() => {
    const c = new THREE.Color();
    nature.butterflies.forEach((b, i) => {
      wingsL.current?.setColorAt(i, c.set(b.color));
      wingsR.current?.setColorAt(i, c.set(b.color));
    });
    for (const r of [wingsL, wingsR]) if (r.current?.instanceColor) r.current.instanceColor.needsUpdate = true;
    drawn.current = false;
  }, [nature]);

  useFrame((state) => {
    if (REDUCED_MOTION && drawn.current) return;
    drawn.current = true;
    const t = REDUCED_MOTION ? 0 : state.clock.elapsedTime;

    nature.ducks.forEach((d, i) => {
      const pond = nature.ponds[d.pond]!;
      const a = d.phase + t * d.speed;
      // a lazy, slightly wobbling circle
      const r = d.orbit * (1 + 0.15 * Math.sin(t * 0.13 + d.phase * 3));
      p.set(pond.x + Math.cos(a) * r, 0.05 + Math.sin(t * 1.7 + d.phase) * 0.01, pond.z + Math.sin(a) * r);
      const heading = -(a + (d.speed > 0 ? Math.PI / 2 : -Math.PI / 2));
      m.compose(p, q.setFromEuler(e.set(0, heading, Math.sin(t * 1.3 + d.phase) * 0.04)), s.setScalar(1.7));
      ducks.current?.setMatrixAt(i, m);
    });

    nature.deer.forEach((d, i) => {
      // mostly grazing, now and then lifting the head to look about
      const up = THREE.MathUtils.smoothstep(Math.sin(t * 0.21 + d.phase), 0.55, 0.9);
      const look = up * Math.sin(t * 0.5 + d.phase) * 0.4;
      m.compose(p.set(d.x, 0, d.z), q.setFromEuler(e.set(0, d.rot + look * 0.2, 0)), s.setScalar(d.scale));
      deerBody.current?.setMatrixAt(i, m);
      head.makeRotationFromEuler(e.set(0, look, -1.85 * (1 - up), 'YXZ')).setPosition(0.44, 0.98, 0);
      deerHead.current?.setMatrixAt(i, m.multiply(head));
    });

    birdList.forEach(({ f, k }, i) => {
      const a = f.phase + t * f.speed - k * 0.09 * Math.sign(f.speed);
      const r = f.radius + (k % 2 ? 1.2 : -1.2) * Math.ceil(k / 2);
      p.set(f.x + Math.cos(a) * r, f.height + Math.sin(t * 0.4 + k) * 0.6, f.z + Math.sin(a) * r);
      const heading = -(a + (f.speed > 0 ? Math.PI / 2 : -Math.PI / 2));
      // flap a few beats, then glide
      const flap = REDUCED_MOTION ? 1 : Math.sin(t * 9 + k * 1.3) * (Math.sin(t * 0.7 + k) > 0 ? 1.6 : 0.25) + 0.5;
      m.compose(p, q.setFromEuler(e.set(0, heading, 0)), s.set(1.6, 1.6 * flap, 1.6));
      birds.current?.setMatrixAt(i, m);
    });

    nature.butterflies.forEach((b, i) => {
      const w = 0.23 + (i % 5) * 0.03;
      const x = b.x + Math.sin(t * w + b.phase) * b.radius * Math.cos(t * w * 0.63 + b.phase * 2);
      const z = b.z + Math.sin(t * w * 1.37 + b.phase * 3) * b.radius * 0.8;
      const y = 0.9 + Math.sin(t * 1.9 + b.phase) * 0.25 + Math.sin(t * 0.37 + b.phase) * 0.3;
      const dx = Math.cos(t * w + b.phase) * Math.cos(t * w * 0.63 + b.phase * 2);
      const dz = Math.cos(t * w * 1.37 + b.phase * 3);
      const heading = -Math.atan2(dz, dx);
      const beat = REDUCED_MOTION ? 0.5 : 0.25 + 0.9 * Math.abs(Math.sin(t * 14 + b.phase * 5));
      for (const [ref, side] of [[wingsL, 1], [wingsR, -1]] as const) {
        m.compose(p.set(x, y, z), q.setFromEuler(e.set(-side * beat, heading, 0, 'YXZ')), s.set(1.5, 1.5, side * 1.5));
        ref.current?.setMatrixAt(i, m);
      }
    });

    for (const r of [ducks, deerBody, deerHead, birds, wingsL, wingsR]) if (r.current) r.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      {nature.ducks.length > 0 && <instancedMesh ref={ducks} frustumCulled={false} args={[KIT.duck, MAT.painted, nature.ducks.length]} raycast={noPick} />}
      {nature.deer.length > 0 && (
        <>
          <instancedMesh ref={deerBody} frustumCulled={false} args={[KIT.deerBody, MAT.painted, nature.deer.length]} raycast={noPick} />
          <instancedMesh ref={deerHead} frustumCulled={false} args={[KIT.deerHead, MAT.painted, nature.deer.length]} raycast={noPick} />
        </>
      )}
      {birdList.length > 0 && <instancedMesh ref={birds} frustumCulled={false} args={[KIT.bird, MAT.bird, birdList.length]} raycast={noPick} />}
      {nature.butterflies.length > 0 && (
        <>
          <instancedMesh ref={wingsL} frustumCulled={false} args={[KIT.wing, MAT.wing, nature.butterflies.length]} raycast={noPick} />
          <instancedMesh ref={wingsR} frustumCulled={false} args={[KIT.wing, MAT.wing, nature.butterflies.length]} raycast={noPick} />
        </>
      )}
    </group>
  );
}

// ---------------------------------------------------------------- the lot

/** Ponds, rocks, logs, meadows, undergrowth, the woodland edge and its wildlife: ~20 instanced draws. */
export function Nature({ park, layout }: { park: ParkLayout; layout: CityLayout }) {
  const nature = useMemo(() => buildNatureLayout(layout, park), [layout, park]);
  const foliage = useMemo(() => foliageMaterial(), []);
  useEffect(() => () => foliage.dispose(), [foliage]);
  const split = useMemo(
    () => ({
      rock: [0, 1].map((v) => nature.rocks.filter((r, i) => !r.mossy && i % 2 === v)),
      mossy: [0, 1].map((v) => nature.rocks.filter((r, i) => r.mossy && i % 2 === v)),
      blooms: nature.lilies.filter((l) => l.bloom),
      // each meadow's ground is a main patch and a smaller lobe off to one side
      patches: nature.meadows.flatMap((m, i) => {
        const a = i * 2.4;
        return [
          { x: m.x, z: m.z, scale: m.radius * 1.05, rot: i },
          { x: m.x + Math.cos(a) * m.radius * 0.55, z: m.z + Math.sin(a) * m.radius * 0.55, scale: m.radius * 0.7, rot: i * 3 },
        ];
      }),
      broad: nature.rimTrees.filter((t) => t.variant === 0),
      conifer: nature.rimTrees.filter((t) => t.variant === 1),
    }),
    [nature],
  );

  return (
    <group>
      {nature.ponds.map((p, i) => (
        <PondMesh key={i} pond={p} />
      ))}
      <Instances items={nature.lilies} geometry={KIT.lily} material={MAT.lily} place={atLily} />
      <Instances items={split.blooms} geometry={KIT.lilyBloom} material={MAT.bloom} place={atLily} />
      <Instances items={nature.reeds} geometry={KIT.reed} material={MAT.painted} place={atScale} />
      <Instances items={nature.cattails} geometry={KIT.cattail} material={MAT.painted} place={atScale} />

      {split.rock.map((list, v) => (
        <Instances key={`r${v}`} items={list} geometry={KIT.rock[v]!} material={MAT.painted} place={atRock} color={stoneShade} shadow />
      ))}
      {split.mossy.map((list, v) => (
        <Instances key={`m${v}`} items={list} geometry={KIT.mossyRock[v]!} material={MAT.painted} place={atRock} color={stoneShade} shadow />
      ))}
      <Instances items={nature.logs} geometry={KIT.log} material={MAT.painted} place={atLog} shadow />
      <Instances items={nature.stumps} geometry={KIT.stump} material={MAT.painted} place={atScale} shadow />

      <Instances items={split.patches} geometry={KIT.meadow} material={MAT.meadow} place={atPatch} />
      <Instances items={nature.flowers} geometry={KIT.flowerStem} material={MAT.stem} place={atFlower} />
      <Instances items={nature.flowers} geometry={KIT.flowerHead} material={MAT.white} place={atFlower} color={colorOf} />
      <Instances items={nature.tufts} geometry={KIT.tuft} material={foliage} place={atScale} color={tuftColor} />
      <Instances items={nature.ferns} geometry={KIT.fern} material={foliage} place={atScaleRaised} color={fernColor} />
      <Instances items={nature.mushrooms} geometry={KIT.mushroomStem} material={MAT.cap} place={atFlower} />
      <Instances items={nature.mushrooms} geometry={KIT.mushroomCap} material={MAT.white} place={atFlower} color={colorOf} />

      <Instances items={nature.bushes} geometry={TREE.shrub} material={foliage} place={atScale} color={colorOf} shadow />
      <Instances items={nature.rimTrees} geometry={TREE.trunk} material={trunkMaterial} place={atTree} shadow />
      <Instances items={split.broad} geometry={TREE.broadleaf} material={foliage} place={atTree} color={colorOf} shadow />
      <Instances items={split.conifer} geometry={TREE.conifer} material={foliage} place={atTree} color={colorOf} shadow />

      <Wildlife nature={nature} />
    </group>
  );
}
