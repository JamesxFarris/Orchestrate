import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PALETTE } from '../../palette.ts';
import { useCity } from '../../store.ts';

/**
 * One set of uniforms shared by every park material, so a single number drives the
 * "the city glows" wave: a ring of green light expanding from HQ when a run completes.
 */
export const WAVE = {
  uWaveTime: { value: -1 }, // seconds since the wave started; < 0 = no wave
  uWaveColor: { value: new THREE.Color(PALETTE.green) },
};

export const WAVE_SPEED = 42; // world units per second
export const WAVE_GLSL = /* glsl */ `
  uniform float uWaveTime;
  uniform vec3 uWaveColor;
  // Glow at distance r from HQ: a bright travelling band plus a lingering afterglow behind it.
  float waveGlow(float r) {
    if (uWaveTime < 0.0) return 0.0;
    float front = uWaveTime * ${WAVE_SPEED.toFixed(1)};
    float d = (r - front) / 7.0; // never pow() a possibly-negative base: NaN on D3D
    float band = exp(-d * d);
    float after = step(r, front) * exp(-uWaveTime * 0.6) * 0.35;
    return (band + after) * (1.0 - smoothstep(4.0, 7.0, uWaveTime));
  }
`;

/** Advances the wave clock; mount once inside the Canvas. */
export function WaveDriver() {
  const waveAt = useCity((s) => s.waveAt);
  useFrame(() => {
    WAVE.uWaveTime.value = waveAt === undefined ? -1 : (performance.now() - waveAt) / 1000;
  });
  return null;
}
