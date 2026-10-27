import { expect, test } from '@playwright/test';
import { open, scenario } from './helpers';

test('the demo has a big way out; new people are Person 1 and 2 and can pick a colour', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await page.getByRole('button', { name: 'Exit demo' }).click();
  await expect(page.getByRole('button', { name: 'Try the demo' })).toBeVisible();

  await page.getByRole('button', { name: 'Start with my own places' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('button', { name: 'Exit demo' })).toHaveCount(0);
  const names = await page.locator('.person input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(names).toEqual(['Person 1', 'Person 2']);

  await page.getByRole('button', { name: 'Person 1’s colour' }).click();
  await page.getByRole('button', { name: 'Colour #1c7ed6' }).click();
  expect((await scenario(page))!.places).toBeDefined();
  expect(await page.evaluate(() => (window.__w2l.scenarioStore.getState().scenario as unknown as { people: { colour: string }[] }).people[0].colour)).toBe('#1c7ed6');
});

test('when Photon is down, Enter searches with Nominatim instead', async ({ page }) => {
  await page.route('https://photon.komoot.io/**', (route) => route.abort());
  await page.route('https://nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({ json: [{ lat: '-33.8657', lon: '151.2057', name: 'Wynyard', display_name: 'Wynyard, Sydney, New South Wales, 2000, Australia', address: { country_code: 'au' } }] }),
  );
  await open(page);
  await page.getByRole('button', { name: 'Start with my own places' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: '+ Work' }).click();
  const box = page.getByPlaceholder('Search for an address or place');
  await box.fill('Wynyard');
  await expect(page.getByText(/Press Enter to search/)).toBeVisible();
  await box.press('Enter');
  await page.getByRole('option', { name: /Wynyard, Sydney/ }).click();
  expect((await scenario(page))!.places[0].location).toEqual([151.2057, -33.8657]);
});
