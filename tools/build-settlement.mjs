// Builds the settlement models (houses and props) from Kenney's Fantasy Town Kit 2.0 (CC0).
//
//   1. Download https://kenney.nl/assets/fantasy-town-kit and unzip it into
//      Models/kenney_fantasy-town-kit/src  (so Models/kenney_fantasy-town-kit/src/Models/GLB format exists)
//   2. node tools/build-settlement.mjs
//
// The kit is modular (single wall and roof tiles on a 1-unit grid), so this script assembles whole
// houses from those tiles. Each house becomes two meshes: `<name>_body` and `<name>_roof`, so the
// city can tint only the roof in the squad's colour. Texture coordinates are remapped to recolour the
// kit's lavender plaster cream and its roofs a neutral white (to take the tint); no image is edited.
// Writes packages/city/public/models/settlement.glb and packages/city/src/scene/settlement/kit.json
// (sizes in world units, so the layout and its tests know each model's footprint).

import { Document, NodeIO } from '@gltf-transform/core';
import { KHRTextureTransform } from '@gltf-transform/extensions';
import { dedup, prune, weld } from '@gltf-transform/functions';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'Models/kenney_fantasy-town-kit/src/Models/GLB format');
const OUT_GLB = join(ROOT, 'packages/city/public/models/settlement.glb');
const OUT_JSON = join(ROOT, 'packages/city/src/scene/settlement/kit.json');

/** World units per kit tile. */
const SCALE = 1.4;

if (!existsSync(SRC)) {
  console.error(`Kit not found at ${SRC}\nDownload https://kenney.nl/assets/fantasy-town-kit and unzip it into Models/kenney_fantasy-town-kit/src`);
  process.exit(1);
}

const io = new NodeIO().registerExtensions([KHRTextureTransform]);

// ---- atlas remap ------------------------------------------------------------------------------
// colormap.png is a 16 x 4 grid of gradient swatches (32 x 128 px each). Moving a vertex's UV by
// whole swatches swaps its colour but keeps the gradient.
const SWATCH_U = 1 / 16;
const SWATCH_V = 1 / 4;
/** [col,row] -> [col,row]: lavender plaster -> cream. */
const PLASTER = new Map([['2,2', [12, 2]], ['3,2', [13, 2]]]);
/** Teal and red roof tiles -> white, which the squad colour tints. */
const ROOF = new Map([['0,3', [4, 2]], ['1,3', [5, 2]], ['2,3', [4, 2]], ['3,3', [5, 2]]]);
const swatchOf = (u, v) => `${Math.floor(u / SWATCH_U)},${Math.floor(v / SWATCH_V)}`;

// ---- tiny matrix helpers (column-major, like glTF) ---------------------------------------------
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
/** Rotate about y by `deg` (three.js convention), then translate, then scale everything. */
const placement = (x, y, z, deg, s = SCALE) => {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const n = Math.sin(t);
  return [c * s, 0, -n * s, 0, 0, s, 0, 0, n * s, 0, c * s, 0, x * s, y * s, z * s, 1];
};
const apply = (m, [x, y, z], w) => [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w];
const norm = ([x, y, z]) => {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};

// ---- reading kit pieces ------------------------------------------------------------------------
const cache = new Map();
let atlas;
async function piece(name) {
  if (cache.has(name)) return cache.get(name);
  const doc = await io.read(join(SRC, `${name}.glb`));
  const tris = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const world = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial();
      const tex = material?.getBaseColorTexture();
      if (tex && !atlas) atlas = tex.getImage();
      const pos = prim.getAttribute('POSITION');
      const nor = prim.getAttribute('NORMAL');
      const uv = prim.getAttribute('TEXCOORD_0');
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : pos.getCount();
      for (let i = 0; i < count; i += 3) {
        const verts = [0, 1, 2].map((k) => {
          const v = idx ? idx.getScalar(i + k) : i + k;
          return { p: apply(world, pos.getElement(v, []), 1), n: norm(apply(world, nor.getElement(v, []), 0)), uv: uv ? uv.getElement(v, []) : [0, 0] };
        });
        tris.push({ verts, textured: !!tex, material: tex ? 'kit' : (material?.getName() ?? 'kit'), color: material?.getBaseColorFactor() });
      }
    }
  }
  cache.set(name, tris);
  return tris;
}

