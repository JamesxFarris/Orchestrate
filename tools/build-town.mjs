// Builds the growing town's pieces from Kenney kits (all CC0, kenney.nl):
//   City Kit Commercial, Car Kit, City Kit Roads, Graveyard Kit, Nature Kit
//
//   1. Download the kits and unzip each into Models/kenney-packs/<name>/ (see the README)
//   2. node tools/build-town.mjs
//
// Picks the pieces the city uses, stands each on the ground at the origin, scales every kit into
// the city's units (one scale per kit, so a kit's pieces keep their proportions to each other), and
// writes packages/city/public/models/town.glb (one node per piece, one child mesh per material,
// ready for instancing) and packages/city/src/scene/settlement/town.json (sizes in world units).

import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMaterialsEmissiveStrength, KHRTextureTransform } from '@gltf-transform/extensions';
import { dedup, prune, weld } from '@gltf-transform/functions';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const PACKS = join(ROOT, 'Models/kenney-packs');
const OUT_GLB = join(ROOT, 'packages/city/public/models/town.glb');
const OUT_JSON = join(ROOT, 'packages/city/src/scene/settlement/town.json');

/** Per kit: where its GLBs are, its scale into city units, and the pieces we use (file name -> our name). */
const KITS = [
  {
    dir: 'city-kit-commercial/Models/GLB format',
    scale: 4,
    pieces: Object.fromEntries([
      ...'abcdefghijklmn'.split('').map((l) => [`building-${l}`, `shop_${l}`]),
      ...'abcde'.split('').map((l) => [`building-skyscraper-${l}`, `tower_${l}`]),
      ['detail-parasol-a', 'parasol_a'],
      ['detail-parasol-b', 'parasol_b'],
    ]),
  },
  {
    dir: 'car-kit/Models/GLB format',
    scale: 0.9,
    pieces: Object.fromEntries(['sedan', 'suv', 'hatchback-sports', 'taxi', 'police', 'van', 'delivery', 'truck', 'ambulance', 'garbage-truck'].map((n) => [n, `car_${n.replace(/-/g, '_')}`])),
  },
  {
    dir: 'city-kit-roads/Models/GLB format',
    scale: 6.5,
    pieces: { 'light-curved': 'streetlight', 'light-square-double': 'streetlight_double', 'traffic-light': 'traffic_light' },
  },
  {
    dir: 'graveyard-kit/Models/GLB format',
    scale: 1.7,
    pieces: { bench: 'bench', 'pillar-square': 'pillar', 'column-large': 'column', 'urn-round': 'urn' },
  },
  {
    dir: 'nature-kit/Models/GLTF format',
    scale: 2.4,
    pieces: Object.fromEntries([
      ...['flower_purpleA', 'flower_redA', 'flower_yellowA', 'flower_purpleB', 'flower_redB', 'flower_yellowB'].map((n) => [n, n.toLowerCase()]),
      ['plant_bushDetailed', 'bush'],
      ['plant_bushLarge', 'bush_large'],
      ['pot_large', 'planter'],
      ['statue_column', 'statue_column'],
      ['statue_obelisk', 'statue_obelisk'],
      ['statue_head', 'statue_head'],
      ['statue_ring', 'statue_ring'],
      ['tree_oak', 'tree_oak'],
      ['tree_default', 'tree_round'],
      ['tree_cone', 'tree_cone'],
      ['tree_oak_fall', 'tree_oak_autumn'],
      ['tree_detailed_fall', 'tree_detailed_autumn'],
    ]),
  },
];

const io = new NodeIO().registerExtensions([KHRTextureTransform, KHRMaterialsEmissiveStrength]);
const out = new Document();
const buffer = out.createBuffer();
const scene = out.createScene('town');
const materials = new Map(); // source material -> output material
const textures = new Map(); // source image bytes -> output texture
const r2 = (v) => Math.round(v * 100) / 100;

