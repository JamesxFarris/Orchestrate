# Performance

Agent City has to run smoothly on a laptop's integrated GPU, inside whatever else the user has open. The budget is **60 fps on an Intel integrated GPU with the full city (`?settle=5`)**, at both 1x and 2x screens.

## How to measure

1. Build the city and run the daemon: `npm run build -w @orchestrate/city`, then `npm run daemon -- --demo`.
2. `node tools/perf.mjs "http://127.0.0.1:4317/?settle=5"` and again with `--dpr 2`.

`tools/perf.mjs` turns vsync and the frame cap off, so FPS shows the real headroom rather than stopping at 60. It reports draw calls and script time per frame. Add `&fx=0`, `&env=0`, `&sky=0` (the README's troubleshooting flags) to see what each effect costs. Numbers swing by about 10–15% between runs, so measure twice before trusting a difference.

To find out which objects are expensive, hide them one group at a time and re-measure. Reach the scene by capturing R3F's store: every object R3F creates gets `__r3f.root`, so a Playwright init script that defines a setter for `__r3f` on `Object.prototype` can grab `root.getState().scene`.

## Where the time goes

Measured 2026-10-18 on an Intel Iris Xe class iGPU (`ANGLE (Intel, Intel(R) Graphics (0x0000A7AC) Direct3D11)`), 1440×900 viewport, the production build, `?settle=5`.

| Setup | 1x | 2x |
|---|---|---|
| Before the render fix: dpr up to 2, 4x MSAA, full-res bloom | 64–77 fps | 22 fps |
| After (current) | 104–118 fps | 82–98 fps |
| After, post-processing off (`&fx=0`) | 122 fps | |

- **Fill rate was the problem.** At 2x pixel ratio, bloom and 4x MSAA ran over four times the pixels; script time per frame went to 62 ms because the CPU sat waiting on the GPU.
- **The scene is about 1.03 million triangles and ~385 draw calls per frame.** The 14 tower models (`buildings.glb`) are about 560k of those triangles, the instanced town (houses, props, trees) about 380k.
- **Simplifying the tower models doesn't pay.** meshoptimizer (weld + simplify) cut them by only ~10%: they are thousands of separate small pieces (window frames), which simplification has to keep. A real cut would mean decimating by hand in Blender.
- **The dev server is about as fast as the build**, so React dev mode isn't a factor when testing.

## What the renderer does (packages/city/src/scene/City.tsx)

- Pixel ratio capped at 1.5; drei's `PerformanceMonitor` slides it toward 1 when frames drop, and settles on 1 if the frame rate keeps swinging.
- SMAA instead of 4x MSAA, and only at 1x: above that the extra pixels already smooth the edges. SMAA at 1.5x cost ~8 fps for no visible gain.
- The canvas skips its own multisampled buffer when the post-processing composer renders the frame.
- Bloom runs at half resolution.
- The sky dome draws after the opaque scene (`renderOrder={1}`), so the depth test skips pixels the city covers.
- Shadows are baked (`shadowMap.autoUpdate = false`); code that moves shadow casters sets `needsUpdate` once when it's done.

## Rules for new scene content

- Anything repeated is one `InstancedMesh` per kind for the whole city, never one mesh per item.
- Moving things don't cast shadows. Static things may, and trigger one shadow re-bake when placed.
- No allocation inside `useFrame`: reuse vectors, matrices and objects.
- Respect `prefers-reduced-motion`.
- Run `tools/perf.mjs` before and after, and note the numbers in the change log.

## Change log

- 2026-10-18: render fix (dpr cap, adaptive dpr, SMAA at 1x, half-res bloom, sky after opaque): 22 → 82–98 fps at 2x. Branch fix/render-perf. `tools/perf.mjs` added, branch docs/knowledge-base.
