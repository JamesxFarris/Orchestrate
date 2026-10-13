import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Placement } from '../layout.ts';
import { ACTIVITY_COLOR, ACTIVITY_LABEL, useCity } from '../store.ts';
import { createWindowMaterial } from './windowMaterial.ts';

const LIT: Record<string, number> = { idle: 0, working: 0.82, testing: 0.7, reviewing: 0.62, blocked: 0.9 };

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

export function Building({ p }: { p: Placement }) {
  const agent = useCity((s) => s.agents[p.role.id]);
  const selected = useCity((s) => s.selectedAgent === p.role.id);
  const highlighted = useCity((s) => !!s.highlightTask && s.agents[p.role.id]?.taskId === s.highlightTask);
  const select = useCity((s) => s.select);
  const [hover, setHover] = useState(false);

  const activity = agent?.activity ?? 'idle';
  const active = activity !== 'idle';
  const now = useTicker(active);

  const size: [number, number, number] = [p.width, p.height, p.width];
  const material = useMemo(() => createWindowMaterial(size, p.accent, seedOf(p.role.id)), [p.role.id, p.accent, p.width, p.height]);
  useEffect(() => () => material.dispose(), [material]);

  const target = useRef({ lit: 0, color: new THREE.Color(ACTIVITY_COLOR.working) });
  target.current.lit = LIT[activity] ?? 0;
  if (active) target.current.color.set(ACTIVITY_COLOR[activity]);

  const beacon = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((state, dt) => {
    const u = material.uniforms;
    const k = 1 - Math.exp(-dt * 3);
    u.uTime!.value = state.clock.elapsedTime;
    u.uLit!.value += (target.current.lit - u.uLit!.value) * k;
    (u.uColor!.value as THREE.Color).lerp(target.current.color, k);
    u.uPulse!.value += ((activity === 'blocked' ? 1 : 0) - u.uPulse!.value) * k;
    u.uHover!.value += ((hover || selected || highlighted ? 1 : 0) - u.uHover!.value) * k;
    const flashAge = agent?.flashAt ? (performance.now() - agent.flashAt) / 1000 : 99;
    u.uFlash!.value = flashAge < 2.2 ? Math.max(0, 1 - flashAge / 2.2) * 0.85 : 0;
    if (beacon.current) {
      const blink = Math.sin(state.clock.elapsedTime * 2.2 + seedOf(p.role.id)) > 0.6 ? 1 : 0.15;
      beacon.current.color.set(active ? ACTIVITY_COLOR[activity] : '#ef4444').multiplyScalar(active ? 3 : 2 * blink);
    }
  });

  const tall = p.role.tier === 'exec' || p.role.tier === 'principal';
  const showCard = active || hover || selected;

  return (
    <group position={[p.x, 0, p.z]}>
      {/* plinth glow */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
        <ringGeometry args={[p.width * 0.75, p.width * 0.95, 48]} />
        <meshBasicMaterial color={p.accent} transparent opacity={active ? 0.55 : selected ? 0.4 : 0.12} toneMapped={false} />
      </mesh>

      <mesh
        position-y={p.height / 2}
        material={material}
        onClick={(e) => {
          e.stopPropagation();
          select(selected ? undefined : p.role.id);
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
        <boxGeometry args={size} />
      </mesh>

      {/* roof cap + mast */}
      <mesh position-y={p.height + 0.15}>
        <boxGeometry args={[p.width * 0.7, 0.3, p.width * 0.7]} />
        <meshStandardMaterial color="#0b1220" metalness={0.6} roughness={0.4} />
      </mesh>
      {tall && (
        <mesh position-y={p.height + 2}>
          <cylinderGeometry args={[0.06, 0.1, 3.4, 6]} />
          <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.3} />
        </mesh>
      )}
      <mesh position-y={p.height + (tall ? 3.8 : 0.5)}>
        <sphereGeometry args={[tall ? 0.22 : 0.16, 12, 12]} />
        <meshBasicMaterial ref={beacon} toneMapped={false} />
      </mesh>

      {showCard ? (
        <Html position={[0, p.height + (tall ? 5.5 : 2.6), 0]} center distanceFactor={60} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
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
        <Html position={[0, p.height + (tall ? 5 : 1.8), 0]} center distanceFactor={60} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div className="tag">{p.role.title}</div>
        </Html>
      )}
    </group>
  );
}
