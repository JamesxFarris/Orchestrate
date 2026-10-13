import { Line, Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { CityLayout } from '../layout.ts';
import { PALETTE } from '../palette.ts';
import { useCity } from '../store.ts';

/** The ring plaza. Glows and links the master to every member while a plan review is in session. */
export function TechCircle({ layout }: { layout: CityLayout }) {
  const active = useCity((s) => s.circleActive);
  const team = useCity((s) => s.team);
  const ring = useRef<THREE.MeshBasicMaterial>(null);
  const inner = useRef<THREE.MeshBasicMaterial>(null);
  const level = useRef(0);

  useFrame((state, dt) => {
    level.current += ((active ? 1 : 0) - level.current) * (1 - Math.exp(-dt * 2.5));
    const pulse = 0.75 + 0.25 * Math.sin(state.clock.elapsedTime * 3);
    if (ring.current) ring.current.color.set(level.current > 0.02 ? PALETTE.ceruleanBright : PALETTE.platinum).multiplyScalar(0.85 + level.current * 2.2 * pulse);
    if (inner.current) inner.current.opacity = 0.12 + level.current * 0.22;
  });

  const r = layout.circleRadius;
  const master = layout.buildings.find((b) => b.role.kind === 'master');
  const members = (team?.techCircle ?? []).map((id) => layout.byId.get(id)).filter((b) => b && b !== master);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={0.05}>
        <ringGeometry args={[r - 0.35, r + 0.35, 128]} />
        <meshBasicMaterial ref={ring} toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
        <circleGeometry args={[r - 0.25, 96]} />
        <meshBasicMaterial ref={inner} color={PALETTE.cerulean} transparent opacity={0.12} toneMapped={false} />
      </mesh>
      <Text position={[0, 0.08, r + 2]} rotation-x={-Math.PI / 2} fontSize={1.1} letterSpacing={0.3} color={active ? PALETTE.cerulean : PALETTE.onyx} outlineWidth={0.04} outlineColor={PALETTE.platinum}>
        TECH CIRCLE{active ? ' · IN SESSION' : ''}
      </Text>
      {active &&
        master &&
        members.map((m) => (
          <Line
            key={m!.role.id}
            points={[
              [master.x, master.height * 0.6, master.z],
              [(master.x + m!.x) / 2, Math.max(master.height, m!.height) * 0.9, (master.z + m!.z) / 2],
              [m!.x, m!.height * 0.7, m!.z],
            ]}
            color={PALETTE.ceruleanBright}
            lineWidth={2}
            transparent
            opacity={0.85}
            toneMapped={false}
          />
        ))}
    </group>
  );
}
