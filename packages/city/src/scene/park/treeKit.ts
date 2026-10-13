import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from '../../palette.ts';
import { WAVE, WAVE_GLSL } from './wave.ts';

/** Low-poly park pieces, ~2-4 world units tall at scale 1. Base sits at y = 0. */
function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
  g.computeVertexNormals();
  parts.forEach((p) => p.dispose());
  return g;
}

function blob(r: number, x: number, y: number, z: number, sy = 1): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(r, 0).scale(1, sy, 1).translate(x, y, z);
}

export const TREE = {
  trunk: new THREE.CylinderGeometry(0.15, 0.24, 1.6, 6).translate(0, 0.8, 0),
  broadleaf: merged([blob(1.25, 0, 2.3, 0, 0.9), blob(0.85, 0.6, 2.85, 0.2), blob(0.8, -0.55, 2.75, -0.35), blob(0.7, 0.1, 3.2, -0.1)]),
  conifer: merged([
    new THREE.ConeGeometry(1.15, 1.8, 7).translate(0, 2.0, 0),
    new THREE.ConeGeometry(0.88, 1.5, 7).translate(0, 2.85, 0),
    new THREE.ConeGeometry(0.58, 1.2, 7).translate(0, 3.6, 0),
  ]),
  /** Leafless branches for escalated / failed work. */
  bare: merged([
    new THREE.CylinderGeometry(0.05, 0.09, 1.3, 5).rotateZ(0.7).translate(0.45, 2.0, 0),
    new THREE.CylinderGeometry(0.05, 0.09, 1.2, 5).rotateZ(-0.8).translate(-0.42, 1.9, 0.1),
    new THREE.CylinderGeometry(0.04, 0.08, 1.1, 5).rotateX(0.7).translate(0, 2.1, 0.38),
    new THREE.CylinderGeometry(0.04, 0.07, 0.9, 5).translate(0, 2.35, 0),
  ]),
  shrub: blob(0.95, 0, 0.55, 0, 0.72),
};

/**
 * Flat-shaded foliage that also catches the completion wave. Works for instanced meshes
 * (per-instance colour via setColorAt) and for single meshes.
 */
export function foliageMaterial(color?: string): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: color ?? '#ffffff', flatShading: true, roughness: 0.85, metalness: 0 });
  m.customProgramCacheKey = () => 'orchestrate-foliage-v1';
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, WAVE);
    shader.vertexShader = `varying vec3 vWorldP;\n${shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
  #ifdef USE_INSTANCING
    vWorldP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
    vWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif`,
    )}`;
    shader.fragmentShader = `varying vec3 vWorldP;\n${WAVE_GLSL}\n${shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uWaveColor * waveGlow(length(vWorldP.xz)) * 1.4;',
    )}`;
  };
  return m;
}

export const trunkMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.trunk, roughness: 0.9, flatShading: true });
