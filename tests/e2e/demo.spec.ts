import { expect, test } from '@playwright/test';
import { best, open, scenario, waitForFrame } from './helpers';

test('the demo draws a surface and responds to edits straight away', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await waitForFrame(page);
  const start = await best(page);
  expect(start).toBeGreaterThan(60);
  await expect(page.locator('.legend')).toBeVisible();

  // The page itself never scrolls: only the panel does (no empty area below the app).
  const { doc, win } = await page.evaluate(() => ({ doc: document.documentElement.scrollHeight, win: innerHeight }));
  expect(doc).toBe(win);

  // Sam goes to work once a week instead of five times: less travel at the best spot.
  const work = page.locator('.place').first();
  await work.getByLabel('Times').fill('1');
  await expect.poll(() => best(page)).toBeLessThan(start - 20);

  // Switching the trip off lowers it again.
  const fewer = await best(page);
  await work.getByRole('switch', { name: 'Count this trip' }).click();
  await expect.poll(() => best(page)).toBeLessThan(fewer);

  // Views and styles switch without errors.
  expect((await scenario(page))?.settings.view.kind).toBe('balanced');
  await page.getByRole('button', { name: 'Total' }).click();
  await expect.poll(async () => (await scenario(page))?.settings.view.kind).toBe('combined');
  await page.getByRole('button', { name: 'Fairest' }).click();
  await expect.poll(async () => (await scenario(page))?.settings.view.kind).toBe('fairest');
  await page.getByRole('button', { name: 'Cells' }).first().click();
  await page.getByRole('button', { name: 'Smooth' }).first().click();
  await waitForFrame(page);
});
