import { expect, test, type Page } from '@playwright/test';
import { open, PHOTON_WYNYARD, waitForFrame } from './helpers';

type LL = [number, number];
const metres = ([a, b]: LL, [c, d]: LL) => {
  const r = Math.PI / 180;
  const x = Math.sin(((d - b) * r) / 2) ** 2 + Math.cos(b * r) * Math.cos(d * r) * Math.sin(((c - a) * r) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(x));
};

/** A pretend openrouteservice: every point is on a road; 8 m/s as the crow flies. Counts matrix requests. */
async function fakeOrs(page: Page) {
  const counts = { matrix: 0, snap: 0 };
  await page.route('https://api.heigit.org/openrouteservice/**', async (route) => {
    const body = route.request().postDataJSON();
    const headers = { 'x-ratelimit-remaining': '480', 'access-control-allow-origin': '*' };
    if (route.request().url().includes('/snap/')) {
      counts.snap++;
      return route.fulfill({ json: { locations: body.locations.map((l: LL) => ({ location: l, snapped_distance: 10 })) }, headers });
    }
    counts.matrix++;
    const locs: LL[] = body.locations;
    const at = (i: number) => ({ location: locs[i], snapped_distance: 5 });
    return route.fulfill({
      json: {
        durations: body.sources.map((i: number) => body.destinations.map((j: number) => metres(locs[i], locs[j]) / 8)),
        distances: body.sources.map((i: number) => body.destinations.map((j: number) => metres(locs[i], locs[j]) / 1000)),
        sources: body.sources.map(at),
        destinations: body.destinations.map(at),
      },
      headers,
    });
  });
  return counts;
}

const ready = (page: Page) =>
  page.waitForFunction(() => {
    const f = window.__w2l.resultStore.getState().frame;
    return f !== null && f.estimate === false && (f as unknown as { provisional: number }).provisional === 0;
  }, null, { timeout: 30_000 });

test('with a key, road times replace the estimates, and come back from the cache after a reload', async ({ page }) => {
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ json: PHOTON_WYNYARD }));
  const counts = await fakeOrs(page);
  await open(page);
  await page.getByRole('button', { name: 'Start with my own places' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: '+ Work' }).click();
  await page.getByPlaceholder('Search for an address or place').fill('Wynyard');
  await page.getByRole('option', { name: /Wynyard Station/ }).click();
  await waitForFrame(page);
  expect(await page.evaluate(() => window.__w2l.resultStore.getState().frame!.estimate)).toBe(true);

  await page.getByRole('button', { name: 'Get real road times' }).click();
  await page.getByLabel('Your openrouteservice key').fill('test-key');
  await page.getByRole('button', { name: 'Save' }).click();
  await ready(page);
  expect(counts.matrix).toBeGreaterThan(0);
  expect(counts.matrix).toBeLessThanOrEqual(6);

  // Reload: the key is remembered and every road time comes from the browser's cache.
  const before = { ...counts };
  await page.waitForTimeout(1000); // let the cache writes finish
  await page.reload();
  await page.waitForFunction(() => window.__w2l?.map?.loaded());
  await ready(page);
  await page.waitForTimeout(1500); // past the planner's delay
  expect(counts).toEqual(before);
});
