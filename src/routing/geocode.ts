import type { LonLat } from '../domain/types';
import { appStore } from '../state/appStore';
import { peliasAutocomplete } from './ors/pelias';
import { photonSearch, type GeocodeResult } from './photon';

/** Which search the user gets: openrouteservice's (better street addresses) with a key, Photon without. */
export function searchCredit(): string {
  return appStore.getState().key ? 'Search by openrouteservice (Pelias) · © OpenStreetMap contributors and others' : 'Search by Photon · © OpenStreetMap contributors';
}

export async function searchPlaces(q: string, near: LonLat, country: string | undefined, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const key = appStore.getState().key;
  if (key) {
    try {
      return await peliasAutocomplete(q, near, country, key, signal);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      // Quota used up or a hiccup: Photon still works.
    }
  }
  return photonSearch(q, near, country, signal);
}
