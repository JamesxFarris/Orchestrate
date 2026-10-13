import * as THREE from 'three';

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
 * Procedural office windows. `uLit` is the fraction of windows switched on (0 = lights off),
 * `uColor` their colour, `uPulse` a red alarm pulse, `uFlash` a green merge flash.
 */
const fragment = /* glsl */ `
  uniform vec3 uSize;
  uniform vec3 uColor;
  uniform vec3 uAccent;
  uniform float uLit;
  uniform float uTime;
  uniform float uSeed;
  uniform float uPulse;
  uniform float uFlash;
  uniform float uHover;
  varying vec3 vPos;
  varying vec3 vNormal;
  #include <fog_pars_fragment>

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed * 13.37) * 43758.5453);
  }

  void main() {
    vec3 n = abs(vNormal);
    vec3 body = vec3(0.028, 0.04, 0.07);
    float v = vPos.y + uSize.y * 0.5;

    if (n.y > 0.5) {
      gl_FragColor = vec4(body * 0.7, 1.0);
      #include <fog_fragment>
      return;
    }

    bool sideX = n.x > 0.5;
    float faceW = sideX ? uSize.z : uSize.x;
    float u = (sideX ? vPos.z : vPos.x) + faceW * 0.5;
    float faceId = sideX ? (vNormal.x > 0.0 ? 1.0 : 2.0) : (vNormal.z > 0.0 ? 3.0 : 4.0);

    float floorH = 0.95;
    float colW = 0.72;
    vec2 cell = vec2(floor(u / colW), floor(v / floorH));
    vec2 f = vec2(fract(u / colW), fract(v / floorH));
    float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.78);
    if (v < 1.4 || v > uSize.y - 0.7 || u < 0.35 || u > faceW - 0.35) win = 0.0;

    float h = hash(cell + faceId * 17.0);
    float drift = hash(cell + faceId * 3.0 + floor(uTime * 0.6 + h * 9.0));
    float lit = mix(step(h, uLit), step(drift, uLit), 0.22);
    float pulse = mix(1.0, 0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * 7.0)), uPulse);

    vec3 offWin = vec3(0.05, 0.07, 0.11) + 0.025 * h;
    vec3 onWin = uColor * (1.5 + 1.3 * h) * pulse;
    vec3 col = mix(offWin, onWin, lit);
    col = mix(col, vec3(0.2, 1.0, 0.45) * 2.6, uFlash);

    // Accent pinstripes at the corners and a crown band at the top.
    float edge = 1.0 - smoothstep(0.0, 0.08, min(u, faceW - u));
    float crown = smoothstep(uSize.y - 0.6, uSize.y - 0.45, v) * (1.0 - smoothstep(uSize.y - 0.3, uSize.y - 0.15, v));
    vec3 accent = uAccent * (0.35 + 0.9 * uLit + 0.6 * uHover);

    vec3 outc = mix(body + body * 0.5 * (v / uSize.y), col, win);
    outc += accent * max(edge * 0.6, crown);
    gl_FragColor = vec4(outc, 1.0);
    #include <fog_fragment>
  }
`;

export function createWindowMaterial(size: [number, number, number], accent: string, seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    fog: true,
    toneMapped: false,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uSize: { value: new THREE.Vector3(...size) },
        uColor: { value: new THREE.Color('#fbbf24') },
        uAccent: { value: new THREE.Color(accent) },
        uLit: { value: 0 },
        uTime: { value: 0 },
        uSeed: { value: seed },
        uPulse: { value: 0 },
        uFlash: { value: 0 },
        uHover: { value: 0 },
      },
    ]),
  });
}
