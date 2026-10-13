import { Html, useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Placement } from '../layout.ts';
import { PALETTE } from '../palette.ts';
import { ACTIVITY_COLOR, ACTIVITY_LABEL, useCity } from '../store.ts';
import { MODEL_URL } from './archetypes.ts';
import { createGlassMaterial, glassUniforms } from './windowMaterial.ts';

const LIT: Record<string, number> = { idle: 0, working: 0.8, testing: 0.68, reviewing: 0.6, blocked: 0.9 };
const PLAZA_Y = 0.24;

/** Masonry tones per role kind: HQ in warm limestone, squads in platinum/silver. */
const BODY: Record<string, string> = {
  master: PALETTE.limestone,
  architect: PALETTE.platinum,
  qa_head: PALETTE.limestone,
  lead: '#d4d0c8',
  analyst: PALETTE.limestone,
};
const bodyMaterials = new Map<string, THREE.MeshStandardMaterial>();
function bodyMaterial(color: string): THREE.MeshStandardMaterial {
  let m = bodyMaterials.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.05 });
    bodyMaterials.set(color, m);
  }
  return m;
}

function seedOf(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 1000;
  return h / 10;
}

function useTicker(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const fmtElapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Decals sit on top of coplanar surfaces without z-fighting. */
const decal = { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 } as const;

useGLTF.preload(MODEL_URL, false, true);

export function Building({ p }: { p: Placement }) {
  const agent = useCity((s) => s.agents[p.role.id]);
  const selected = useCity((s) => s.selectedAgent === p.role.id);
  const highlighted = useCity((s) => !!s.highlightTask && s.agents[p.role.id]?.taskId === s.highlightTask);
  const select = useCity((s) => s.select);
  const [hover, setHover] = useState(false);
  const { scene } = useGLTF(MODEL_URL, false, true);

  const activity = agent?.activity ?? 'idle';
  const active = activity !== 'idle';
  const now = useTicker(active);
  const arch = p.archetype;

  const { object, glass, trim } = useMemo(() => {
    const source = scene.getObjectByName(arch.model);
    const glass = createGlassMaterial(Math.round(arch.scale / 1.05), seedOf(p.role.id), new THREE.Vector3(p.x, PLAZA_Y, p.z), arch.scale);
    const trim = new THREE.MeshStandardMaterial({ color: p.accent, roughness: 0.35, metalness: 0.6, emissive: new THREE.Color(p.accent), emissiveIntensity: 0.15 });
    const body = bodyMaterial(BODY[p.role.kind] ?? PALETTE.platinum);
    const object = (source ?? new THREE.Group()).clone(true);
    object.position.set(0, 0, 0);
    object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const name = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.name ?? '';
      mesh.material = name.startsWith('glass') ? glass : name.startsWith('trim') ? trim : body;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.raycast = () => {}; // picking goes through the hit-box below
    });
    return { object, glass, trim };
  }, [scene, arch.model, arch.scale, p.role.id, p.role.kind, p.accent, p.x, p.z]);
  // Shadows are baked, not re-rendered every frame (see StaticShadows): ask for a re-bake once this model is in.
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.shadowMap.needsUpdate = true;
  }, [gl, object]);
  useEffect(
    () => () => {
      glass.dispose();
      trim.dispose();
    },
    [glass, trim],
  );

  const target = useRef({ lit: 0, color: new THREE.Color(ACTIVITY_COLOR.working) });
  target.current.lit = LIT[activity] ?? 0;
  if (active) target.current.color.set(ACTIVITY_COLOR[activity]);
  const accentColor = useMemo(() => new THREE.Color(p.accent), [p.accent]);
  const beacon = useRef<THREE.MeshBasicMaterial>(null);
  const ring = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((state, dt) => {
    const k = 1 - Math.exp(-dt * 3);
    const t = state.clock.elapsedTime;
    const flashAge = agent?.flashAt ? (performance.now() - agent.flashAt) / 1000 : 99;
    const flash = flashAge < 2.2 ? Math.max(0, 1 - flashAge / 2.2) * 0.8 : 0;
    const u = glassUniforms(glass);
    u.uTime.value = t;
    u.uLit.value += (target.current.lit - u.uLit.value) * k;
    u.uColor.value.lerp(target.current.color, k);
    u.uPulse.value += ((activity === 'blocked' ? 1 : 0) - u.uPulse.value) * k;
    u.uFlash.value = flash;
    const glow = hover || selected || highlighted ? 1 : 0;
    trim.emissive.copy(active ? target.current.color : accentColor);
    trim.emissiveIntensity += (0.15 + u.uLit.value * 1.6 + glow * 0.6 - trim.emissiveIntensity) * k;
    if (ring.current) ring.current.color.set(active ? ACTIVITY_COLOR[activity] : p.accent);
    if (beacon.current) {
      const blink = Math.sin(t * 2.2 + seedOf(p.role.id)) > 0.6 ? 1 : 0.25;
      beacon.current.color.set(active ? ACTIVITY_COLOR[activity] : PALETTE.vermilion).multiplyScalar(active ? 3 : 2.2 * blink);
    }
  });

  const showCard = active || hover || selected;
  const pad = arch.footprint * 0.62 + 1.4;

  return (
    <group position={[p.x, 0, p.z]}>
      {/* raised plaza with an activity ring */}
      <mesh position-y={PLAZA_Y / 2} receiveShadow>
        <cylinderGeometry args={[pad, pad + 0.15, PLAZA_Y, 64]} />
        <meshStandardMaterial color={PALETTE.stone} roughness={0.9} />
      </mesh>
      <mesh position-y={PLAZA_Y + 0.005} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[pad - 0.45, pad - 0.15, 72]} />
        <meshBasicMaterial ref={ring} color={p.accent} toneMapped={false} {...decal} />
      </mesh>

      <primitive object={object} position-y={PLAZA_Y} scale={arch.scale} />
      {/* Cheap invisible hit-box: picking against the detailed model costs ~20k triangle tests per mouse move. */}
      <mesh
        position-y={PLAZA_Y + arch.top / 2}
        onClick={(e: { stopPropagation(): void }) => {
          e.stopPropagation();
          select(selected ? undefined : p.role.id);
        }}
        onPointerOver={(e: { stopPropagation(): void }) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = '';
        }}
      >
        <boxGeometry args={[arch.width, arch.top, arch.depth]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
      <mesh position-y={PLAZA_Y + arch.top + 0.25}>
        <sphereGeometry args={[0.22, 12, 12]} />
        <meshBasicMaterial ref={beacon} toneMapped={false} />
      </mesh>

      {showCard ? (
        <Html position={[0, arch.top + 4, 0]} center distanceFactor={70} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`card ${active ? 'card--active' : ''}`} style={{ ['--accent' as string]: active ? ACTIVITY_COLOR[activity] : p.accent }}>
            <div className="card__head">
              <span className="card__role">{p.role.title}</span>
              <span className="card__chip">{ACTIVITY_LABEL[activity]}</span>
            </div>
            {agent?.taskTitle && <div className="card__task">{agent.taskTitle}</div>}
            {active && agent?.summary && <div className="card__summary">{agent.summary}</div>}
            {active && (
              <div className="card__meta">
                <span>{fmtElapsed(now - (agent?.since ?? now))}</span>
                {!!agent?.costUsd && <span>${agent.costUsd.toFixed(2)}</span>}
              </div>
            )}
          </div>
        </Html>
      ) : (
        <Html position={[0, arch.top + 1.8, 0]} center distanceFactor={70} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div className="tag" style={{ ['--accent' as string]: p.accent }}>
            {p.role.title}
          </div>
        </Html>
      )}
    </group>
  );
}
