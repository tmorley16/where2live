// Visual check: opens the built site (npm run preview) in headless Edge, optionally loads the demo, and saves a screenshot.
// node scripts/shot.mjs [--demo] [--phone] [--blank] [--hover=x,y] [--out=test-results/shot.png] [--path=/]
import { chromium, devices } from '@playwright/test';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const out = args.out ?? 'test-results/shot.png';
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext(args.phone ? devices['Pixel 7'] : { viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const logs = [];
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
const q = new URLSearchParams({ debug: '' });
if (args.blank) q.set('style', 'blank');
await page.goto(`http://localhost:4173${args.path ?? '/'}?${q}`);
if (args.demo) await page.getByRole('button', { name: 'Try the demo' }).click();
await page.waitForFunction(() => window.__w2l?.map?.loaded(), null, { timeout: 30000 });
if (args.demo) await page.waitForFunction(() => window.__w2l.resultStore.getState().frame, null, { timeout: 30000 });
await page.waitForFunction(() => window.__w2l.map.areTilesLoaded(), null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(Number(args.wait ?? 1500));
if (args.mapclick) {
  for (const xy of String(args.mapclick).split('|')) {
    const [x, y] = xy.split(',').map(Number);
    await page.mouse.click(x, y);
    await page.waitForTimeout(900);
  }
}
if (args.click) {
  for (const name of String(args.click).split('|')) {
    await page.getByRole('button', { name, exact: true }).or(page.getByRole('tab', { name, exact: true })).first().click();
    await page.waitForTimeout(600);
  }
}
if (args.hover) {
  const [x, y] = String(args.hover).split(',').map(Number);
  await page.mouse.move(x, y);
  await page.waitForTimeout(400);
}
await page.screenshot({ path: out });
const info = await page.evaluate(() => {
  const f = window.__w2l?.resultStore?.getState().frame;
  return f ? { bands: f.bands.bands.map((b) => b.label), min: f.stats.min, best: f.best, valid: f.stats.valid, n: f.values.length, estimate: f.estimate } : null;
});
console.log(JSON.stringify({ out, info, logs }, null, 1));
await browser.close();
