import { Html, useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Placement } from '../layout.ts';
import { REDUCED_MOTION } from '../motion.ts';
import { PALETTE } from '../palette.ts';
import { ACTIVITY_COLOR, useCity } from '../store.ts';
import { activityVerb, RoleIcon } from '../ui/roleIcons.tsx';
import { MODEL_URL } from './archetypes.ts';
import { activityWeights, createGlassMaterial, glassUniforms } from './windowMaterial.ts';

const PLAZA_Y = 0.24;

/** Masonry base per role kind; squad buildings are then tinted toward their squad colour. */
const BODY: Record<string, string> = {
  master: PALETTE.limestone,
  architect: PALETTE.platinum,
  qa_head: PALETTE.limestone,
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

/** Soft additive column of light around an active tower, fading upward. */
const auraVertex = /* glsl */ `
  varying float vH;
  void main() {
    vH = uv.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const auraFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying float vH;
  void main() {
    // clamp: on D3D pow() of a tiny negative (interpolation overshoot at the rim) is NaN, and bloom spreads NaN everywhere
    float fade = pow(clamp(1.0 - vH, 0.0, 1.0), 1.6);
    float ripple = 0.75 + 0.25 * sin(vH * 24.0 - uTime * 3.0);
    gl_FragColor = vec4(uColor * 1.6, fade * ripple * uOpacity);
  }
`;

useGLTF.preload(MODEL_URL, false, true);

const VERMILION = new THREE.Color(PALETTE.vermilion);

export function Building({ p }: { p: Placement }) {
  const agent = useCity((s) => s.agents[p.role.id]);
  const selected = useCity((s) => s.selectedAgent === p.role.id);
  const highlighted = useCity((s) => !!s.highlightTask && s.agents[p.role.id]?.taskId === s.highlightTask);
  const select = useCity((s) => s.select);
  const camera = useCity((s) => s.camera);
  const [hover, setHover] = useState(false);
  // unmounting while hovered never fires pointer-out: put the cursor back
  useEffect(() => {
    if (!hover) return;
    return () => void (document.body.style.cursor = '');
  }, [hover]);
  const { scene } = useGLTF(MODEL_URL, false, true);

  const activity = agent?.activity ?? 'idle';
  const active = activity !== 'idle';
  const now = useTicker(active);
  const arch = p.archetype;

  const { object, glass, trim } = useMemo(() => {
    const source = scene.getObjectByName(arch.model);
    const glass = createGlassMaterial(Math.round(arch.scale / 1.05), seedOf(p.role.id), new THREE.Vector3(p.x, PLAZA_Y, p.z), arch.scale);
    const trim = new THREE.MeshStandardMaterial({ color: p.accent, roughness: 0.35, metalness: 0.6, emissive: new THREE.Color(p.accent), emissiveIntensity: 0.15 });
    const base = new THREE.Color(BODY[p.role.kind] ?? PALETTE.platinum);
    if (p.squad) base.lerp(new THREE.Color(p.squad.color), 0.22);
    const body = bodyMaterial(`#${base.getHexString()}`);
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
  }, [scene, arch.model, arch.scale, p.role.id, p.role.kind, p.accent, p.squad, p.x, p.z]);

  const aura = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: auraVertex,
        fragmentShader: auraFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
        uniforms: { uColor: { value: new THREE.Color(PALETTE.amber) }, uOpacity: { value: 0 }, uTime: { value: 0 } },
      }),
    [],
  );

  // Shadows are baked, not re-rendered every frame (see StaticShadows): ask for a re-bake once this model is in.
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.shadowMap.needsUpdate = true;
  }, [gl, object]);
  useEffect(
    () => () => {
      glass.dispose();
      trim.dispose();
      aura.dispose();
    },
    [glass, trim, aura],
  );

  const targetWeights = useMemo(() => new THREE.Vector4(), []);
  activityWeights(activity, targetWeights);
  const activeColor = useMemo(() => new THREE.Color(), []);
  activeColor.set(active ? ACTIVITY_COLOR[activity] : p.accent);
  const beacon = useRef<THREE.MeshBasicMaterial>(null);
  const ring = useRef<THREE.MeshBasicMaterial>(null);
  const groundGlow = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((state, dt) => {
    const k = 1 - Math.exp(-dt * 3);
    const t = state.clock.elapsedTime;
    const flashAge = agent?.flashAt ? (performance.now() - agent.flashAt) / 1000 : 99;
    const flash = flashAge < 2.2 ? Math.max(0, 1 - flashAge / 2.2) * 0.8 : 0;
    const u = glassUniforms(glass);
    u.uTime.value = t;
    u.uWeights.value.lerp(targetWeights, k);
    u.uFlash.value = flash;
    const w = u.uWeights.value;
    const energy = Math.min(1, w.x + w.y + w.z + w.w);

    const glow = hover || selected || highlighted ? 1 : 0;
    trim.emissive.lerp(activeColor, k);
    trim.emissiveIntensity += (0.2 + energy * 2.2 + glow * 0.8 - trim.emissiveIntensity) * k;

    const au = aura.uniforms;
    au.uTime!.value = t;
    (au.uColor!.value as THREE.Color).lerp(activeColor, k);
    au.uOpacity!.value += ((active ? (activity === 'blocked' ? (REDUCED_MOTION ? 0.75 : 0.55 + 0.35 * Math.sin(t * 15)) : 0.5) : 0) - au.uOpacity!.value) * k;

    if (ring.current) ring.current.color.copy(activeColor).multiplyScalar(1 + energy * 1.5);
    if (groundGlow.current) groundGlow.current.opacity = energy * 0.55;
    if (beacon.current) {
      const blink = Math.sin(t * 2.2 + seedOf(p.role.id)) > 0.6 ? 1 : 0.25;
      // copy from Colors already parsed: Color.set(string) parsed a hex string every frame, per building
      beacon.current.color.copy(active ? activeColor : VERMILION).multiplyScalar(active ? 4 : 2.2 * blink);
    }
  });

  const pad = arch.footprint * 0.62 + 1.4;
  const verb = activityVerb(p.role.kind, activity);
  const focus = hover || selected;
  // Main towers (HQ, and the leads on the circle rim) always label themselves; squad members show an icon.
  // Nothing is ever hidden: where labels overlap, zIndexRange below decides which draws on top.
  const isMain = !p.squad || p.role.kind === 'lead';
  const mode = focus ? 'focus' : isMain ? (active ? 'card' : 'tag') : 'dot';
  const accent = active ? ACTIVITY_COLOR[activity] : p.accent;

  return (
    <group position={[p.x, 0, p.z]}>
      {/* raised plaza, an activity ring, and a pool of light when busy */}
      <mesh position-y={PLAZA_Y / 2} receiveShadow>
        <cylinderGeometry args={[pad, pad + 0.15, PLAZA_Y, 64]} />
        <meshStandardMaterial color={PALETTE.stone} roughness={0.9} />
      </mesh>
      <mesh position-y={PLAZA_Y + 0.005} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[pad - 0.15, 64]} />
        <meshBasicMaterial ref={groundGlow} color={activeColor} transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} {...decal} />
      </mesh>
      <mesh position-y={PLAZA_Y + 0.006} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[pad - 0.5, pad - 0.15, 72]} />
        <meshBasicMaterial ref={ring} color={p.accent} toneMapped={false} polygonOffset polygonOffsetFactor={-6} polygonOffsetUnits={-6} />
      </mesh>

      <primitive object={object} position-y={PLAZA_Y} scale={arch.scale} />

      {/* light column (only visible while active) */}
      <mesh visible={new URLSearchParams(location.search).get('aura') !== '0'} position-y={PLAZA_Y + arch.top * 0.6} material={aura} renderOrder={2}>
        <cylinderGeometry args={[arch.footprint * 0.62, arch.footprint * 0.62, arch.top * 1.2, 40, 1, true]} />
      </mesh>

      {/* Cheap invisible hit-box: picking against the detailed model costs ~20k triangle tests per mouse move. */}
      <mesh
        position-y={PLAZA_Y + arch.top / 2}
        onClick={(e: { stopPropagation(): void }) => {
          e.stopPropagation();
          select(selected ? undefined : p.role.id);
        }}
        onDoubleClick={(e: { stopPropagation(): void }) => {
          e.stopPropagation();
          select(p.role.id);
          camera({ kind: 'focus', target: [p.x, arch.top * 0.62, p.z] });
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
      <mesh position-y={PLAZA_Y + arch.top + 0.3}>
        <sphereGeometry args={[0.28, 12, 12]} />
        <meshBasicMaterial ref={beacon} toneMapped={false} />
      </mesh>

      {/* Fixed on-screen size; what it shows follows the role and activity (see mode). */}
      <Html
        key={mode} // drei only re-stacks on camera moves; remount to apply the new layer
        position={[0, PLAZA_Y + arch.top + 2, 0]}
        zIndexRange={focus ? [1400, 1300] : active ? [900, 500] : [400, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div className="label" style={{ ['--accent' as string]: accent }}>
          {mode === 'focus' || mode === 'card' ? (
            <div className={`card card--${activity} ${focus ? 'card--focus' : ''}`}>
              <div className="card__head">
                <span className="card__icon">
                  <RoleIcon kind={p.role.kind} size={15} />
                </span>
                <span className="card__role">
                  {p.role.title}
                  {p.squad && <span className="card__squad">{p.squad.name}</span>}
                </span>
              </div>
              <div className="card__verb">{verb}</div>
              {agent?.taskTitle && <div className="card__task">{agent.taskTitle}</div>}
              {active && agent?.summary && <div className="card__summary">{agent.summary}</div>}
              {active && (
                <div className="card__meta">
                  <span>{fmtElapsed(now - (agent?.since ?? now))}</span>
                  {!!agent?.costUsd && <span>${agent.costUsd.toFixed(2)}</span>}
                </div>
              )}
              {focus && <div className="card__hint">Double-click to fly here</div>}
            </div>
          ) : mode === 'tag' ? (
            <div className="tag">
              <RoleIcon kind={p.role.kind} size={12} />
              <span className="tag__text">
                {p.role.title}
                {p.squad && <span className="tag__squad">{p.squad.name}</span>}
              </span>
            </div>
          ) : (
            <div className={`dot ${active ? 'dot--active' : ''}`} title={p.squad ? `${p.role.title} · ${p.squad.name}` : p.role.title}>
              <RoleIcon kind={p.role.kind} size={13} />
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}
