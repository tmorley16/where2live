import type { LonLat } from '../domain/types';

export interface GeocodeResult {
  label: string;
  /** A short name for a new place ("Westfield Chatswood", "12 Smith Street"). */
  name: string;
  location: LonLat;
  /** ISO 3166-1 alpha-2, when known. */
  country?: string;
}

const cache = new Map<string, GeocodeResult[]>();

interface PhotonProps {
  name?: string;
  housenumber?: string;
  street?: string;
  district?: string;
  locality?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  countrycode?: string;
}

function label(p: PhotonProps): { label: string; name: string } {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const name = p.name ?? (street || p.city || 'Place');
  const area = [p.district ?? p.locality ?? p.city, [p.state, p.postcode].filter(Boolean).join(' ')].filter(Boolean);
  const first = p.name && street && p.name !== street ? `${p.name}, ${street}` : name;
  return { label: [first, ...area.filter((a) => a !== first)].join(', '), name };
}

/**
 * Address search with Photon (komoot's public OpenStreetMap geocoder, built for search-as-you-type).
 * Biased towards `near`; limited to one country when given.
 */
export async function photonSearch(q: string, near: LonLat, country: string | undefined, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const key = `${q}|${near.map((v) => v.toFixed(2))}|${country}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', '6');
  url.searchParams.set('lang', 'en');
  url.searchParams.set('lat', String(near[1]));
  url.searchParams.set('lon', String(near[0]));
  if (country) url.searchParams.set('countrycode', country);
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const json = (await res.json()) as { features?: { geometry: { coordinates: [number, number] }; properties: PhotonProps }[] };
  const out = (json.features ?? []).map((f) => ({
    ...label(f.properties),
    location: [f.geometry.coordinates[0], f.geometry.coordinates[1]] as LonLat,
    country: f.properties.countrycode?.toUpperCase(),
  }));
  cache.set(key, out);
  return out;
}

/** The street address nearest a point, for naming a spot clicked on the map. */
export async function photonReverse(p: LonLat, signal?: AbortSignal): Promise<GeocodeResult | null> {
  const url = new URL('https://photon.komoot.io/reverse');
  url.searchParams.set('lon', String(p[0]));
  url.searchParams.set('lat', String(p[1]));
  url.searchParams.set('lang', 'en');
  url.searchParams.set('limit', '1');
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const json = (await res.json()) as { features?: { geometry: { coordinates: [number, number] }; properties: PhotonProps }[] };
  const f = json.features?.[0];
  return f ? { ...label(f.properties), location: p, country: f.properties.countrycode?.toUpperCase() } : null;
}

/** "-33.8688, 151.2093" (as copied from Google Maps: latitude first) → [lon, lat]. */
export function parseCoordinates(text: string): LonLat | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return [b, a];
  return null;
}
