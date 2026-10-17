// Builds the city's props from models the project owner supplied (in Models/, not committed):
//   61-low_poly_tree.zip      -> the broad-leaf scenery tree
//   73-street-lamp.zip        -> the street lamps along the footpaths
//
//   node tools/build-props.mjs
//
// Unzips each archive into Models/_extracted/ (gitignored), converts the OBJ files to glTF,
// drops what the city does not need (the lamp's ground plane), puts every model on
// the ground at the origin, and writes:
//   packages/city/public/models/props.glb   one node per part: tree_trunk, tree_leaves, lamp_body,
//                                           lamp_glass
//   packages/city/src/scene/props.json      sizes in world units, for the layout and its tests

import { Document, NodeIO } from '@gltf-transform/core';
import { dedup, prune, weld } from '@gltf-transform/functions';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import obj2gltf from 'obj2gltf';

const ROOT = join(import.meta.dirname, '..');
const MODELS = join(ROOT, 'Models');
const OUT_GLB = join(ROOT, 'packages/city/public/models/props.glb');
const OUT_JSON = join(ROOT, 'packages/city/src/scene/props.json');

const io = new NodeIO();

function extract(name) {
  const dir = join(MODELS, '_extracted', name);
  if (existsSync(dir)) return dir;
  const zip = join(MODELS, `${name}.zip`);
  if (!existsSync(zip)) throw new Error(`missing ${zip}`);
  mkdirSync(dir, { recursive: true });
  try {
    execFileSync('tar', ['-xf', zip, '-C', dir]); // bsdtar (Windows, macOS) reads zip
  } catch {
    execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
  }
  return dir;
}

const find = (dir, test) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const hit = find(p, test);
      if (hit) return hit;
    } else if (test(e.name)) return p;
  }
};

/** Every triangle of an OBJ, in world space, tagged with its mesh and material. */
async function readObj(file) {
  const doc = await io.readBinary(new Uint8Array(await obj2gltf(file, { binary: true })));
  const parts = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const nor = prim.getAttribute('NORMAL');
      const uv = prim.getAttribute('TEXCOORD_0');
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : pos.getCount();
      const out = { mesh: mesh.getName() || node.getName(), material: prim.getMaterial(), pos: [], nor: [], uv: [] };
      for (let i = 0; i < count; i++) {
        const v = idx ? idx.getScalar(i) : i;
        const [x, y, z] = pos.getElement(v, []);
        out.pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
        const [nx, ny, nz] = nor ? nor.getElement(v, []) : [0, 1, 0];
        out.nor.push(m[0] * nx + m[4] * ny + m[8] * nz, m[1] * nx + m[5] * ny + m[9] * nz, m[2] * nx + m[6] * ny + m[10] * nz);
        const [u, w] = uv ? uv.getElement(v, []) : [0, 0];
        out.uv.push(u, w);
      }
      parts.push(out);
    }
  }
  return parts;
}

function bounds(parts) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let i = 0; i < p.pos.length; i += 3) for (let a = 0; a < 3; a++) {
    min[a] = Math.min(min[a], p.pos[i + a]);
    max[a] = Math.max(max[a], p.pos[i + a]);
  }
  return { min, max, size: max.map((v, a) => v - min[a]) };
}

/** Move `parts` so (x, z) of `anchor` sits at the origin and the lowest point at y = 0, then scale. */
function place(parts, anchor, scale) {
  const all = bounds(parts);
  const ax = (anchor.min[0] + anchor.max[0]) / 2;
  const az = (anchor.min[2] + anchor.max[2]) / 2;
  for (const p of parts) for (let i = 0; i < p.pos.length; i += 3) {
    p.pos[i] = (p.pos[i] - ax) * scale;
    p.pos[i + 1] = (p.pos[i + 1] - all.min[1]) * scale;
    p.pos[i + 2] = (p.pos[i + 2] - az) * scale;
  }
}

// ---- output -----------------------------------------------------------------------------------------
const out = new Document();
const buffer = out.createBuffer();
const scene = out.createScene('props');
const materials = new Map();
const r2 = (v) => Math.round(v * 100) / 100;

function materialFor(src, name) {
  const key = name ?? src?.getName() ?? 'default';
  if (materials.has(key)) return materials.get(key);
  const m = out.createMaterial(key).setRoughnessFactor(0.8).setMetallicFactor(0).setBaseColorFactor(src?.getBaseColorFactor() ?? [1, 1, 1, 1]);
  const tex = src?.getBaseColorTexture();
  if (tex) m.setBaseColorTexture(out.createTexture(key).setImage(tex.getImage()).setMimeType(tex.getMimeType()));
  materials.set(key, m);
  return m;
}

/** One node holding `parts` merged into a single primitive. */
function emit(name, parts, material) {
  const cat = (k) => new Float32Array(parts.flatMap((p) => p[k]));
  const prim = out
    .createPrimitive()
    .setAttribute('POSITION', out.createAccessor().setType('VEC3').setArray(cat('pos')).setBuffer(buffer))
    .setAttribute('NORMAL', out.createAccessor().setType('VEC3').setArray(cat('nor')).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', out.createAccessor().setType('VEC2').setArray(cat('uv')).setBuffer(buffer))
    .setMaterial(material);
  scene.addChild(out.createNode(name).setMesh(out.createMesh(name).addPrimitive(prim)));
  const b = bounds(parts);
  return { width: r2(b.size[0]), height: r2(b.size[1]), depth: r2(b.size[2]) };
}

const manifest = {};

// ---- tree: unit height, centred on its trunk ---------------------------------------------------------
{
  const dir = extract('61-low_poly_tree');
  const parts = await readObj(find(dir, (n) => n.endsWith('.obj')));
  const trunk = parts.filter((p) => p.material?.getName() === 'Bark');
  const leaves = parts.filter((p) => p.material?.getName() !== 'Bark');
  place(parts, bounds(trunk), 1 / bounds(parts).size[1]);
  emit('tree_trunk', trunk, materialFor(trunk[0].material, 'tree_bark'));
  const canopy = emit('tree_leaves', leaves, materialFor(leaves[0].material, 'tree_leaves'));
  manifest.tree = { height: 1, canopyWidth: Math.max(canopy.width, canopy.depth) };
}

// ---- street lamp: unit height, pole at the origin, arm reaching along +x -----------------------------
{
  const dir = extract('73-street-lamp');
  const parts = (await readObj(find(dir, (n) => n.endsWith('.obj')))).filter((p) => !/^ground/i.test(p.mesh));
  const base = parts.filter((p) => /^Cube/i.test(p.mesh));
  place(parts, bounds(base), 1 / bounds(parts).size[1]);
  const glass = parts.filter((p) => p.material?.getName() === 'Glass');
  const body = parts.filter((p) => p.material?.getName() !== 'Glass');
  emit('lamp_body', body, materialFor(undefined, 'lamp_body'));
  emit('lamp_glass', glass, materialFor(undefined, 'lamp_glass'));
  // where the light is: the scene puts a glow there, and points the arm over the path
  const g = bounds(glass);
  manifest.lamp = { height: 1, head: { x: r2((g.min[0] + g.max[0]) / 2), y: r2(g.min[1]) } };
}

await out.transform(weld(), dedup(), prune());
await io.write(OUT_GLB, out);
writeFileSync(OUT_JSON, JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${OUT_GLB}`);
console.log(JSON.stringify(manifest));
