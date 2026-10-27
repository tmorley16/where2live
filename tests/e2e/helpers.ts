import type { Page } from '@playwright/test';

interface W2L {
  map: { loaded(): boolean };
  resultStore: { getState(): { frame: { stats: { min: number; valid: number }; bands: { bands: unknown[] }; estimate: boolean } | null; empty: string | null } };
  scenarioStore: { getState(): { scenario: { places: { name: string; location: [number, number] | null }[]; trips: unknown[]; settings: { view: { kind: string } } } | null } };
}

declare global {
  interface Window {
    __w2l: W2L;
  }
}

/** Opens the app with the no-network map style and waits for the map. */
export async function open(page: Page, path = '/'): Promise<void> {
  await page.goto(`${path}?debug&style=blank`);
  await page.waitForFunction(() => window.__w2l?.map?.loaded());
}

export async function waitForFrame(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__w2l.resultStore.getState().frame !== null);
}

export function best(page: Page): Promise<number> {
  return page.evaluate(() => window.__w2l.resultStore.getState().frame?.stats.min ?? Number.NaN);
}

export function scenario(page: Page) {
  return page.evaluate(() => window.__w2l.scenarioStore.getState().scenario);
}

/** One Photon result at Wynyard, Sydney. */
export const PHOTON_WYNYARD = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [151.2057, -33.8657] },
      properties: { name: 'Wynyard Station', street: 'York Street', city: 'Sydney', state: 'New South Wales', postcode: '2000', countrycode: 'AU' },
    },
  ],
};
