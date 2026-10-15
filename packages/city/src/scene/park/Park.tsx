import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { TaskState, TaskStatus } from '@orchestrate/shared';
import { PALETTE } from '../../palette.ts';
import { TASK_COLOR, TASK_LABEL, useCity, type Trail } from '../../store.ts';
import { rng, type ParkLayout } from './parkLayout.ts';
import { foliageMaterial, TREE, trunkMaterial } from './treeKit.ts';

// ---------------------------------------------------------------- scenery

/** ~190 trees and the path hedges as a handful of instanced draws. */
export function Scenery({ park }: { park: ParkLayout }) {
  const trunks = useRef<THREE.InstancedMesh>(null);
  const broad = useRef<THREE.InstancedMesh>(null);
  const conifer = useRef<THREE.InstancedMesh>(null);
  const shrubs = useRef<THREE.InstancedMesh>(null);
  const gl = useThree((s) => s.gl);
  const canopy = useMemo(() => foliageMaterial(), []);
  const hedge = useMemo(() => foliageMaterial(), []);
  const broadList = park.trees.filter((t) => t.variant === 0);
  const conList = park.trees.filter((t) => t.variant === 1);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    park.trees.forEach((t, i) => {
      m.compose(p.set(t.x, 0, t.z), q.setFromAxisAngle(up, t.rot), s.setScalar(t.scale));
      trunks.current?.setMatrixAt(i, m);
    });
    for (const [ref, list] of [[broad, broadList], [conifer, conList]] as const) {
      list.forEach((t, i) => {
        m.compose(p.set(t.x, 0, t.z), q.setFromAxisAngle(up, t.rot), s.setScalar(t.scale));
        ref.current?.setMatrixAt(i, m);
        ref.current?.setColorAt(i, c.set(t.color));
      });
    }
    const rand = rng(99);
    park.shrubs.forEach((b, i) => {
      m.compose(p.set(b.x, 0.03, b.z), q.setFromAxisAngle(up, rand() * 6), s.set(b.scale, b.scale * (0.8 + rand() * 0.4), b.scale));
      shrubs.current?.setMatrixAt(i, m);
      shrubs.current?.setColorAt(i, c.set(PALETTE.canopy[i % PALETTE.canopy.length]!).multiplyScalar(0.92));
    });
    for (const r of [trunks, broad, conifer, shrubs]) {
      if (!r.current) continue;
      r.current.instanceMatrix.needsUpdate = true;
      if (r.current.instanceColor) r.current.instanceColor.needsUpdate = true;
      r.current.computeBoundingSphere();
    }
    gl.shadowMap.needsUpdate = true;
  }, [park, broadList, conList, gl]);

  const noPick = () => null;
  return (
    <group>
      <instancedMesh ref={trunks} args={[TREE.trunk, trunkMaterial, park.trees.length]} castShadow raycast={noPick} />
      <instancedMesh ref={broad} args={[TREE.broadleaf, canopy, broadList.length]} castShadow receiveShadow raycast={noPick} />
      <instancedMesh ref={conifer} args={[TREE.conifer, canopy, conList.length]} castShadow receiveShadow raycast={noPick} />
      <instancedMesh ref={shrubs} args={[TREE.shrub, hedge, park.shrubs.length]} castShadow receiveShadow raycast={noPick} />
    </group>
  );
}

// ---------------------------------------------------------------- this run's task trees

const STAGE_SCALE: Record<TaskStatus, number> = {
  pending: 0.45,
  red: 0.7,
  in_progress: 0.95,
  verifying: 1.15,
  review: 1.35,
  merged: 1.8,
  escalated: 1.4,
  failed: 1.4,
  skipped: 0,
};

