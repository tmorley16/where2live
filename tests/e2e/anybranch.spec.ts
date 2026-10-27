import { expect, test } from '@playwright/test';
import { open, PHOTON_WYNYARD, scenario, waitForFrame } from './helpers';

/** Three Coles supermarkets around Sydney, as Photon returns them (plus a look-alike that must be ignored). */
const COLES = {
  type: 'FeatureCollection',
  features: [
    { lon: 151.1041, lat: -33.8135, district: 'Ryde', id: 1 },
    { lon: 151.1839, lat: -33.7969, district: 'Chatswood', id: 2 },
    { lon: 151.2069, lat: -33.8718, district: 'Sydney', id: 3 },
  ]
    .map((s) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: { name: 'Coles', osm_key: 'shop', osm_value: 'supermarket', osm_type: 'N', osm_id: s.id, district: s.district } }))
    .concat([{ type: 'Feature', geometry: { type: 'Point', coordinates: [151.15, -33.85] }, properties: { name: 'Coles Express', osm_key: 'amenity', osm_value: 'fuel', osm_type: 'N', osm_id: 9, district: 'Hunters Hill' } }]),
};

test('a supermarket is any Woolworths, Coles or Aldi from the start; each home counts its nearest', async ({ page }) => {
  await page.route('https://photon.komoot.io/**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    return route.fulfill({ json: /coles/i.test(q) ? COLES : PHOTON_WYNYARD });
  });
  await open(page);
  await page.getByRole('button', { name: 'Start with my own places' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: '+ Work' }).click();
  await page.getByPlaceholder('Search for an address or place').fill('Wynyard');
  await page.getByRole('option', { name: /Wynyard Station/ }).click();
  await waitForFrame(page);

  await page.getByRole('button', { name: '+ Supermarket' }).click();
  const shops = page.getByRole('region', { name: 'Supermarket' });
  // No toggle for a supermarket: the usual chains are ticked and searched straight away.
  await expect(shops.getByRole('button', { name: 'Any branch' })).toHaveCount(0);
  for (const c of ['Woolworths', 'Coles', 'Aldi']) await expect(shops.getByRole('button', { name: c, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(shops.getByText('3 branches: each home counts its quickest one')).toBeVisible();
  await expect(shops.getByText(/No Woolworths or Aldi branches/)).toBeVisible(); // the stub only knows Coles
  // Work has no toggle either; a gym does.
  await expect(page.getByRole('region', { name: 'Work' }).getByRole('button', { name: 'Any branch' })).toHaveCount(0);
  await page.getByRole('button', { name: '+ Gym' }).click();
  await expect(page.getByRole('region', { name: 'Gym' }).getByRole('button', { name: 'Any branch' })).toHaveCount(1);
  const s = await scenario(page);
  const shopsPlace = (s as unknown as { places: { anyOf?: { options: { name: string }[] } }[] }).places[1];
  expect(shopsPlace.anyOf!.options.map((o) => o.name).sort()).toEqual(['Coles, Chatswood', 'Coles, Ryde', 'Coles, Sydney']);

  // The map counts the shopping trip, and a clicked spot names its nearest Coles.
  await waitForFrame(page);
  const canvas = page.locator('.map-area canvas');
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.getByRole('region', { name: 'This spot' }).getByText(/nearest: Coles/)).toBeVisible();

  // Leaving the chain out removes its branches.
  await shops.getByRole('button', { name: 'Coles', exact: true }).click();
  await shops.getByRole('button', { name: 'Woolworths', exact: true }).click();
  await shops.getByRole('button', { name: 'Aldi', exact: true }).click();
  await expect(shops.getByText('No branches yet')).toBeVisible();
});
