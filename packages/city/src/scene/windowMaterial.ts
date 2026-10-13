import * as THREE from 'three';
import { PALETTE } from '../palette.ts';

const vertex = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormal;
  #include <fog_pars_vertex>
  void main() {
    vPos = position;
    vNormal = normal;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

/**
 * Lit facade with procedural windows for box and cylindrical (round / hex) segments.
 * `uLit` = fraction of windows switched on, `uColor` their colour, `uPulse` an alarm pulse,
 * `uFlash` the merge flash. The body is shaded by a warm low sun plus a sky fill.
 */
const fragment = /* glsl */ `
  uniform vec3 uSize;       // width, height, depth (cylinders: diameter, height, diameter)
  uniform float uShape;     // 0 = box, 1 = cylinder
  uniform float uBaseY;     // segment's height above ground, so floors line up across tiers
  uniform vec3 uBody;
  uniform vec3 uGlassLow;
  uniform vec3 uGlassHigh;
  uniform vec3 uColor;
  uniform vec3 uAccent;
  uniform vec3 uFlashColor;
  uniform vec3 uLightDir;
  uniform float uLit;
  uniform float uTime;
  uniform float uSeed;
  uniform float uPulse;
  uniform float uFlash;
  uniform float uHover;
  uniform float uFloorH;
  uniform float uColW;
  varying vec3 vPos;
  varying vec3 vNormal;
  #include <fog_pars_fragment>

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed * 13.37) * 43758.5453);
  }

  void main() {
    vec3 n = normalize(vNormal);
    float diffuse = max(dot(n, normalize(uLightDir)), 0.0);
    float sky = 0.5 + 0.5 * n.y;
    vec3 body = uBody * (0.62 + 0.55 * diffuse + 0.18 * sky);
    float v = vPos.y + uSize.y * 0.5;

    if (n.y > 0.6) {
      gl_FragColor = vec4(uBody * 0.95 + uAccent * 0.08 * (1.0 + uHover), 1.0);
      #include <fog_fragment>
      return;
    }

    float faceW;
    float u;
    float faceId;
    if (uShape > 0.5) {
      float r = uSize.x * 0.5;
      faceW = 6.2831853 * r;
      u = (atan(vPos.z, vPos.x) + 3.1415927) * r;
      faceId = 1.0;
    } else {
      bool sideX = abs(n.x) > 0.5;
      faceW = sideX ? uSize.z : uSize.x;
      u = (sideX ? vPos.z : vPos.x) + faceW * 0.5;
      faceId = sideX ? (n.x > 0.0 ? 1.0 : 2.0) : (n.z > 0.0 ? 3.0 : 4.0);
    }

    float gy = v + uBaseY;
    vec2 cell = vec2(floor(u / uColW), floor(gy / uFloorH));
    vec2 f = vec2(fract(u / uColW), fract(gy / uFloorH));
    float win = step(0.16, f.x) * step(f.x, 0.84) * step(0.24, f.y) * step(f.y, 0.8);
    if (gy < 1.3 || v > uSize.y - 0.55) win = 0.0;
    if (uShape < 0.5 && (u < 0.3 || u > faceW - 0.3)) win = 0.0;

    float h = hash(cell + faceId * 17.0);
    float drift = hash(cell + faceId * 3.0 + floor(uTime * 0.6 + h * 9.0));
    float lit = mix(step(h, uLit), step(drift, uLit), 0.22);
    float pulse = mix(1.0, 0.5 + 0.5 * (0.5 + 0.5 * sin(uTime * 7.0)), uPulse);

    // Unlit glass reflects the dusk sky: darker low, brighter high, brighter on the sun side.
    vec3 glass = mix(uGlassLow, uGlassHigh, clamp(gy / 34.0, 0.0, 1.0)) * (0.75 + 0.35 * diffuse) + 0.05 * h;
    vec3 onWin = uColor * (1.55 + 1.1 * h) * pulse;
    vec3 col = mix(glass, onWin, lit);
    col = mix(col, uFlashColor * 2.4, uFlash);

    // Accent mullions at the corners and a crown band under the roofline.
    float edge = uShape > 0.5 ? 0.0 : 1.0 - smoothstep(0.0, 0.1, min(u, faceW - u));
    float crown = smoothstep(uSize.y - 0.5, uSize.y - 0.38, v) * (1.0 - smoothstep(uSize.y - 0.22, uSize.y - 0.1, v));
    vec3 accent = uAccent * (0.55 + 0.9 * uLit + 0.7 * uHover);

    vec3 outc = mix(body, col, win);
    outc = mix(outc, accent, clamp(max(edge * 0.75, crown), 0.0, 1.0));
    gl_FragColor = vec4(outc, 1.0);
    #include <fog_fragment>
  }
`;

export interface FacadeOptions {
  size: [number, number, number];
  shape: 'box' | 'cylinder';
  baseY: number;
  accent: string;
  seed: number;
  body?: string;
  floorH?: number;
  colW?: number;
}

export const SUN_DIR = new THREE.Vector3(-0.55, 0.45, 0.7).normalize();

export function createFacadeMaterial(o: FacadeOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    fog: true,
    toneMapped: false,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uSize: { value: new THREE.Vector3(...o.size) },
        uShape: { value: o.shape === 'cylinder' ? 1 : 0 },
        uBaseY: { value: o.baseY },
        uBody: { value: new THREE.Color(o.body ?? PALETTE.onyx) },
        uGlassLow: { value: new THREE.Color(PALETTE.glassLow) },
        uGlassHigh: { value: new THREE.Color(PALETTE.glassHigh) },
        uColor: { value: new THREE.Color(PALETTE.amber) },
        uAccent: { value: new THREE.Color(o.accent) },
        uFlashColor: { value: new THREE.Color(PALETTE.green) },
        uLightDir: { value: SUN_DIR.clone() },
        uLit: { value: 0 },
        uTime: { value: 0 },
        uSeed: { value: o.seed },
        uPulse: { value: 0 },
        uFlash: { value: 0 },
        uHover: { value: 0 },
        uFloorH: { value: o.floorH ?? 0.95 },
        uColW: { value: o.colW ?? 0.72 },
      },
    ]),
  });
}
