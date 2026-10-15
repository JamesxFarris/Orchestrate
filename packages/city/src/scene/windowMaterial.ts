import * as THREE from 'three';
import { REDUCED_MOTION } from '../motion.ts';
import { PALETTE } from '../palette.ts';

export const SUN_DIR = new THREE.Vector3(-0.55, 0.62, 0.56).normalize();

/**
 * Per-activity weights (0..1, eased on the JS side) so each kind of work has its own signature:
 *   x working   — offices fill with warm light, flickering as people move
 *   y testing   — a bright scan line sweeps up and down the tower over a dim base
 *   z reviewing — the whole curtain wall breathes slowly
 *   w blocked   — hard red strobe
 */
export interface GlassUniforms {
  uFloors: { value: number };
  uOrigin: { value: THREE.Vector3 };
  uScale: { value: number };
  uSeed: { value: number };
  uWeights: { value: THREE.Vector4 };
  uWorking: { value: THREE.Color };
  uTesting: { value: THREE.Color };
  uReviewing: { value: THREE.Color };
  uBlocked: { value: THREE.Color };
  uFlashColor: { value: THREE.Color };
  uTime: { value: number };
  uFlash: { value: number };
}

const HEADER = /* glsl */ `
  uniform float uFloors;
  uniform vec3 uOrigin;
  uniform float uScale;
  uniform float uSeed;
  uniform vec4 uWeights;
  uniform vec3 uWorking;
  uniform vec3 uTesting;
  uniform vec3 uReviewing;
  uniform vec3 uBlocked;
  uniform vec3 uFlashColor;
  uniform float uTime;
  uniform float uFlash;
  varying vec3 vObjPos;
  float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed * 13.37) * 43758.5453); }
`;

const LIGHTS = /* glsl */ `
  vec3 lp = (vObjPos - uOrigin) / uScale;
  float floorIdx = floor(lp.y * uFloors);
  float bay = floor((atan(lp.z, lp.x + 1e-5) + 3.1415927) * 9.0 + (lp.x + lp.z) * 40.0);
  vec2 cell = vec2(bay, floorIdx);
  float h = gHash(cell);
  float drift = gHash(cell + floor(uTime * 0.7 + h * 9.0));

  // working: most offices on, a few flicker
  float office = mix(step(h, 0.82), step(drift, 0.82), 0.25);
  vec3 em = uWorking * office * (1.6 + 0.9 * h) * uWeights.x;

  // testing: dim base + a scan band travelling up and down
  float scanY = 0.5 + 0.5 * sin(uTime * 1.6);
  float band = 1.0 - smoothstep(0.0, 0.06, abs(lp.y - scanY));
  em += uTesting * (step(h, 0.45) * 0.7 + band * 3.2) * uWeights.y;

  // reviewing: the wall breathes as one
  float breathe = 0.55 + 0.45 * sin(uTime * 2.2);
  em += uReviewing * (0.5 + step(h, 0.7) * 1.2) * breathe * uWeights.z;

  // blocked: strobe
  float strobe = ${REDUCED_MOTION ? '0.5' : 'step(0.5, fract(uTime * 2.4))'};
  em += uBlocked * step(h, 0.9) * (0.4 + 2.4 * strobe) * uWeights.w;

  em += uFlashColor * 2.2 * uFlash;
  totalEmissiveRadiance += em;
`;

/** `origin` = world position of the building base, `scale` = its height, so cells stay fixed to the facade. */
export function createGlassMaterial(floors: number, seed: number, origin: THREE.Vector3, scale: number): THREE.MeshStandardMaterial {
  const uniforms: GlassUniforms = {
    uFloors: { value: floors },
    uOrigin: { value: origin.clone() },
    uScale: { value: scale },
    uSeed: { value: seed },
    uWeights: { value: new THREE.Vector4() },
    uWorking: { value: new THREE.Color(PALETTE.amber) },
    uTesting: { value: new THREE.Color(PALETTE.ceruleanBright) },
    uReviewing: { value: new THREE.Color(PALETTE.lavender) },
    uBlocked: { value: new THREE.Color(PALETTE.vermilion) },
    uFlashColor: { value: new THREE.Color(PALETTE.green) },
    uTime: { value: 0 },
    uFlash: { value: 0 },
  };
  const m = new THREE.MeshStandardMaterial({ color: PALETTE.glass, roughness: 0.15, metalness: 0.55, envMapIntensity: 0.8 });
  m.userData.uniforms = uniforms;
  m.customProgramCacheKey = () => 'orchestrate-glass-v2';
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `varying vec3 vObjPos;\n${shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vObjPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')}`;
    shader.fragmentShader = `${HEADER}\n${shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${LIGHTS}`)}`;
  };
  return m;
}

export const glassUniforms = (m: THREE.Material) => m.userData.uniforms as GlassUniforms;

const WEIGHT_INDEX = { working: 0, testing: 1, reviewing: 2, blocked: 3 } as const;

/** Target weight vector for an activity (all zero when idle). */
export function activityWeights(activity: string, out = new THREE.Vector4()): THREE.Vector4 {
  out.set(0, 0, 0, 0);
  const i = WEIGHT_INDEX[activity as keyof typeof WEIGHT_INDEX];
  if (i !== undefined) out.setComponent(i, 1);
  return out;
}