/** Accumulates triangles into named buckets ("body", "roof", "Water", ...). */
class Builder {
  buckets = new Map();
  async add(name, m, { splitRoof = false } = {}) {
    for (const t of await piece(name)) {
      const centre = t.verts.reduce((a, v) => [a[0] + v.uv[0] / 3, a[1] + v.uv[1] / 3], [0, 0]);
      const key = swatchOf(...centre);
      const isRoof = t.textured && splitRoof && ROOF.has(key);
      const to = t.textured ? (isRoof ? ROOF.get(key) : PLASTER.get(key)) : undefined;
      const [fc, fr] = key.split(',').map(Number);
      const du = to ? (to[0] - fc) * SWATCH_U : 0;
      const dv = to ? (to[1] - fr) * SWATCH_V : 0;
      const bucket = t.textured ? (isRoof ? 'roof' : 'body') : t.material;
      if (!this.buckets.has(bucket)) this.buckets.set(bucket, { pos: [], nor: [], uv: [], color: t.color });
      const b = this.buckets.get(bucket);
      for (const v of t.verts) {
        b.pos.push(...apply(m, v.p, 1));
        b.nor.push(...norm(apply(m, v.n, 0)));
        b.uv.push(v.uv[0] + du, v.uv[1] + dv);
      }
    }
  }
}

// ---- houses -------------------------------------------------------------------------------------
// Local frame: the front (door) faces +z. `w` tiles along x, `d` tiles along z. The roof spans two
// tiles across its ridge, so the side across the ridge must be 2.
//
// Kit conventions (measured): a wall tile stands on the cell's +x edge; rotating it by 90° about y
// moves it to -z, 180° to -x, 270° to +z. A roof tile slopes up from an eave at -x to the ridge at
// +x; roof-left/right carry the gable trim on their -z/+z end.

const HOUSES = [
  { name: 'cottage', w: 2, d: 2, floors: 1, ridge: 'x', walls: ['plaster'], roof: 'roof', chimney: true, door: 0 },
  { name: 'croft', w: 2, d: 2, floors: 1, ridge: 'z', walls: ['wood'], roof: 'roof', door: 1 },
  { name: 'longhouse', w: 3, d: 2, floors: 1, ridge: 'x', walls: ['plaster'], roof: 'roof', dormer: true, door: 1, chimney: true },
  { name: 'townhouse', w: 2, d: 2, floors: 2, ridge: 'z', walls: ['plaster', 'wood'], roof: 'roof', door: 0 },
  { name: 'hall', w: 3, d: 2, floors: 2, ridge: 'x', walls: ['plaster', 'wood'], roof: 'roof', dormer: true, door: 1, chimney: true },
  { name: 'tallhouse', w: 2, d: 2, floors: 2, ridge: 'z', walls: ['wood', 'plaster'], roof: 'roof-high', door: 1, chimney: true },
];

const WALL = {
  plaster: { plain: 'wall', door: 'wall-door', windows: ['wall-window-shutters', 'wall-window-glass', 'wall-window-round'], small: 'wall-window-small' },
  wood: { plain: 'wall-wood', door: 'wall-wood-door', windows: ['wall-wood-window-shutters', 'wall-wood-window-glass', 'wall-wood-window-round'], small: 'wall-wood-window-small' },
};

async function buildHouse(h) {
  const b = new Builder();
  const cx = (i) => i - (h.w - 1) / 2;
  const cz = (j) => j - (h.d - 1) / 2;
  for (let f = 0; f < h.floors; f++) {
    const style = WALL[h.walls[Math.min(f, h.walls.length - 1)]];
    const window = style.windows[f % style.windows.length];
    for (let i = 0; i < h.w; i++) {
      // front (+z) and back (-z)
      await b.add(f === 0 && i === h.door ? style.door : window, placement(cx(i), f, cz(h.d - 1), 270));
      await b.add(i === h.door ? style.small : style.plain, placement(cx(i), f, cz(0), 90));
    }
    for (let j = 0; j < h.d; j++) {
      // sides (+x and -x)
      await b.add(j % 2 === 0 ? style.small : style.plain, placement(cx(h.w - 1), f, cz(j), 0));
      await b.add(j % 2 === 1 ? style.small : style.plain, placement(cx(0), f, cz(j), 180));
    }
  }

  // Roof: two tiles across the ridge for every tile along it.
  const along = h.ridge === 'x' ? h.w : h.d;
  const e = h.ridge === 'x' ? [1, 0] : [0, 1]; // ridge direction (x, z)
  for (let k = 0; k < along; k++) {
    for (const side of [0, 1]) {
      const [i, j] = h.ridge === 'x' ? [k, side] : [side, k];
      // the tile's +x (ridge side) must point across the ridge, toward the house's middle
      const deg = h.ridge === 'x' ? (side === 0 ? 270 : 90) : side === 0 ? 0 : 180;
      const t = (deg * Math.PI) / 180;
      const trimDir = [-Math.sin(t), -Math.cos(t)]; // where the tile's local -z ends up
      const dot = trimDir[0] * e[0] + trimDir[1] * e[1];
      let tile = h.roof;
      if (along > 1 && k === 0) tile = dot < 0 ? `${h.roof}-left` : `${h.roof}-right`;
      else if (along > 1 && k === along - 1) tile = dot > 0 ? `${h.roof}-left` : `${h.roof}-right`;
      else if (h.dormer && side === 1) tile = `${h.roof}-window`;
      await b.add(tile, placement(cx(i), h.floors, cz(j), deg), { splitRoof: true });
      if (h.chimney && k === along - 1 && side === 0) await b.add('chimney', placement(cx(i), h.floors, cz(j), deg));
    }
  }
  return b;
}

