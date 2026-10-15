import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { PLATFORM_RADIUS } from '../layout.ts';
import { useCity } from '../store.ts';
import { dialogOpen } from '../ui/useDialog.ts';

export const CAMERA_LIMITS = {
  minDistance: 30,
  maxDistance: 320,
  /** Never lower than ~28° above the horizon: below that the HQ cluster stacks into a wall. */
  maxPolar: 1.08,
  minPolar: 0.02,
};

const UP = new THREE.Vector3(0, 1, 0);
// scratch objects for the per-frame update (one camera, so module-level is safe): no garbage at 60fps
const offset = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const move = new THREE.Vector3();
const goalOffset = new THREE.Vector3();
const flat = new THREE.Vector2();

/**
 * City-builder camera: glides to presets or a double-clicked tower (and gives control straight
 * back the moment you touch the mouse), WASD/arrows to pan across the ground, Q/E to rotate,
 * R/F to zoom, and the view target can never leave the island.
 */
export function CameraRig() {
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera);
  const cmd = useCity((s) => s.cameraCmd);
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const keys = useRef(new Set<string>());

  // presets and focus requests
  useEffect(() => {
    if (!cmd || !controls) return;
    const target = cmd.target ? new THREE.Vector3(...cmd.target) : new THREE.Vector3(0, cmd.kind === 'overview' ? 4 : 9, 0);
    const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    if (cmd.kind === 'overview') {
      sph.radius = 235;
      sph.phi = 0.2;
    } else if (cmd.kind === 'angled') {
      sph.radius = 190;
      sph.phi = 0.95;
    } else {
      sph.radius = 84;
      sph.phi = THREE.MathUtils.clamp(sph.phi, 0.55, 1.0);
    }
    goal.current = { target, pos: target.clone().add(new THREE.Vector3().setFromSpherical(sph)) };
  }, [cmd, controls, camera]);

  // grabbing the mouse cancels any glide
  useEffect(() => {
    if (!controls) return;
    const stop = () => (goal.current = null);
    controls.addEventListener('start', stop);
    return () => controls.removeEventListener('start', stop);
  }, [controls]);

  // keyboard
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      // typing, a shortcut, or a dialog in front of the city: not a camera move
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey || dialogOpen()) return;
      keys.current.add(e.code);
      goal.current = null;
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const clear = () => keys.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    };
  }, []);

  useFrame((_, dt) => {
    if (!controls) return;
    const k = keys.current;
    offset.copy(camera.position).sub(controls.target);

    if (k.size) {
      const dist = offset.length();
      forward.set(-offset.x, 0, -offset.z).normalize();
      right.crossVectors(forward, UP);
      move.set(0, 0, 0);
      if (k.has('KeyW') || k.has('ArrowUp')) move.add(forward);
      if (k.has('KeyS') || k.has('ArrowDown')) move.sub(forward);
      if (k.has('KeyD') || k.has('ArrowRight')) move.add(right);
      if (k.has('KeyA') || k.has('ArrowLeft')) move.sub(right);
      if (move.lengthSq()) {
        move.normalize().multiplyScalar(dist * 0.85 * dt);
        controls.target.add(move);
      }
      const turn = (k.has('KeyQ') ? 1 : 0) - (k.has('KeyE') ? 1 : 0);
      if (turn) offset.applyAxisAngle(UP, turn * 1.3 * dt);
      const zoom = (k.has('KeyF') ? 1 : 0) - (k.has('KeyR') ? 1 : 0);
      if (zoom) offset.setLength(THREE.MathUtils.clamp(dist * (1 + zoom * 1.3 * dt), CAMERA_LIMITS.minDistance, CAMERA_LIMITS.maxDistance));
    }

    const g = goal.current;
    if (g) {
      const s = 1 - Math.exp(-dt * 3.5);
      controls.target.lerp(g.target, s);
      goalOffset.copy(g.pos).sub(g.target);
      offset.lerp(goalOffset, s);
      if (controls.target.distanceTo(g.target) < 0.05 && offset.distanceTo(goalOffset) < 0.2) goal.current = null;
    }

    // keep the view over the island
    flat.set(controls.target.x, controls.target.z);
    const maxR = PLATFORM_RADIUS - 15;
    if (flat.length() > maxR) {
      flat.setLength(maxR);
      controls.target.x = flat.x;
      controls.target.z = flat.y;
    }
    controls.target.y = THREE.MathUtils.clamp(controls.target.y, 0, 40);

    if (k.size || g) {
      camera.position.copy(controls.target).add(offset);
      controls.update();
    }
  });

  return null;
}
