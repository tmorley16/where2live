import { expect, test } from '@playwright/test';

test('the app loads, the map fills its area, and nothing breaks the security policy', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?debug&style=blank');
  await expect(page.locator('.brand')).toHaveText('Where2Live');
  await page.waitForFunction(() => (window as unknown as { __w2l?: { map?: { loaded(): boolean } } }).__w2l?.map?.loaded());
  const box = await page.locator('.map-area canvas').boundingBox();
  expect(box?.height).toBeGreaterThan(200);
  expect(box?.width).toBeGreaterThan(200);
  // The demo exercises the bands, the image layer and the markers.
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await page.getByRole('button', { name: 'Cells' }).first().click();
  await page.waitForTimeout(500);
  expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').count()).toBe(1);
  expect(errors).toEqual([]);
});
