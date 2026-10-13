import { Billboard, Grid, Text } from '@react-three/drei';
import type { CityLayout } from '../layout.ts';
import { PALETTE } from '../palette.ts';

/** Concrete ground, asphalt avenues from the circle to each district, and tinted district plazas. */
export function Ground({ layout }: { layout: CityLayout }) {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.01}>
        <planeGeometry args={[900, 900]} />
        <meshStandardMaterial color={PALETTE.ground} roughness={0.95} />
      </mesh>
      <Grid
        position-y={0.005}
        args={[300, 300]}
        cellSize={3}
        cellThickness={0.45}
        cellColor="#68717a"
        sectionSize={15}
        sectionThickness={1}
        sectionColor="#7a848d"
        fadeDistance={220}
        fadeStrength={1.2}
        infiniteGrid
      />

      {layout.districts.map((d) => {
        const length = Math.hypot(d.x, d.z) - layout.circleRadius - d.size * 0.6;
        const mid = layout.circleRadius + length / 2;
        return (
          <group key={d.squad.id}>
            {/* avenue */}
            <group position={[Math.cos(d.angle) * mid, 0.015, Math.sin(d.angle) * mid]} rotation-y={-d.angle}>
              <mesh rotation-x={-Math.PI / 2}>
                <planeGeometry args={[Math.max(length, 1), 4.2]} />
                <meshStandardMaterial color={PALETTE.road} roughness={0.85} />
              </mesh>
              {Array.from({ length: Math.max(Math.floor(length / 3), 1) }, (_, i) => (
                <mesh key={i} rotation-x={-Math.PI / 2} position={[-length / 2 + 1.5 + i * 3, 0.01, 0]}>
                  <planeGeometry args={[1.4, 0.16]} />
                  <meshBasicMaterial color={PALETTE.platinum} toneMapped={false} />
                </mesh>
              ))}
            </group>
            {/* district plaza */}
            <mesh rotation-x={-Math.PI / 2} position={[d.x, 0.012, d.z]}>
              <circleGeometry args={[d.size + 3, 72]} />
              <meshStandardMaterial color={d.squad.color} transparent opacity={0.22} roughness={0.9} />
            </mesh>
            <mesh rotation-x={-Math.PI / 2} position={[d.x, 0.014, d.z]}>
              <ringGeometry args={[d.size + 2.7, d.size + 3, 96]} />
              <meshBasicMaterial color={d.squad.color} toneMapped={false} />
            </mesh>
            <Billboard position={[d.x + Math.cos(d.angle) * (d.size + 4.5), 1.6, d.z + Math.sin(d.angle) * (d.size + 4.5)]}>
            <Text
              fontSize={1.5}
              letterSpacing={0.2}
              color={d.squad.color}
              outlineWidth={0.08}
              outlineColor={PALETTE.platinum}
            >
              {d.squad.name.toUpperCase()}
            </Text>
            </Billboard>
          </group>
        );
      })}
    </group>
  );
}