function copyMaterial(src) {
  if (materials.has(src)) return materials.get(src);
  const m = out.createMaterial(src.getName()).setBaseColorFactor(src.getBaseColorFactor()).setRoughnessFactor(0.85).setMetallicFactor(0);
  const tex = src.getBaseColorTexture();
  if (tex) {
    // each kit has its own colormap: share one texture per distinct image
    const key = Buffer.from(tex.getImage()).toString('base64');
    if (!textures.has(key)) textures.set(key, out.createTexture(src.getName()).setImage(tex.getImage()).setMimeType(tex.getMimeType() || 'image/png'));
    m.setBaseColorTexture(textures.get(key));
  }
  if (src.getEmissiveFactor().some((v) => v > 0)) m.setEmissiveFactor(src.getEmissiveFactor());
  materials.set(src, m);
  return m;
}

const manifest = {};
for (const kit of KITS) {
  const dir = join(PACKS, kit.dir);
  if (!existsSync(dir)) throw new Error(`missing ${dir}: download and unzip the Kenney kits into Models/kenney-packs (see the README)`);
  for (const [file, name] of Object.entries(kit.pieces)) {
    const doc = await io.read(join(dir, `${file}.glb`));
    // gather triangles per material, in world space
    const buckets = new Map();
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (!mesh) continue;
      const m = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const mat = prim.getMaterial();
        if (!buckets.has(mat)) buckets.set(mat, { pos: [], nor: [], uv: [] });
        const b = buckets.get(mat);
        const pos = prim.getAttribute('POSITION');
        const nor = prim.getAttribute('NORMAL');
        const uv = prim.getAttribute('TEXCOORD_0');
        const idx = prim.getIndices();
        const count = idx ? idx.getCount() : pos.getCount();
        for (let i = 0; i < count; i++) {
          const v = idx ? idx.getScalar(i) : i;
          const [x, y, z] = pos.getElement(v, []);
          b.pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
          const [nx, ny, nz] = nor ? nor.getElement(v, []) : [0, 1, 0];
          const l = Math.hypot(m[0] * nx + m[4] * ny + m[8] * nz, m[1] * nx + m[5] * ny + m[9] * nz, m[2] * nx + m[6] * ny + m[10] * nz) || 1;
          b.nor.push((m[0] * nx + m[4] * ny + m[8] * nz) / l, (m[1] * nx + m[5] * ny + m[9] * nz) / l, (m[2] * nx + m[6] * ny + m[10] * nz) / l);
          const [u, w] = uv ? uv.getElement(v, []) : [0, 0];
          b.uv.push(u, w);
        }
      }
    }
    // stand it on the ground, centred on its footprint, then scale into city units
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const b of buckets.values()) for (let i = 0; i < b.pos.length; i += 3) for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], b.pos[i + a]);
      max[a] = Math.max(max[a], b.pos[i + a]);
    }
    const cx = (min[0] + max[0]) / 2;
    const cz = (min[2] + max[2]) / 2;
    const parent = out.createNode(name);
    scene.addChild(parent);
    let part = 0;
    for (const [mat, b] of buckets) {
      for (let i = 0; i < b.pos.length; i += 3) {
        b.pos[i] = (b.pos[i] - cx) * kit.scale;
        b.pos[i + 1] = (b.pos[i + 1] - min[1]) * kit.scale;
        b.pos[i + 2] = (b.pos[i + 2] - cz) * kit.scale;
      }
      const prim = out
        .createPrimitive()
        .setAttribute('POSITION', out.createAccessor().setType('VEC3').setArray(new Float32Array(b.pos)).setBuffer(buffer))
        .setAttribute('NORMAL', out.createAccessor().setType('VEC3').setArray(new Float32Array(b.nor)).setBuffer(buffer))
        .setAttribute('TEXCOORD_0', out.createAccessor().setType('VEC2').setArray(new Float32Array(b.uv)).setBuffer(buffer))
        .setMaterial(mat ? copyMaterial(mat) : out.createMaterial('default'));
      parent.addChild(out.createNode(`${name}_${part}`).setMesh(out.createMesh(`${name}_${part++}`).addPrimitive(prim)));
    }
    manifest[name] = { width: r2((max[0] - min[0]) * kit.scale), depth: r2((max[2] - min[2]) * kit.scale), height: r2((max[1] - min[1]) * kit.scale), parts: part };
  }
}

await out.transform(weld(), dedup(), prune());
await io.write(OUT_GLB, out);
writeFileSync(OUT_JSON, JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${OUT_GLB} (${Object.keys(manifest).length} pieces, ${textures.size} textures)`);
