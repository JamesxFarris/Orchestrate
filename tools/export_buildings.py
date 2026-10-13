"""Convert Models/buildings.blend into packages/city/public/models/buildings.glb.

Usage (Blender 4.2 LTS, headless; scripts inside the .blend are never executed):
  blender -b --disable-autoexec Models/buildings.blend --python tools/export_buildings.py -- out/buildings.glb out/buildings.json out/previews
  npx @gltf-transform/cli meshopt out/buildings.glb packages/city/public/models/buildings.glb

Each skyscraper is rotated upright, centred, normalised to unit height and reduced to three
materials (body / glass / trim) that the city restyles at runtime. Windows note: extract Blender to
a short path; the 260-char path limit silently drops files from the glTF add-on.
"""
import bpy, bmesh, json, sys, os
from mathutils import Matrix, Vector

out_glb, out_json, preview_dir = sys.argv[sys.argv.index('--') + 1:]
ORDER = ['body', 'glass', 'trim']
# Squat models where 'longest axis is up' is wrong: keep their authored Z-up.
UP_OVERRIDE = {'Mesh1 Model': 2, 'Mesh3320 Model': 2}


def kind(mat_name):
    n = (mat_name or '').lower()
    if any(k in n for k in ('glass', 'mirror')):
        return 'glass'
    if any(k in n for k in ('gold', 'black', 'rubber', 'color_d02')):
        return 'trim'
    return 'body'


def extents(me):
    lo = [min(v.co[a] for v in me.vertices) for a in range(3)]
    hi = [max(v.co[a] for v in me.vertices) for a in range(3)]
    return lo, hi


mats = {k: bpy.data.materials.new(k) for k in ORDER}
mats['body'].diffuse_color = (0.85, 0.83, 0.8, 1)
mats['glass'].diffuse_color = (0.15, 0.3, 0.42, 1)
mats['trim'].diffuse_color = (0.8, 0.6, 0.2, 1)

bpy.ops.object.select_all(action='DESELECT')
buildings = []
SKIP = {'Mesh3320 Model'}  # broken model: a giant triangular backdrop
candidates = sorted((o for o in bpy.data.objects if o.type == 'MESH' and len(o.data.polygons) > 1000 and o.name not in SKIP),
                    key=lambda o: o.users_collection[0].name)
for i, src in enumerate(candidates):
    me = src.data.copy()
    me.transform(src.matrix_world)

    # Remap every polygon to body / glass / trim by its original material name.
    slot_kinds = [kind(s.material.name if s.material else '') for s in src.material_slots] or ['body']
    idx = [p.material_index for p in me.polygons]
    me.materials.clear()
    for k in ORDER:
        me.materials.append(mats[k])
    for p, mi in zip(me.polygons, idx):
        p.material_index = ORDER.index(slot_kinds[mi] if mi < len(slot_kinds) else 'body')

    # Skyscrapers are tall: put the longest axis on +Z (most of the pack is modelled Y-up).
    lo, hi = extents(me)
    ext = [hi[a] - lo[a] for a in range(3)]
    up = UP_OVERRIDE.get(src.name, max(range(3), key=lambda a: ext[a]))
    if up == 1:
        me.transform(Matrix.Rotation(1.5707963, 4, 'X'))
    elif up == 0:
        me.transform(Matrix.Rotation(-1.5707963, 4, 'Y'))

    # Base at z=0, centred, unit height.
    lo, hi = extents(me)
    me.transform(Matrix.Translation((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2])))
    s = 1.0 / (hi[2] - lo[2])
    me.transform(Matrix.Scale(s, 4))

    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(me)
    bm.free()
    for uv in list(me.uv_layers):
        me.uv_layers.remove(uv)

    name = f"bldg_{i:02d}"
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.select_set(True)
    lo, hi = extents(me)
    counts = {k: sum(1 for p in me.polygons if ORDER[p.material_index] == k) for k in ORDER}
    buildings.append({"name": name, "source": src.name, "upAxis": "XYZ"[up],
                      "width": round(hi[0] - lo[0], 4), "depth": round(hi[1] - lo[1], 4),
                      "polys": len(me.polygons), "faces": counts})
    print(name, src.name, "up=" + "XYZ"[up], f"w={hi[0]-lo[0]:.3f} d={hi[1]-lo[1]:.3f}", len(me.polygons), counts, flush=True)

bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', use_selection=True, export_apply=True,
                          export_texcoords=False, export_yup=True, export_materials='EXPORT')
json.dump(buildings, open(out_json, 'w'), indent=2)
print("EXPORTED", out_glb, flush=True)

# Workbench previews, one per building, so they can be matched to roles.
scene = bpy.context.scene
for o in scene.objects:
    o.hide_render = not o.name.startswith('bldg_')
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.color_type = 'MATERIAL'
scene.display.shading.light = 'STUDIO'
scene.render.resolution_x, scene.render.resolution_y = 240, 480
cam_data = bpy.data.cameras.new('pc')
cam_data.type = 'ORTHO'
cam = bpy.data.objects.new('pc', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
for b in buildings:
    for o in scene.objects:
        if o.name.startswith('bldg_'):
            o.hide_render = o.name != b['name']
    cam_data.ortho_scale = max(1.1, max(b['width'], b['depth']) * 1.6)
    cam.location = Vector((3, -3, 1.6))
    cam.rotation_euler = (1.35, 0, 0.785)
    scene.render.filepath = os.path.join(preview_dir, b['name'] + '.png')
    bpy.ops.render.render(write_still=True)
print("PREVIEWS DONE", flush=True)
