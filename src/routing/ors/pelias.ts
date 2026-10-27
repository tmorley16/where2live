import type { LonLat } from '../../domain/types';
import type { GeocodeResult } from '../photon';

interface PeliasFeature {
  geometry: { coordinates: [number, number] };
  properties: { label?: string; name?: string; country_code?: string };
}

const cache = new Map<string, GeocodeResult[]>();

/**
 * Address search as you type with openrouteservice's geocoder (Pelias, on the new HeiGIT host). Better than Photon
 * for street addresses ("436 Victoria Avenue, Chatswood, NSW"); uses the user's key (3,000 searches a day).
 */
export async function peliasAutocomplete(text: string, near: LonLat, country: string | undefined, key: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const ck = `${text}|${near.map((v) => v.toFixed(2))}|${country}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const url = new URL('https://api.heigit.org/pelias/v1/autocomplete');
  url.searchParams.set('text', text);
  url.searchParams.set('focus.point.lon', String(near[0]));
  url.searchParams.set('focus.point.lat', String(near[1]));
  url.searchParams.set('size', '6');
  if (country) url.searchParams.set('boundary.country', country);
  const res = await fetch(url, { headers: { Authorization: key }, signal });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const json = (await res.json()) as { features?: PeliasFeature[] };
  const out = (json.features ?? []).map((f) => {
    const label = (f.properties.label ?? f.properties.name ?? 'Place').replace(/, Australia$/, '');
    return { label, name: f.properties.name ?? label.split(',')[0], location: [f.geometry.coordinates[0], f.geometry.coordinates[1]] as LonLat, country: f.properties.country_code?.toUpperCase() };
  });
  cache.set(ck, out);
  return out;
}

/** The address at a point (naming a clicked spot), with the user's key. */
export async function peliasReverse(p: LonLat, key: string, signal?: AbortSignal): Promise<GeocodeResult | null> {
  const url = new URL('https://api.heigit.org/pelias/v1/reverse');
  url.searchParams.set('point.lon', String(p[0]));
  url.searchParams.set('point.lat', String(p[1]));
  url.searchParams.set('size', '1');
  url.searchParams.set('layers', 'address,street');
  const res = await fetch(url, { headers: { Authorization: key }, signal });
  if (!res.ok) return null;
  const f = ((await res.json()) as { features?: PeliasFeature[] }).features?.[0];
  if (!f) return null;
  const label = (f.properties.label ?? f.properties.name ?? 'Place').replace(/, Australia$/, '');
  return { label, name: f.properties.name ?? label.split(',')[0], location: p, country: f.properties.country_code?.toUpperCase() };
}
