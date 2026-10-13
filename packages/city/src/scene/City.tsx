import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { Suspense, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { layoutCity } from '../layout.ts';
import { PALETTE } from '../palette.ts';
import { useCity } from '../store.ts';
import { Building } from './Building.tsx';
import { Ground, PLATFORM_RADIUS } from './Ground.tsx';
import { Links } from './Links.tsx';
import { TechCircle } from './TechCircle.tsx';
import { Trails } from './Trails.tsx';
import { SUN_DIR } from './windowMaterial.ts';

/** Golden-hour sky: deep cerulean overhead, warm platinum horizon, a peach glow toward the sun. */
function Sky() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
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
            float h = clamp(vDir.y, -0.2, 1.0);
            vec3 col = mix(uHorizon, uTop, pow(max(h, 0.0), 0.32));
            float sun = max(dot(normalize(vec3(vDir.x, 0.0, vDir.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0);
            col = mix(col, uGlow, pow(sun, 4.0) * (1.0 - smoothstep(0.0, 0.4, h)) * 0.85);
            col = mix(col, uHorizon * 0.92, smoothstep(0.0, -0.2, h));
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    [],
  );
  return (
    <mesh material={material} renderOrder={-1}>
      <sphereGeometry args={[700, 32, 16]} />
    </mesh>
  );
}

/** Nothing that casts a shadow moves, so render the shadow map on demand instead of every frame. */
function StaticShadows() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
  }, [gl]);
  return null;
}

/** Image-based lighting for glass reflections, generated locally (no HDR download). */
function Environment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.3;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

export function City() {
  const team = useCity((s) => s.team);
  const select = useCity((s) => s.select);
  const layout = useMemo(() => (team ? layoutCity(team) : undefined), [team]);
  const sun = SUN_DIR.clone().multiplyScalar(150);
  const reach = PLATFORM_RADIUS * 0.8;

  return (
    <Canvas
      shadows
      camera={{ position: [100, 78, 116], fov: 36, near: 1, far: 2000 }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onPointerMissed={() => select(undefined)}
    >
      <color attach="background" args={[PALETTE.skyHorizon]} />
      <fogExp2 attach="fog" args={[PALETTE.skyHorizon, 0.0016]} />
      <Sky />
      <Environment />
      <StaticShadows />
      <hemisphereLight args={['#dde8ee', '#6f675d', 0.55]} />
      <directionalLight
        position={[sun.x, sun.y, sun.z]}
        intensity={1.7}
        color="#ffdcb4"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-camera-left={-reach}
        shadow-camera-right={reach}
        shadow-camera-top={reach}
        shadow-camera-bottom={-reach}
        shadow-camera-near={1}
        shadow-camera-far={400}
      />
      <directionalLight position={[-sun.x, 50, -sun.z]} intensity={0.45} color="#a9c8d8" />

      {layout && (
        <>
          <Ground layout={layout} />
          <TechCircle layout={layout} />
          <Suspense fallback={null}>
            {layout.buildings.map((b) => (
              <Building key={b.role.id} p={b} />
            ))}
          </Suspense>
          <Links layout={layout} />
          <Trails layout={layout} />
        </>
      )}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        maxPolarAngle={Math.PI / 2.2}
        minDistance={25}
        maxDistance={260}
        target={[0, 9, 0]}
      />
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={1.1} luminanceThreshold={0.85} luminanceSmoothing={0.2} radius={0.7} />
        <Vignette offset={0.45} darkness={0.22} />
      </EffectComposer>
    </Canvas>
  );
}
