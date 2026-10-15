import { Billboard, Text } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import { PLATFORM_RADIUS, type CityLayout } from '../layout.ts';
import { PALETTE } from '../palette.ts';
import { districtPlazaRadius, PATH_WIDTH, type ParkLayout } from './park/parkLayout.ts';
import { WAVE, WAVE_GLSL } from './park/wave.ts';

/** One texture per repeat value, shared by every paved surface for the life of the page (a handful in all). */
const paving = new Map<number, THREE.CanvasTexture>();

/** Large stone pavers for plazas, as a repeating texture. */
export function usePavingTexture(repeat: number): THREE.CanvasTexture {
  return useMemo(() => {
    const cached = paving.get(repeat);
    if (cached) return cached;
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    const base = new THREE.Color(PALETTE.path);
    const slab = size / 4;
    g.fillStyle = '#b9b2a5';
    g.fillRect(0, 0, size, size);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const shade = 0.95 + ((x * 7 + y * 13) % 5) * 0.015;
        g.fillStyle = `rgb(${Math.round(base.r * 255 * shade)}, ${Math.round(base.g * 255 * shade)}, ${Math.round(base.b * 255 * shade)})`;
        g.fillRect(x * slab + 1.5, y * slab + 1.5, slab - 3, slab - 3);
      }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    paving.set(repeat, tex);
    return tex;
  }, [repeat]);
}

/** Lawn: mottled greens with faint mowing stripes, and the completion wave rolling across it. */
function useGrassMaterial(): THREE.MeshStandardMaterial {
  return useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: PALETTE.grassLight, roughness: 0.95 });
    const uniforms = { uDark: { value: new THREE.Color(PALETTE.grassDark) } };
    m.customProgramCacheKey = () => 'orchestrate-grass-v1';
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, WAVE, uniforms);
      shader.vertexShader = `varying vec3 vWorldP;\n${shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      )}`;
      shader.fragmentShader = `varying vec3 vWorldP;
        uniform vec3 uDark;
        ${WAVE_GLSL}
        float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        ${shader.fragmentShader
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
  vec2 gp = vWorldP.xz;
  float mottled = gNoise(gp * 0.045) * 0.6 + gNoise(gp * 0.17) * 0.3 + gNoise(gp * 0.9) * 0.1;
  diffuseColor.rgb = mix(uDark, diffuseColor.rgb, smoothstep(0.25, 0.8, mottled));
  diffuseColor.rgb *= 0.97 + 0.03 * step(0.5, fract(gp.x * 0.09));`,
          )
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uWaveColor * waveGlow(length(vWorldP.xz)) * 0.55;')}`;
    };
    return m;
  }, []);
}

/** A flat stone ribbon following a polyline (xz), slightly raised above the lawn. */
function ribbon(line: THREE.Vector2[], width: number, y: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let along = 0;
  for (let i = 0; i < line.length; i++) {
    const prev = line[Math.max(0, i - 1)]!;
    const next = line[Math.min(line.length - 1, i + 1)]!;
    const t = next.clone().sub(prev).normalize();
    const n = new THREE.Vector2(-t.y, t.x).multiplyScalar(width / 2);
    if (i > 0) along += line[i]!.distanceTo(line[i - 1]!);
    pos.push(line[i]!.x + n.x, y, line[i]!.y + n.y, line[i]!.x - n.x, y, line[i]!.y - n.y);
    uv.push(0, along / width, 1, along / width);
    if (i < line.length - 1) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Park ground: lawn on a stone platform, paved plazas, and footpaths linking every district to HQ. */
export function Ground({ layout, park }: { layout: CityLayout; park: ParkLayout }) {
  const grass = useGrassMaterial();
  const plazaPaving = usePavingTexture(14);
  const districtPaving = usePavingTexture(9);
  const pathPaving = usePavingTexture(1);
  const paths = useMemo(() => [...park.paths.values()].map((line) => ribbon(line, PATH_WIDTH, 0.045)), [park]);

  return (
    <group>
      <mesh position-y={-1.5} receiveShadow>
        <cylinderGeometry args={[PLATFORM_RADIUS, PLATFORM_RADIUS + 1, 3, 128, 1, true]} />
        <meshStandardMaterial color={PALETTE.platformSide} roughness={0.8} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} receiveShadow material={grass}>
        <circleGeometry args={[PLATFORM_RADIUS, 160]} />
      </mesh>
      <mesh position-y={0.05} rotation-x={Math.PI / 2}>
        <torusGeometry args={[PLATFORM_RADIUS, 0.45, 8, 180]} />
        <meshStandardMaterial color={PALETTE.stone} roughness={0.6} />
      </mesh>

      {/* central plaza: HQ, the Tech Circle and the squad leads */}
      <mesh position-y={0.05} receiveShadow>
        <cylinderGeometry args={[layout.plazaRadius, layout.plazaRadius + 0.2, 0.1, 128]} />
        <meshStandardMaterial map={plazaPaving} roughness={0.9} />
      </mesh>

      {paths.map((g, i) => (
        <mesh key={i} geometry={g} receiveShadow>
          <meshStandardMaterial map={pathPaving} roughness={0.9} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
        </mesh>
      ))}

      {layout.districts.map((d) => {
        const tint = new THREE.Color('#ffffff').lerp(new THREE.Color(d.squad.color), 0.18);
        const r = districtPlazaRadius(d.size);
        return (
          <group key={d.squad.id}>
            <mesh position={[d.x, 0.06, d.z]} receiveShadow>
              <cylinderGeometry args={[r, r + 0.2, 0.12, 96]} />
              <meshStandardMaterial color={tint} map={districtPaving} roughness={0.85} />
            </mesh>
            <mesh position={[d.x, 0.121, d.z]} rotation-x={-Math.PI / 2}>
              <ringGeometry args={[r - 0.45, r - 0.05, 128]} />
              <meshBasicMaterial color={d.squad.color} toneMapped={false} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} />
            </mesh>
            <Billboard position={[d.x + Math.cos(d.angle) * (r + 2.5), 1.8, d.z + Math.sin(d.angle) * (r + 2.5)]}>
              <Text fontSize={1.6} letterSpacing={0.2} color={d.squad.color} outlineWidth={0.1} outlineColor="#ffffff">
                {d.squad.name.toUpperCase()}
              </Text>
            </Billboard>
          </group>
        );
      })}
    </group>
  );
}
