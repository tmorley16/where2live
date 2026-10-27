import { expect, test } from '@playwright/test';
import { open, PHOTON_WYNYARD, scenario, waitForFrame } from './helpers';

test('add places by search and by clicking the map; they survive a reload', async ({ page }) => {
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ json: PHOTON_WYNYARD }));
  await open(page);
  await page.getByRole('button', { name: 'Start with my own places' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByText('Add the places you go regularly')).toBeVisible();

  // Work, found by search.
  await page.getByRole('button', { name: '+ Work' }).click();
  await page.getByPlaceholder('Search for an address or place').fill('Wynyard');
  await page.getByRole('option', { name: /Wynyard Station/ }).click();
  await waitForFrame(page);
  expect((await scenario(page))!.places[0].location).toEqual([151.2057, -33.8657]);

  // Church, placed by clicking the map.
  await page.getByRole('button', { name: '+ Church' }).click();
  await page.getByRole('button', { name: 'Pick on map' }).click();
  await page.locator('.map-area canvas').click({ position: { x: 200, y: 200 } });
  await expect.poll(async () => (await scenario(page))!.places[1].location).not.toBeNull();

  // Saved in the browser.
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForFunction(() => window.__w2l?.map?.loaded());
  expect((await scenario(page))!.places.map((p) => p.name)).toEqual(['Work', 'Church']);
  await waitForFrame(page);

  // Removing a place removes its trips.
  await page.getByRole('button', { name: 'Remove Church' }).click();
  expect((await scenario(page))!.trips.length).toBe(1);
});