// ---- props ----------------------------------------------------------------------------------------
const PROPS = [
  { name: 'fountain', piece: 'fountain-round-detail', scale: 2.1 },
  { name: 'lantern', piece: 'lantern', scale: 1.6 },
  { name: 'cart', piece: 'cart', scale: 1.5 },
  { name: 'stall_green', piece: 'stall-green', scale: 1.6 },
  { name: 'stall_red', piece: 'stall-red', scale: 1.6 },
  { name: 'fence', piece: 'fence', scale: 1.4 },
  { name: 'hedge', piece: 'hedge', scale: 1.4 },
];

// ---- write ----------------------------------------------------------------------------------------
const out = new Document();
const buffer = out.createBuffer();
const scene = out.createScene('settlement');
let kitMaterial;
const materials = new Map();
function materialFor(bucket, color) {
  if (bucket === 'body' || bucket === 'roof') {
    if (!kitMaterial) {
      const texture = out.createTexture('colormap').setImage(atlas).setMimeType('image/png');
      kitMaterial = out.createMaterial('kit').setBaseColorTexture(texture).setRoughnessFactor(0.85).setMetallicFactor(0);
    }
    return kitMaterial;
  }
  if (!materials.has(bucket)) materials.set(bucket, out.createMaterial(bucket).setBaseColorFactor(color ?? [1, 1, 1, 1]).setRoughnessFactor(0.3));
  return materials.get(bucket);
}

function emit(name, builder) {
  const parent = out.createNode(name);
  scene.addChild(parent);
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const [bucket, data] of builder.buckets) {
    const n = data.pos.length / 3;
    for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) {
      box.min[a] = Math.min(box.min[a], data.pos[i * 3 + a]);
      box.max[a] = Math.max(box.max[a], data.pos[i * 3 + a]);
    }
    const prim = out
      .createPrimitive()
      .setAttribute('POSITION', out.createAccessor().setType('VEC3').setArray(new Float32Array(data.pos)).setBuffer(buffer))
      .setAttribute('NORMAL', out.createAccessor().setType('VEC3').setArray(new Float32Array(data.nor)).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', out.createAccessor().setType('VEC2').setArray(new Float32Array(data.uv)).setBuffer(buffer))
      .setMaterial(materialFor(bucket, data.color));
    const label = bucket === 'body' || bucket === 'roof' ? bucket : bucket.toLowerCase().replace(/\W+/g, '');
    parent.addChild(out.createNode(`${name}_${label}`).setMesh(out.createMesh(`${name}_${label}`).addPrimitive(prim)));
  }
  const r = (v) => Math.round(v * 100) / 100;
  return { width: r(box.max[0] - box.min[0]), depth: r(box.max[2] - box.min[2]), height: r(box.max[1]) };
}

const manifest = { scale: SCALE, houses: {}, props: {} };
for (const h of HOUSES) manifest.houses[h.name] = { ...emit(h.name, await buildHouse(h)), floors: h.floors };
for (const p of PROPS) {
  const b = new Builder();
  await b.add(p.piece, placement(0, 0, 0, 0, p.scale));
  manifest.props[p.name] = emit(p.name, b);
}

await out.transform(weld(), dedup(), prune());
await io.write(OUT_GLB, out);
writeFileSync(OUT_JSON, JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${OUT_GLB}`);
for (const [k, v] of Object.entries({ ...manifest.houses, ...manifest.props })) console.log(`  ${k.padEnd(12)} ${v.width} x ${v.depth}, ${v.height} tall`);
