// Screenshots the city for a visual check, without a person at the screen.
//
//   node tools/shot.mjs <out.png> [--url http://localhost:5173/?settle=5] [--district N] [--overview] [--angled] [--wait 4000] [--zoom N]
//
// Needs the city dev server (npm run city) and the daemon running. --district N looks at squad N's
// settlement from close up; it aims the camera through the `__city` store hook main.tsx exposes in dev.
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : (args[i + 1] ?? true);
};
const out = args[0];
if (!out || out.startsWith('--')) {
  console.error('usage: node tools/shot.mjs <out.png> [--url URL] [--district N] [--overview] [--angled] [--wait ms]');
  process.exit(1);
}
const url = flag('url', 'http://localhost:5173/?settle=5');
const district = flag('district', undefined);
const wait = Number(flag('wait', 4000));

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__city?.getState().team, null, { timeout: 15000 });
  await page.evaluate(
    ({ district, overview, angled }) => {
      const s = window.__city.getState();
      if (overview) return s.camera({ kind: 'overview' });
      if (angled) return s.camera({ kind: 'angled' });
      if (district === undefined) return;
      // the same angles layoutCity gives each squad's district
      const n = Math.max(s.team.squads.length, 1);
      const a = -Math.PI / 2 - Math.PI / 4 + (Number(district) * 2 * Math.PI) / n;
      s.camera({ kind: 'focus', target: [Math.cos(a) * 80, 2, Math.sin(a) * 80] });
    },
    { district, overview: args.includes('--overview'), angled: args.includes('--angled') },
  );
  await page.waitForTimeout(wait);
  // --orbit DEG: swing around the target (Q/E rotate), e.g. 180 to see the fronts of the houses
  const orbit = Number(flag('orbit', 0));
  if (orbit) {
    await page.keyboard.down(orbit > 0 ? 'KeyE' : 'KeyQ');
    await page.waitForTimeout((Math.abs(orbit) * Math.PI / 180 / 1.3) * 1000) // CameraRig turns at 1.3 rad/s;
    await page.keyboard.up(orbit > 0 ? 'KeyE' : 'KeyQ');
    await page.waitForTimeout(800);
  }
  // --zoom N: scroll toward the middle of the screen N notches after the glide
  const zoom = Number(flag('zoom', 0));
  if (zoom) {
    await page.mouse.move(720, 450);
    for (let i = 0; i < zoom; i++) await page.mouse.wheel(0, -120);
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: out });
  console.log(`saved ${out}`);
} finally {
  await browser.close();
}
