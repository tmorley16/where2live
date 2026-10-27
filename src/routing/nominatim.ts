import type { LonLat } from '../domain/types';
import type { GeocodeResult } from './photon';

/**
 * OpenStreetMap's own geocoder, the fallback when Photon is down and there's no key. Its usage policy forbids
 * search-as-you-type, so it's only asked when the user presses Enter (or clicks a spot), at most once a second.
 */
const BASE = 'https://nominatim.openstreetmap.org';
let last = 0;

async function politely(url: URL, signal?: AbortSignal): Promise<unknown> {
  const wait = last + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  return res.json();
}

interface NominatimPlace {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  address?: { country_code?: string };
}

function toResult(p: NominatimPlace): GeocodeResult {
  const label = p.display_name.replace(/, Australia$/, '').split(', ').slice(0, 4).join(', ');
  return { label, name: p.name || label.split(',')[0], location: [Number(p.lon), Number(p.lat)], country: p.address?.country_code?.toUpperCase() };
}

export async function nominatimSearch(q: string, near: LonLat, country: string | undefined, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const url = new URL(`${BASE}/search`);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '6');
  url.searchParams.set('addressdetails', '1');
  // Prefer results near the map (not a hard limit).
  url.searchParams.set('viewbox', [near[0] - 0.5, near[1] + 0.5, near[0] + 0.5, near[1] - 0.5].join(','));
  if (country) url.searchParams.set('countrycodes', country.toLowerCase());
  return ((await politely(url, signal)) as NominatimPlace[]).map(toResult);
}

export async function nominatimReverse(p: LonLat, signal?: AbortSignal): Promise<GeocodeResult | null> {
  const url = new URL(`${BASE}/reverse`);
  url.searchParams.set('lat', String(p[1]));
  url.searchParams.set('lon', String(p[0]));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('zoom', '18');
  url.searchParams.set('addressdetails', '1');
  const r = (await politely(url, signal)) as NominatimPlace & { error?: string };
  return r.error ? null : { ...toResult(r), location: p };
}