/** One task = one tree. Grows with each stage; blooms green on merge; goes bare if it escalates. */
function TaskTree({ task, at }: { task: TaskState; at: THREE.Vector2 }) {
  const status = task.status;
  const bare = status === 'escalated' || status === 'failed';
  const selectTask = useCity((s) => s.selectTask);
  const selected = useCity((s) => s.selectedTask === task.contract.id);
  const highlighted = useCity((s) => s.highlightTask === task.contract.id);
  const [hover, setHover] = useState(false);
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.MeshBasicMaterial>(null);
  const canopy = useMemo(() => foliageMaterial(PALETTE.canopy[1]), []);
  const branches = useMemo(() => new THREE.MeshStandardMaterial({ color: PALETTE.bare, roughness: 0.9, flatShading: true, emissive: new THREE.Color(PALETTE.vermilion), emissiveIntensity: 0 }), []);
  useEffect(() => () => (canopy.dispose(), branches.dispose()), [canopy, branches]);

  const mergedAt = useRef<number | undefined>(undefined);
  if (status === 'merged' && mergedAt.current === undefined) mergedAt.current = performance.now();
  if (status !== 'merged') mergedAt.current = undefined;
  const inFlight = !['pending', 'merged', 'escalated', 'failed', 'skipped'].includes(status);
  const statusColor = useMemo(() => new THREE.Color(TASK_COLOR[status]), [status]);
  const green = useMemo(() => new THREE.Color(PALETTE.green), []);
  const sapling = useMemo(() => new THREE.Color(PALETTE.canopy[3]), []);
  const lush = useMemo(() => new THREE.Color(PALETTE.canopy[1]), []);

  useFrame((state, dt) => {
    const k = 1 - Math.exp(-dt * 2.5);
    const g = group.current;
    if (g) {
      const s = g.scale.x + (STAGE_SCALE[status] - g.scale.x) * k;
      g.scale.setScalar(Math.max(s, 0.0001));
      g.visible = s > 0.02;
      g.rotation.z = Math.sin(state.clock.elapsedTime * 1.3 + at.x) * 0.02;
    }
    const focus = hover || selected || highlighted ? 0.8 : 0;
    if (status === 'merged') {
      const age = (performance.now() - (mergedAt.current ?? 0)) / 1000;
      canopy.emissive.copy(green);
      canopy.emissiveIntensity = 0.7 + 2.6 * Math.exp(-age * 0.9) + focus;
      canopy.color.lerp(lush, k);
    } else {
      canopy.emissive.copy(statusColor);
      canopy.emissiveIntensity = (inFlight ? 0.3 + 0.15 * Math.sin(state.clock.elapsedTime * 3) : 0) + focus;
      canopy.color.lerp(sapling, k);
    }
    branches.emissiveIntensity = bare ? 0.35 + focus : 0;
    if (ring.current) {
      ring.current.color.copy(status === 'merged' ? green : statusColor);
      ring.current.opacity = 0.75 + focus * 0.25 + (inFlight ? 0.2 * Math.sin(state.clock.elapsedTime * 3) : 0);
    }
  });

  if (status === 'skipped') return null;
  return (
    <group position={[at.x, 0.12, at.y]}>
      {/* status ring on the lawn: readable from across the city */}
      <mesh position-y={-0.06} rotation-x={-Math.PI / 2} raycast={() => null}>
        <ringGeometry args={[1.5, 2.1, 40]} />
        <meshBasicMaterial ref={ring} transparent opacity={0.8} toneMapped={false} depthWrite={false} polygonOffset polygonOffsetFactor={-6} polygonOffsetUnits={-6} />
      </mesh>
      <group ref={group} scale={0.001}>
        <mesh geometry={TREE.trunk} material={bare ? branches : trunkMaterial} />
        {bare ? <mesh geometry={TREE.bare} material={branches} /> : <mesh geometry={TREE.broadleaf} material={canopy} />}
      </group>
      {/* generous invisible hit target, so even a sapling is easy to click */}
      <mesh
        position-y={1.8}
        onClick={(e) => {
          e.stopPropagation();
          selectTask(selected ? undefined : task.contract.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = '';
        }}
      >
        <cylinderGeometry args={[1.5, 1.5, 3.6, 8]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
      {(hover || selected) && (
        <Html position={[0, 5, 0]} zIndexRange={[1400, 1300]} style={{ pointerEvents: 'none' }}>
          <div className="tag tag--tree" style={{ ['--accent' as string]: TASK_COLOR[status] }}>
            <span>{task.contract.title}</span>
            <b>{TASK_LABEL[status]}</b>
          </div>
        </Html>
      )}
    </group>
  );
}

export function TaskTrees({ park }: { park: ParkLayout }) {
  const run = useCity((s) => (s.currentRunId ? s.runs[s.currentRunId] : undefined));
  const placed = useMemo(() => {
    const used = new Map<string, number>();
    const out: { task: TaskState; at: THREE.Vector2 }[] = [];
    for (const task of run?.tasks ?? []) {
      const slots = park.taskSlots.get(task.contract.squad);
      const i = used.get(task.contract.squad) ?? 0;
      const at = slots?.[i];
      if (!at) continue;
      used.set(task.contract.squad, i + 1);
      out.push({ task, at });
    }
    return out;
  }, [run?.tasks, park]);
  return (
    <>
      {placed.map(({ task, at }) => (
        <TaskTree key={`${run!.id}:${task.contract.id}`} task={task} at={at} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------- data pulses on the footpaths

const PULSE_TRAVEL = 2.2;
const PULSE_LINGER = 2.0;
const PULSE_COLOR: Record<string, string> = {
  'acceptance tests are red': PALETTE.ceruleanBright,
  'code review': PALETTE.lavender,
  escalation: PALETTE.vermilion,
  guidance: PALETTE.lavender,
  merged: PALETTE.green,
};

const pulseVertex = /* glsl */ `
  attribute float aAlong;
  varying float vAlong;
  varying float vSide;
  void main() {
    vAlong = aAlong;
    vSide = uv.x;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const pulseFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uHead;
  uniform float uFade;
  varying float vAlong;
  varying float vSide;
  void main() {
    float edge = 1.0 - abs(vSide * 2.0 - 1.0);
    float tail = smoothstep(uHead - 0.28, uHead, vAlong) * (1.0 - smoothstep(uHead, uHead + 0.015, vAlong));
    float trace = step(vAlong, uHead) * 0.25;
    float a = (tail * 1.6 + trace) * edge * uFade;
    gl_FragColor = vec4(uColor * (1.0 + tail * 2.5), a);
  }
`;

function pulseGeometry(points: THREE.Vector3[], width: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const along: number[] = [];
  const idx: number[] = [];
  const total = points.reduce((sum, p, i) => (i ? sum + p.distanceTo(points[i - 1]!) : 0), 0) || 1;
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(points.length - 1, i + 1)]!;
    const t = next.clone().sub(prev).setY(0).normalize();
    const n = new THREE.Vector3(-t.z, 0, t.x).multiplyScalar(width / 2);
    if (i) acc += points[i]!.distanceTo(points[i - 1]!);
    const p = points[i]!;
    pos.push(p.x + n.x, 0.16, p.z + n.z, p.x - n.x, 0.16, p.z - n.z);
    uv.push(0, 0, 1, 0);
    along.push(acc / total, acc / total);
    if (i < points.length - 1) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  g.setIndex(idx);
  return g;
}

function Pulse({ trail, park }: { trail: Trail; park: ParkLayout }) {
  const geometry = useMemo(() => {
    const route = park.route(trail.from, trail.to);
    return route.length > 1 ? pulseGeometry(route, 1.3) : undefined;
  }, [trail, park]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: pulseVertex,
        fragmentShader: pulseFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -8,
        polygonOffsetUnits: -8,
        uniforms: {
          uColor: { value: new THREE.Color(PULSE_COLOR[trail.reason] ?? PALETTE.amber) },
          uHead: { value: 0 },
          uFade: { value: 1 },
        },
      }),
    [trail.reason],
  );
  useEffect(() => () => (geometry?.dispose(), material.dispose()), [geometry, material]);
  useFrame(() => {
    const age = (performance.now() - trail.at) / 1000;
    material.uniforms.uHead!.value = Math.min(age / PULSE_TRAVEL, 1) * 1.02;
    material.uniforms.uFade!.value = age < PULSE_TRAVEL ? 1 : Math.max(0, 1 - (age - PULSE_TRAVEL) / PULSE_LINGER);
  });
  if (!geometry) return null;
  return <mesh geometry={geometry} material={material} renderOrder={3} raycast={() => null} />;
}

export function PathPulses({ park }: { park: ParkLayout }) {
  const trails = useCity((s) => s.trails);
  return (
    <>
      {trails.map((t) => (
        <Pulse key={t.id} trail={t} park={park} />
      ))}
    </>
  );
}
