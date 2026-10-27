import type { LonLat } from '../domain/types';
import { appStore } from '../state/appStore';
import { peliasAutocomplete, peliasReverse } from './ors/pelias';
import { nominatimReverse, nominatimSearch } from './nominatim';
import { photonAvailable, photonReverse, photonSearch, type GeocodeResult } from './photon';

/**
 * Address search, most reliable first:
 * 1. With a key: openrouteservice's geocoder (as you type; best for street addresses).
 * 2. Without: Photon (as you type), when it's up.
 * 3. Photon down: OpenStreetMap's Nominatim when Enter is pressed (its rules forbid search-as-you-type).
 */
export function searchCredit(): string {
  if (appStore.getState().key) return 'Search by openrouteservice (Pelias) · © OpenStreetMap contributors and others';
  return photonAvailable() ? 'Search by Photon · © OpenStreetMap contributors' : 'Search by Nominatim · © OpenStreetMap contributors';
}

/** Can suggestions come as you type right now? If not, search on Enter. */
export function liveSearch(): boolean {
  return !!appStore.getState().key || photonAvailable();
}

export async function searchPlaces(q: string, near: LonLat, country: string | undefined, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const key = appStore.getState().key;
  if (key) {
    try {
      return await peliasAutocomplete(q, near, country, key, signal);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      // Quota used up or a hiccup: try Photon.
    }
  }
  return photonSearch(q, near, country, signal);
}

/** One search on Enter, when search-as-you-type isn't available. */
export function searchOnce(q: string, near: LonLat, country: string | undefined, signal?: AbortSignal): Promise<GeocodeResult[]> {
  return nominatimSearch(q, near, country, signal);
}

/** The address of a clicked spot. */
export async function reverseGeocode(p: LonLat, signal?: AbortSignal): Promise<GeocodeResult | null> {
  const key = appStore.getState().key;
  if (key) {
    const r = await peliasReverse(p, key, signal).catch(() => null);
    if (r) return r;
  }
  if (photonAvailable()) {
    const r = await photonReverse(p, signal);
    if (r) return r;
  }
  return nominatimReverse(p, signal).catch(() => null);
}
