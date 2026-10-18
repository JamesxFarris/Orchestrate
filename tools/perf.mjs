// Measures how fast the city renders: uncapped FPS, draw calls and script time per frame.
//
//   node tools/perf.mjs [--dpr 2] <url> [<url> ...]
//   node tools/perf.mjs "http://127.0.0.1:4317/?settle=5" "http://127.0.0.1:4317/?settle=1"
//
// Use the daemon's built city (npm run build -w @orchestrate/city, then the daemon on :4317): the
// dev server works too, but the numbers in docs/city/performance.md come from the build. Vsync and
// the frame cap are off, so FPS shows the real headroom rather than stopping at 60.
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const dprAt = args.indexOf('--dpr');
const dpr = dprAt < 0 ? 1 : Number(args.splice(dprAt, 2)[1]);
if (!args.length) {
  console.error('usage: node tools/perf.mjs [--dpr N] <url> [<url> ...]');
  process.exit(1);
}

// counts every WebGL draw call the page makes
const hook = () => {
  const stats = { calls: 0, frames: 0 };
  window.__perf = stats;
  const proto = WebGL2RenderingContext.prototype;
  for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const orig = proto[name];
    proto[name] = function (...a) {
      stats.calls++;
      return orig.apply(this, a);
    };
  }
  const tick = () => (stats.frames++, requestAnimationFrame(tick));
  requestAnimationFrame(tick);
};

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
try {
  for (const url of args) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
    await page.addInitScript(hook);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(8000); // models load, shadows bake, PerformanceMonitor settles
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    const before = await metrics();
    const r = await page.evaluate(async () => {
      const s = window.__perf;
      const gl = document.createElement('canvas').getContext('webgl2');
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const start = { ...s };
      const t0 = performance.now();
      await new Promise((res) => setTimeout(res, 5000));
      const frames = s.frames - start.frames;
      return { gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '?', frames, seconds: (performance.now() - t0) / 1000, calls: s.calls - start.calls };
    });
    const after = await metrics();
    const fps = r.frames / r.seconds;
    console.log(
      JSON.stringify({
        url,
        dpr,
        fps: +fps.toFixed(1),
        drawCallsPerFrame: Math.round(r.calls / r.frames),
        scriptMsPerFrame: +(((after.ScriptDuration - before.ScriptDuration) * 1000) / r.frames).toFixed(2),
        gpu: r.gpu,
      }),
    );
    await page.close();
  }
} finally {
  await browser.close();
}
