import { useGLTF } from '@react-three/drei';
import type * as THREE from 'three';
import manifest from './props.json';

/**
 * The project owner's models (tree, street lamp), built by tools/build-props.mjs into one
 * GLB. Every part sits on the ground at the origin at unit height, so
 * the scene scales and places them without guessing.
 */
export const PROPS_URL = `${import.meta.env.BASE_URL}models/props.glb`;
export const PROPS = manifest;

/** How tall a scenery tree stands at scale 1 (matches the procedural conifers). */
export const TREE_HEIGHT = 3.6;

useGLTF.preload(PROPS_URL);

/** A part's geometry by node name (tree_trunk, tree_leaves, lamp_body, lamp_glass). */
export function usePropGeometry(): (name: string) => THREE.BufferGeometry {
  const { nodes } = useGLTF(PROPS_URL);
  return (name) => {
    const mesh = nodes[name] as THREE.Mesh | undefined;
    if (!mesh) throw new Error(`props.glb has no part "${name}"; run node tools/build-props.mjs`);
    return mesh.geometry;
  };
}
