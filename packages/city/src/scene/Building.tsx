import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Placement } from '../layout.ts';
import { PALETTE } from '../palette.ts';
import { ACTIVITY_COLOR, ACTIVITY_LABEL, useCity } from '../store.ts';
import type { Extra } from './archetypes.ts';
import { createFacadeMaterial } from './windowMaterial.ts';

const LIT: Record<string, number> = { idle: 0, working: 0.85, testing: 0.72, reviewing: 0.66, blocked: 0.92 };

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

const metal = { color: PALETTE.silver, metalness: 0.55, roughness: 0.35 } as const;

/** Rooftop details. Domes and crowns glow in the agent's activity colour. */
function ExtraPiece({ e, accent, glow }: { e: Extra; accent: string; glow: React.RefObject<THREE.MeshStandardMaterial[]> }) {
  const register = (m: THREE.MeshStandardMaterial | null) => {
    if (m && glow.current && !glow.current.includes(m)) glow.current.push(m);
  };
  switch (e.kind) {
    case 'spire':
      return (
        <group position-y={e.y}>
          <mesh position-y={e.h * 0.25}>
            <cylinderGeometry args={[0.9, 1.4, e.h * 0.5, 4]} />
            <meshStandardMaterial {...metal} />
          </mesh>
          <mesh position-y={e.h * 0.75}>
            <cylinderGeometry args={[0.08, 0.5, e.h * 0.5, 4]} />
            <meshStandardMaterial {...metal} color={PALETTE.platinum} />
          </mesh>
        </group>
      );
    case 'antenna':
      return (
        <mesh position-y={e.y + e.h / 2}>
          <cylinderGeometry args={[0.05, 0.12, e.h, 6]} />
          <meshStandardMaterial {...metal} />
        </mesh>
      );
    case 'crown':
      return (
        <mesh position-y={e.y + 0.35} rotation-x={Math.PI / 2}>
          <torusGeometry args={[e.r, 0.16, 10, 48]} />
          <meshStandardMaterial ref={register} color={PALETTE.platinum} emissive={accent} emissiveIntensity={0.4} metalness={0.4} roughness={0.3} />
        </mesh>
      );
    case 'helipad':
      return (
        <group position-y={e.y}>
          <mesh position-y={0.12}>
            <cylinderGeometry args={[e.r, e.r, 0.24, 32]} />
            <meshStandardMaterial color={PALETTE.onyx} roughness={0.8} />
          </mesh>
          <mesh position-y={0.25} rotation-x={-Math.PI / 2}>
            <ringGeometry args={[e.r * 0.62, e.r * 0.8, 32]} />
            <meshStandardMaterial ref={register} color={PALETTE.platinum} emissive={accent} emissiveIntensity={0.5} />
          </mesh>
        </group>
      );
    case 'dome':
      return (
        <mesh position-y={e.y}>
          <sphereGeometry args={[e.r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial ref={register} color={PALETTE.silver} emissive={accent} emissiveIntensity={0.25} metalness={0.3} roughness={0.25} />
        </mesh>
      );
    case 'hvac':
      return (
        <group position-y={e.y}>
          {[-0.28, 0, 0.28].map((fx, i) => (
            <mesh key={i} position={[fx * e.w, 0.45, (i % 2 ? 0.18 : -0.18) * e.d]}>
              <boxGeometry args={[1.1, 0.9, 1.1]} />
              <meshStandardMaterial color={PALETTE.silver} metalness={0.4} roughness={0.5} />
            </mesh>
          ))}
        </group>
      );
    case 'garden':
      return (
        <mesh position-y={e.y + 0.08}>
          <boxGeometry args={[e.w * 0.98, 0.16, e.d * 0.98]} />
          <meshStandardMaterial color="#7f9a6a" roughness={0.9} />
        </mesh>
      );
  }
}

export function Building({ p }: { p: Placement }) {
  const agent = useCity((s) => s.agents[p.role.id]);
  const selected = useCity((s) => s.selectedAgent === p.role.id);
  const highlighted = useCity((s) => !!s.highlightTask && s.agents[p.role.id]?.taskId === s.highlightTask);
  const select = useCity((s) => s.select);
  const [hover, setHover] = useState(false);

  const activity = agent?.activity ?? 'idle';
  const active = activity !== 'idle';
  const now = useTicker(active);
  const arch = p.archetype;

  const materials = useMemo(
    () =>
      arch.segments.map((s, i) =>
        createFacadeMaterial({
          size: [s.w, s.h, s.shape === 'cylinder' ? s.w : s.d],
          shape: s.shape,
          baseY: s.y,
          accent: p.accent,
          seed: seedOf(p.role.id) + i * 7,
          body: s.body,
          floorH: s.floorH,
          colW: s.colW,
        }),
      ),
    [arch, p.accent, p.role.id],
  );
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);

  const target = useRef({ lit: 0, color: new THREE.Color(ACTIVITY_COLOR.working) });
  target.current.lit = LIT[activity] ?? 0;
  if (active) target.current.color.set(ACTIVITY_COLOR[activity]);

  const beacon = useRef<THREE.MeshBasicMaterial>(null);
  const glow = useRef<THREE.MeshStandardMaterial[]>([]);
  const glowColor = useMemo(() => new THREE.Color(), []);

  useFrame((state, dt) => {
    const k = 1 - Math.exp(-dt * 3);
    const flashAge = agent?.flashAt ? (performance.now() - agent.flashAt) / 1000 : 99;
    const flash = flashAge < 2.2 ? Math.max(0, 1 - flashAge / 2.2) * 0.85 : 0;
    for (const m of materials) {
      const u = m.uniforms;
      u.uTime!.value = state.clock.elapsedTime;
      u.uLit!.value += (target.current.lit - u.uLit!.value) * k;
      (u.uColor!.value as THREE.Color).lerp(target.current.color, k);
      u.uPulse!.value += ((activity === 'blocked' ? 1 : 0) - u.uPulse!.value) * k;
      u.uHover!.value += ((hover || selected || highlighted ? 1 : 0) - u.uHover!.value) * k;
      u.uFlash!.value = flash;
    }
    const lit = materials[0]?.uniforms.uLit!.value as number;
    glowColor.copy(active ? target.current.color : new THREE.Color(p.accent));
    for (const g of glow.current) {
      g.emissive.copy(glowColor);
      g.emissiveIntensity = 0.3 + lit * 2.2 + (selected ? 0.4 : 0);
    }
    if (beacon.current) {
      const blink = Math.sin(state.clock.elapsedTime * 2.2 + seedOf(p.role.id)) > 0.6 ? 1 : 0.2;
      beacon.current.color.set(active ? ACTIVITY_COLOR[activity] : PALETTE.vermilion).multiplyScalar(active ? 3 : 2.2 * blink);
    }
  });

  const handlers = {
    onClick: (e: { stopPropagation(): void }) => {
      e.stopPropagation();
      select(selected ? undefined : p.role.id);
    },
    onPointerOver: (e: { stopPropagation(): void }) => {
      e.stopPropagation();
      setHover(true);
      document.body.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      setHover(false);
      document.body.style.cursor = '';
    },
  };

  const showCard = active || hover || selected;
  const labelY = arch.top + 1.6;

  return (
    <group position={[p.x, 0, p.z]}>
      {/* plaza + glow ring */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
        <circleGeometry args={[arch.footprint * 0.95, 48]} />
        <meshStandardMaterial color={PALETTE.silver} roughness={0.9} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.04}>
        <ringGeometry args={[arch.footprint * 0.95, arch.footprint * 1.08, 64]} />
        <meshBasicMaterial color={active ? ACTIVITY_COLOR[activity] : p.accent} transparent opacity={active ? 0.95 : selected ? 0.8 : 0.55} toneMapped={false} />
      </mesh>

      {arch.segments.map((s, i) => (
        <mesh key={i} position-y={s.y + s.h / 2} material={materials[i]} {...handlers}>
          {s.shape === 'box' ? <boxGeometry args={[s.w, s.h, s.d]} /> : <cylinderGeometry args={[s.w / 2, s.w / 2, s.h, s.sides ?? 24]} />}
        </mesh>
      ))}

      {arch.extras.map((e, i) => (
        <ExtraPiece key={i} e={e} accent={p.accent} glow={glow} />
      ))}

      <mesh position-y={arch.top + 0.25}>
        <sphereGeometry args={[0.24, 12, 12]} />
        <meshBasicMaterial ref={beacon} toneMapped={false} />
      </mesh>

      {showCard ? (
        <Html position={[0, labelY + 2.2, 0]} center distanceFactor={70} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
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
        <Html position={[0, labelY, 0]} center distanceFactor={70} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div className="tag" style={{ ['--accent' as string]: p.accent }}>
            {p.role.title}
          </div>
        </Html>
      )}
    </group>
  );
}
