// Times a full recompute (weights → surface → bands → contours → map source update) on the demo.
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:4173/?debug&style=blank');
await page.getByRole('button', { name: 'Try the demo' }).click();
await page.waitForFunction(() => window.__w2l?.resultStore?.getState().frame);
await page.waitForTimeout(1000);
const r = await page.evaluate(async () => {
  const { engine, scenarioStore, resultStore } = window.__w2l;
  const f = resultStore.getState().frame;
  const runs = [];
  for (let i = 0; i < 30; i++) {
    const s = structuredClone(scenarioStore.getState().scenario);
    s.trips[0].frequency.count = 1 + (i % 10) * 0.5;
    const t = performance.now();
    scenarioStore.setState({ scenario: s }, true);
    engine.run();
    runs.push(performance.now() - t);
  }
  runs.sort((a, b) => a - b);
  return { points: f.values.length, fields: [...new Set()].length, medianMs: runs[15].toFixed(1), p90Ms: runs[27].toFixed(1) };
});
console.log(JSON.stringify(r));
await browser.close();
