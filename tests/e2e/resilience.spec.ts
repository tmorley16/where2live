import { expect, test } from '@playwright/test';
import { best, open, PHOTON_WYNYARD, waitForFrame } from './helpers';

test('offline after loading: edits still recompute the map', async ({ page, context }) => {
  await open(page);
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await waitForFrame(page);
  await context.setOffline(true);
  const before = await best(page);
  await page.locator('.place').first().getByLabel('Times').fill('1');
  await expect.poll(() => best(page)).toBeLessThan(before);
  await context.setOffline(false);
});

test('a used-up daily quota pauses fetching, says when it resumes, and keeps the map', async ({ page }) => {
  const reset = Math.floor(Date.now() / 1000) + 3 * 3600;
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ json: PHOTON_WYNYARD }));
  await page.route('https://api.heigit.org/openrouteservice/**', (route) =>
    route.fulfill({ status: 403, json: { error: 'Quota exceeded' }, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset), 'access-control-allow-origin': '*' } }),
  );
  await open(page);
  await page.getByRole('button', { name: 'Start with my own places' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: '+ Work' }).click();
  await page.getByPlaceholder('Search for an address or place').fill('Wynyard');
  await page.getByRole('option', { name: /Wynyard Station/ }).click();
  await waitForFrame(page);

  await page.getByRole('button', { name: 'Get real road times' }).click();
  await page.getByLabel('Your openrouteservice key').fill('test-key');
  await page.getByRole('button', { name: 'Test' }).click();
  await expect(page.getByText('today’s free quota is used up')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('status')).toContainText('Today’s free quota is used up · resumes about');
  // The map keeps working on estimates meanwhile.
  expect(await best(page)).toBeGreaterThan(0);
});
