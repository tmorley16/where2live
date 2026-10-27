import { expect, test } from '@playwright/test';
import { open, PHOTON_WYNYARD, waitForFrame } from './helpers';

test('click a spot to see it trip by trip, then shortlist it and another address', async ({ page }) => {
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ json: PHOTON_WYNYARD }));
  await open(page);
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await waitForFrame(page);

  // A click on the map shows that spot.
  const canvas = page.locator('.map-area canvas');
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  const spot = page.getByRole('region', { name: 'This spot' });
  await expect(spot).toBeVisible();
  await expect(spot.locator('.spot-total')).toContainText('a week');
  await expect(spot.locator('.lines li')).toHaveCount(8); // every trip in the demo

  // Shortlist it, then add an address by search.
  await spot.getByRole('button', { name: 'Add to shortlist' }).click();
  await expect(page.locator('.cand-row')).toHaveCount(1);
  await page.getByPlaceholder('Add an address to compare').fill('Wynyard');
  await page.getByRole('option', { name: /Wynyard Station/ }).click();
  await expect(page.locator('.cand-row')).toHaveCount(2);

  // Sorted by weekly travel, each with a pin on the map showing its time. While the clicked-spot pin is on
  // the first one, it stands in for that pin; closing the spot brings it back.
  const totals = await page.locator('.cand-total strong').allTextContents();
  expect(totals).toHaveLength(2);
  await expect(page.locator('.cand-label')).toHaveCount(1);
  await spot.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.cand-label')).toHaveCount(2);
  await expect(page.locator('.cand-label').first()).toHaveText(/^[AB] · \d+:\d\d$/);

  // Rent and notes are kept.
  await page.locator('.cand-row').first().getByRole('spinbutton').fill('650');
  await expect.poll(() => page.evaluate(() => (window.__w2l.scenarioStore.getState().scenario as unknown as { candidates: { rentPerWeek?: number }[] }).candidates.some((c) => c.rentPerWeek === 650))).toBe(true);
});
