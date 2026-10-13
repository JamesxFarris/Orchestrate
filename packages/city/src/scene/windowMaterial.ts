import * as THREE from 'three';
import { PALETTE } from '../palette.ts';

export const SUN_DIR = new THREE.Vector3(-0.55, 0.62, 0.56).normalize();

export interface GlassUniforms {
  uFloors: { value: number };
  uOrigin: { value: THREE.Vector3 };
  uScale: { value: number };
  uSeed: { value: number };
  uColor: { value: THREE.Color };
  uFlashColor: { value: THREE.Color };
  uLit: { value: number };
  uTime: { value: number };
  uPulse: { value: number };
  uFlash: { value: number };
}

const HEADER = /* glsl */ `
  uniform float uFloors;
  uniform vec3 uOrigin;
  uniform float uScale;
  uniform float uSeed;
  uniform vec3 uColor;
  uniform vec3 uFlashColor;
  uniform float uLit;
  uniform float uTime;
  uniform float uPulse;
  uniform float uFlash;
  varying vec3 vObjPos;
  float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed * 13.37) * 43758.5453); }
`;

/**
 * Lights individual office "cells" of a model's glass. Cells are floors (object-space height) by
 * bays (angle around the tower's axis), so it works on any footprint: slabs, drums, clusters.
 */
const LIGHTS = /* glsl */ `
  vec3 lp = (vObjPos - uOrigin) / uScale;
  float floorIdx = floor(lp.y * uFloors);
  float bay = floor((atan(lp.z, lp.x) + 3.1415927) * 9.0 + (lp.x + lp.z) * 40.0);
  vec2 cell = vec2(bay, floorIdx);
  float h = gHash(cell);
  float drift = gHash(cell + floor(uTime * 0.5 + h * 9.0));
  float lit = mix(step(h, uLit), step(drift, uLit), 0.2);
  float pulse = mix(1.0, 0.4 + 0.6 * (0.5 + 0.5 * sin(uTime * 7.0)), uPulse);
  totalEmissiveRadiance += uColor * (1.05 + 0.5 * h) * pulse * lit + uFlashColor * 1.4 * uFlash;
`;

/** Reflective curtain-wall glass that lights up floor by floor while the agent works. */
/** `origin` = world position of the building base, `scale` = its height, so cells stay fixed to the facade. */
export function createGlassMaterial(floors: number, seed: number, origin: THREE.Vector3, scale: number): THREE.MeshStandardMaterial {
  const uniforms: GlassUniforms = {
    uFloors: { value: floors },
    uOrigin: { value: origin.clone() },
    uScale: { value: scale },
    uSeed: { value: seed },
    uColor: { value: new THREE.Color(PALETTE.amber) },
    uFlashColor: { value: new THREE.Color(PALETTE.green) },
    uLit: { value: 0 },
    uTime: { value: 0 },
    uPulse: { value: 0 },
    uFlash: { value: 0 },
  };
  const m = new THREE.MeshStandardMaterial({ color: PALETTE.glass, roughness: 0.15, metalness: 0.55, envMapIntensity: 0.8 });
  m.userData.uniforms = uniforms;
  m.customProgramCacheKey = () => 'orchestrate-glass-v1';
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `varying vec3 vObjPos;\n${shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vObjPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')}`;
    shader.fragmentShader = `${HEADER}\n${shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${LIGHTS}`)}`;
  };
  return m;
}

export const glassUniforms = (m: THREE.Material) => m.userData.uniforms as GlassUniforms;
