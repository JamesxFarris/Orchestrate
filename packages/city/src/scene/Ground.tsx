import { Grid, Text } from '@react-three/drei';
import type { CityLayout } from '../layout.ts';

/** Night ground, roads from the circle to each district, and tinted district pads. */
export function Ground({ layout }: { layout: CityLayout }) {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.01} receiveShadow>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color="#04060b" roughness={0.95} />
      </mesh>
      <Grid
        position-y={0.005}
        args={[300, 300]}
        cellSize={2}
        cellThickness={0.5}
        cellColor="#0c1424"
        sectionSize={10}
        sectionThickness={0.9}
        sectionColor="#13213a"
        fadeDistance={170}
        fadeStrength={1.4}
        infiniteGrid
      />

      {layout.districts.map((d) => {
        const length = Math.hypot(d.x, d.z) - layout.circleRadius - d.size * 0.6;
        const mid = layout.circleRadius + length / 2;
        return (
          <group key={d.squad.id}>
            {/* road */}
            <group position={[Math.cos(d.angle) * mid, 0.015, Math.sin(d.angle) * mid]} rotation-y={-d.angle}>
              <mesh rotation-x={-Math.PI / 2}>
                <planeGeometry args={[Math.max(length, 1), 3.2]} />
                <meshStandardMaterial color="#0a0f1a" roughness={0.8} />
              </mesh>
              <mesh rotation-x={-Math.PI / 2} position-y={0.01}>
                <planeGeometry args={[Math.max(length, 1), 0.08]} />
                <meshBasicMaterial color={d.squad.color} transparent opacity={0.35} toneMapped={false} />
              </mesh>
            </group>
            {/* district pad */}
            <mesh rotation-x={-Math.PI / 2} position={[d.x, 0.012, d.z]}>
              <circleGeometry args={[d.size + 2, 64]} />
              <meshBasicMaterial color={d.squad.color} transparent opacity={0.05} toneMapped={false} />
            </mesh>
            <mesh rotation-x={-Math.PI / 2} position={[d.x, 0.014, d.z]}>
              <ringGeometry args={[d.size + 1.85, d.size + 2, 96]} />
              <meshBasicMaterial color={d.squad.color} transparent opacity={0.4} toneMapped={false} />
            </mesh>
            <Text
              position={[d.x + Math.cos(d.angle) * (d.size + 3.6), 0.05, d.z + Math.sin(d.angle) * (d.size + 3.6)]}
              rotation={[-Math.PI / 2, 0, -d.angle - Math.PI / 2]}
              fontSize={1.5}
              letterSpacing={0.25}
              color={d.squad.color}
              fillOpacity={0.85}
            >
              {d.squad.name.toUpperCase()}
            </Text>
          </group>
        );
      })}
    </group>
  );
}
