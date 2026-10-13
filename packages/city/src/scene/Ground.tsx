import { Billboard, Text } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import type { CityLayout } from '../layout.ts';
import { PALETTE } from '../palette.ts';

export const PLATFORM_RADIUS = 125;

/** Large stone pavers with joint lines and a little speckle, as a repeating texture. */
function usePavingTexture(): THREE.CanvasTexture {
  return useMemo(() => {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    g.fillStyle = PALETTE.ground;
    g.fillRect(0, 0, size, size);
    // per-slab tone variation
    const slab = size / 4;
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const shade = 0.96 + ((x * 7 + y * 13) % 5) * 0.012;
        const base = new THREE.Color(PALETTE.ground);
        g.fillStyle = `rgb(${Math.round(base.r * 255 * shade)}, ${Math.round(base.g * 255 * shade)}, ${Math.round(base.b * 255 * shade)})`;
        g.fillRect(x * slab + 2, y * slab + 2, slab - 4, slab - 4);
      }
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(70,73,76,${Math.random() * 0.06})`;
      g.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
    }
    g.strokeStyle = PALETTE.groundLine;
    g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      g.beginPath();
      g.moveTo(i * slab, 0);
      g.lineTo(i * slab, size);
      g.moveTo(0, i * slab);
      g.lineTo(size, i * slab);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(14, 14);
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
}

/** The city sits on a stone diorama platform; squad districts are slightly raised, tinted plazas. */
export function Ground({ layout }: { layout: CityLayout }) {
  const paving = usePavingTexture();
  return (
    <group>
      <mesh position-y={-1.5} receiveShadow>
        <cylinderGeometry args={[PLATFORM_RADIUS, PLATFORM_RADIUS + 1, 3, 128, 1, true]} />
        <meshStandardMaterial color={PALETTE.platformSide} roughness={0.8} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[PLATFORM_RADIUS, 128]} />
        <meshStandardMaterial map={paving} roughness={0.92} />
      </mesh>
      {/* bevelled lip */}
      <mesh position-y={0.05} rotation-x={Math.PI / 2}>
        <torusGeometry args={[PLATFORM_RADIUS, 0.35, 8, 160]} />
        <meshStandardMaterial color={PALETTE.silver} roughness={0.6} />
      </mesh>

      {layout.districts.map((d) => {
        const tint = new THREE.Color(PALETTE.ground).lerp(new THREE.Color(d.squad.color), 0.22);
        return (
          <group key={d.squad.id}>
            <mesh position={[d.x, 0.06, d.z]} receiveShadow>
              <cylinderGeometry args={[d.size + 3, d.size + 3.2, 0.12, 96]} />
              <meshStandardMaterial color={tint} roughness={0.85} />
            </mesh>
            <mesh position={[d.x, 0.121, d.z]} rotation-x={-Math.PI / 2}>
              <ringGeometry args={[d.size + 2.55, d.size + 2.95, 128]} />
              <meshBasicMaterial color={d.squad.color} toneMapped={false} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} />
            </mesh>
            <Billboard position={[d.x + Math.cos(d.angle) * (d.size + 5), 1.6, d.z + Math.sin(d.angle) * (d.size + 5)]}>
              <Text fontSize={1.5} letterSpacing={0.2} color={d.squad.color} outlineWidth={0.09} outlineColor="#ffffff">
                {d.squad.name.toUpperCase()}
              </Text>
            </Billboard>
          </group>
        );
      })}
    </group>
  );
}
