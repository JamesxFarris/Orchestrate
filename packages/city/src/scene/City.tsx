import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { useMemo } from 'react';
import * as THREE from 'three';
import { layoutCity } from '../layout.ts';
import { PALETTE } from '../palette.ts';
import { useCity } from '../store.ts';
import { Building } from './Building.tsx';
import { Ground } from './Ground.tsx';
import { TechCircle } from './TechCircle.tsx';
import { Trails } from './Trails.tsx';
import { SUN_DIR } from './windowMaterial.ts';

/** Blue-hour sky: payne's gray overhead fading to a silver horizon with a warm sunset band. */
function Sky() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        toneMapped: false,
        fog: false,
        uniforms: {
          uTop: { value: new THREE.Color(PALETTE.skyTop) },
          uHorizon: { value: new THREE.Color(PALETTE.skyHorizon) },
          uGlow: { value: new THREE.Color(PALETTE.skyGlow) },
          uSun: { value: SUN_DIR.clone() },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGlow; uniform vec3 uSun;
          varying vec3 vDir;
          void main() {
            float h = clamp(vDir.y, 0.0, 1.0);
            vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
            float sun = max(dot(normalize(vec3(vDir.x, 0.0, vDir.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0);
            col = mix(col, uGlow, pow(sun, 3.0) * (1.0 - smoothstep(0.0, 0.35, h)) * 0.75);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    [],
  );
  return (
    <mesh material={material} renderOrder={-1}>
      <sphereGeometry args={[480, 32, 16]} />
    </mesh>
  );
}

export function City() {
  const team = useCity((s) => s.team);
  const anyActive = useCity((s) => Object.values(s.agents).some((a) => a.activity !== 'idle'));
  const select = useCity((s) => s.select);
  const layout = useMemo(() => (team ? layoutCity(team) : undefined), [team]);
  const sun = SUN_DIR.clone().multiplyScalar(120);

  return (
    <Canvas
      camera={{ position: [84, 70, 98], fov: 36, near: 0.5, far: 1200 }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance', toneMappingExposure: 1.05 }}
      onPointerMissed={() => select(undefined)}
    >
      <color attach="background" args={[PALETTE.skyHorizon]} />
      <fogExp2 attach="fog" args={[PALETTE.skyHorizon, 0.0021]} />
      <Sky />
      <hemisphereLight args={[PALETTE.platinum, PALETTE.onyx, 1.1]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[sun.x, sun.y, sun.z]} intensity={1.6} color="#ffd9b0" />
      <directionalLight position={[-sun.x, 40, -sun.z]} intensity={0.35} color="#9fc3d4" />

      {layout && (
        <>
          <Ground layout={layout} />
          <TechCircle layout={layout} />
          {layout.buildings.map((b) => (
            <Building key={b.role.id} p={b} />
          ))}
          <Trails layout={layout} />
        </>
      )}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        autoRotate={!anyActive}
        autoRotateSpeed={0.35}
        maxPolarAngle={Math.PI / 2.15}
        minDistance={20}
        maxDistance={240}
        target={[0, 7, 0]}
      />
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={0.9} luminanceThreshold={1.0} luminanceSmoothing={0.15} radius={0.7} />
        <Vignette offset={0.4} darkness={0.25} />
      </EffectComposer>
    </Canvas>
  );
}
