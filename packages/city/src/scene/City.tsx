import { OrbitControls, Stars } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { useMemo } from 'react';
import { layoutCity } from '../layout.ts';
import { useCity } from '../store.ts';
import { Building } from './Building.tsx';
import { Ground } from './Ground.tsx';
import { TechCircle } from './TechCircle.tsx';
import { Trails } from './Trails.tsx';

export function City() {
  const team = useCity((s) => s.team);
  const anyActive = useCity((s) => Object.values(s.agents).some((a) => a.activity !== 'idle'));
  const select = useCity((s) => s.select);
  const layout = useMemo(() => (team ? layoutCity(team) : undefined), [team]);

  return (
    <Canvas
      camera={{ position: [78, 66, 92], fov: 36, near: 0.5, far: 900 }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onPointerMissed={() => select(undefined)}
    >
      <color attach="background" args={['#03050a']} />
      <fogExp2 attach="fog" args={['#03050a', 0.0085]} />
      <ambientLight intensity={0.25} color="#5b6b8c" />
      <directionalLight position={[40, 80, 20]} intensity={0.35} color="#8aa0ff" />
      <hemisphereLight args={['#1b2a4a', '#020306', 0.35]} />
      <Stars radius={260} depth={60} count={4000} factor={5} saturation={0} fade speed={0.4} />

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
        minDistance={18}
        maxDistance={220}
        target={[0, 6, 0]}
      />
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={1.15} luminanceThreshold={0.55} luminanceSmoothing={0.2} radius={0.75} />
        <Vignette offset={0.25} darkness={0.75} />
      </EffectComposer>
    </Canvas>
  );
}
