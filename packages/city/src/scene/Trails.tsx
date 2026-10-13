import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { CityLayout } from '../layout.ts';
import { useCity, type Trail } from '../store.ts';

const DURATION = 1.8;
const REASON_COLOR: Record<string, string> = {
  'acceptance tests are red': '#22d3ee',
  'code review': '#a78bfa',
  escalation: '#ef4444',
  merged: '#22c55e',
};

/** A comet that arcs from one tower to another when work changes hands. */
function Comet({ trail, layout }: { trail: Trail; layout: CityLayout }) {
  const head = useRef<THREE.Mesh>(null);
  const tail = useRef<THREE.Line>(null);
  const color = new THREE.Color(REASON_COLOR[trail.reason] ?? '#fbbf24').multiplyScalar(3);

  const curve = useMemo(() => {
    const a = layout.byId.get(trail.from);
    const b = layout.byId.get(trail.to);
    if (!a || !b) return undefined;
    const from = new THREE.Vector3(a.x, a.height * 0.85, a.z);
    const to = new THREE.Vector3(b.x, b.height * 0.85, b.z);
    const mid = from.clone().add(to).multiplyScalar(0.5);
    mid.y = Math.max(a.height, b.height) + from.distanceTo(to) * 0.25;
    return new THREE.QuadraticBezierCurve3(from, mid, to);
  }, [trail, layout]);

  const geometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(curve?.getPoints(48) ?? []), [curve]);

  useFrame(() => {
    if (!curve || !head.current || !tail.current) return;
    const t = Math.min((performance.now() - trail.at) / 1000 / DURATION, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    head.current.position.copy(curve.getPoint(eased));
    head.current.visible = t < 1;
    geometry.setDrawRange(0, Math.floor(eased * 49));
    (tail.current.material as THREE.LineBasicMaterial).opacity = t < 1 ? 0.7 : Math.max(0, 0.7 - (performance.now() - trail.at - DURATION * 1000) / 1500);
  });

  if (!curve) return null;
  return (
    <group>
      <mesh ref={head}>
        <sphereGeometry args={[0.35, 12, 12]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {/* @ts-expect-error three's <line> clashes with the SVG <line> JSX type */}
      <line ref={tail} geometry={geometry}>
        <lineBasicMaterial color={color} transparent opacity={0.7} toneMapped={false} />
      </line>
    </group>
  );
}

export function Trails({ layout }: { layout: CityLayout }) {
  const trails = useCity((s) => s.trails);
  return (
    <>
      {trails.map((t) => (
        <Comet key={t.id} trail={t} layout={layout} />
      ))}
    </>
  );
}
