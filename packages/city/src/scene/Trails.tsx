import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { CityLayout } from '../layout.ts';
import { PALETTE } from '../palette.ts';
import { TRAIL_LIFE_MS, useCity, type Trail } from '../store.ts';

const TRAVEL = 2.0;
/** Scratch position for the comet heads (copied out at once, so one is enough for all trails). */
const HEAD = new THREE.Vector3();
const LINGER = 2.5;
const REASON_COLOR: Record<string, string> = {
  'acceptance tests are red': PALETTE.ceruleanBright,
  'code review': PALETTE.lavender,
  escalation: PALETTE.vermilion,
  guidance: PALETTE.lavender,
  merged: PALETTE.green,
};

/** A bright comet that arcs between towers when work changes hands, leaving a fading ribbon. */
function Comet({ trail, layout }: { trail: Trail; layout: CityLayout }) {
  const head = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const ribbon = useRef<{ material: { opacity: number }; geometry: { instanceCount: number } }>(null);
  const color = REASON_COLOR[trail.reason] ?? PALETTE.amber;
  const hot = useMemo(() => new THREE.Color(color).multiplyScalar(4), [color]);

  const points = useMemo(() => {
    const a = layout.byId.get(trail.from);
    const b = layout.byId.get(trail.to);
    if (!a || !b) return undefined;
    const from = new THREE.Vector3(a.x, a.archetype.top * 0.9, a.z);
    const to = new THREE.Vector3(b.x, b.archetype.top * 0.9, b.z);
    const mid = from.clone().add(to).multiplyScalar(0.5);
    mid.y = Math.max(from.y, to.y) + from.distanceTo(to) * 0.35;
    return new THREE.QuadraticBezierCurve3(from, mid, to).getPoints(60);
  }, [trail, layout]);

  useFrame(() => {
    if (!points || !head.current) return;
    const age = (performance.now() - trail.at) / 1000;
    const t = Math.min(age / TRAVEL, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const idx = eased * (points.length - 1);
    const p = HEAD.copy(points[Math.floor(idx)]!).lerp(points[Math.min(Math.ceil(idx), points.length - 1)]!, idx % 1);
    head.current.position.copy(p);
    halo.current?.position.copy(p);
    head.current.visible = t < 1;
    if (halo.current) halo.current.visible = t < 1;
    if (ribbon.current) {
      ribbon.current.geometry.instanceCount = Math.max(1, Math.floor(eased * (points.length - 1)));
      ribbon.current.material.opacity = t < 1 ? 0.95 : Math.max(0, 0.95 * (1 - (age - TRAVEL) / LINGER));
    }
  });

  if (!points) return null;
  return (
    <group>
      <Line ref={ribbon as never} points={points} color={color} lineWidth={4} transparent opacity={0.95} toneMapped={false} />
      <mesh ref={head}>
        <sphereGeometry args={[0.55, 16, 16]} />
        <meshBasicMaterial color={hot} toneMapped={false} />
      </mesh>
      <mesh ref={halo}>
        <sphereGeometry args={[1.3, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.25} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

export function Trails({ layout }: { layout: CityLayout }) {
  const trails = useCity((s) => s.trails);
  const any = trails.length > 0;
  // Trails used to be dropped only when the next handoff arrived, so the last burst stayed mounted
  // (drawing, and running useFrame) indefinitely. Prune expired ones while any exist.
  useEffect(() => {
    if (!any) return;
    const id = setInterval(() => {
      const now = performance.now();
      useCity.setState((s) => {
        const kept = s.trails.filter((t) => now - t.at < TRAIL_LIFE_MS);
        return kept.length === s.trails.length ? s : { trails: kept };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [any]);
  return (
    <>
      {trails.map((t) => (
        <Comet key={t.id} trail={t} layout={layout} />
      ))}
    </>
  );
}
