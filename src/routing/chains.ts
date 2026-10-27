import { newId } from '../domain/presets';
import type { BBox, LonLat, PlaceOption } from '../domain/types';
import { areaBBox, type Area } from '../grid/area';
import { haversine } from '../grid/mercator';
import { appStore } from '../state/appStore';

/** Australia's main supermarket chains, offered as one-click choices for a supermarket. */
export const SUPERMARKET_CHAINS = ['Woolworths', 'Coles', 'Aldi', 'IGA', 'Harris Farm'];

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: { osm_id?: number; osm_type?: string; osm_key?: string; osm_value?: string; name?: string; city?: string; district?: string; locality?: string };
}

const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

/** Kinds of map feature a chain branch can be (not streets, suburbs or buildings that happen to share the name). */
const BUSINESS_KEYS = new Set(['shop', 'leisure', 'amenity', 'office', 'craft', 'healthcare', 'club', 'sport', 'tourism']);

/** Words in names that mark a chain's petrol station, bottle shop or the like rather than a supermarket. */
const NOT_SUPERMARKET = /\b(petrol|liquor|express|caltex|bws|fuel|cellars|mobile)\b/i;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** At most three search requests at once across every chain being searched (free services throttle bursts). */
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(job: () => Promise<T>): Promise<T> {
  if (active >= 3) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await job();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/** Fetch JSON, with one retry after a pause (Photon throttles bursts and can be briefly unavailable). */
async function getJSON<T>(url: URL, init: RequestInit): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await slot(() => fetch(url, init));
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      return (await res.json()) as T;
    } catch (e) {
      if ((e as Error).name === 'AbortError' || attempt >= 1) throw e;
      await pause(1500);
    }
  }
}

/** One branch-like search result, whichever service it came from. */
interface Hit {
  key: string;
  name: string;
  where?: string;
  location: LonLat;
  /** The right kind of place (a supermarket; a business, not a street). */
  fits: (kind: 'supermarket' | 'any') => boolean;
}

interface Source {
  /** Results per request: a box returning this many is split. */
  limit: number;
  search(q: string, box: BBox, signal?: AbortSignal): Promise<Hit[]>;
}

const photon: Source = {
  limit: 50,
  async search(q, box, signal) {
    const url = new URL('https://photon.komoot.io/api/');
    url.searchParams.set('q', q);
    url.searchParams.set('bbox', box.join(','));
    url.searchParams.set('limit', '50');
    url.searchParams.set('lang', 'en');
    const json = await getJSON<{ features?: PhotonFeature[] }>(url, { signal });
    return (json.features ?? []).map((f) => {
      const p = f.properties;
      return {
        key: `${p.osm_type}${p.osm_id}`,
        name: p.name ?? '',
        where: p.district ?? p.locality ?? p.city,
        location: f.geometry.coordinates,
        fits: (kind) => (kind === 'supermarket' ? p.osm_key === 'shop' && p.osm_value === 'supermarket' : BUSINESS_KEYS.has(p.osm_key ?? '')),
      };
    });
  },
};

interface PeliasFeature {
  geometry: { coordinates: [number, number] };
  properties: { gid?: string; name?: string; locality?: string; neighbourhood?: string };
}

/** openrouteservice's geocoder: used with a key when Photon is unavailable. */
function pelias(key: string): Source {
  return {
    limit: 40,
    async search(q, box, signal) {
      const url = new URL('https://api.heigit.org/pelias/v1/search');
      url.searchParams.set('text', q);
      url.searchParams.set('layers', 'venue');
      url.searchParams.set('size', '40');
      url.searchParams.set('boundary.rect.min_lon', String(box[0]));
      url.searchParams.set('boundary.rect.min_lat', String(box[1]));
      url.searchParams.set('boundary.rect.max_lon', String(box[2]));
      url.searchParams.set('boundary.rect.max_lat', String(box[3]));
      const json = await getJSON<{ features?: PeliasFeature[] }>(url, { signal, headers: { Authorization: key } });
      return (json.features ?? []).map((f) => ({
        key: f.properties.gid ?? f.geometry.coordinates.join(','),
        name: f.properties.name ?? '',
        where: f.properties.locality ?? f.properties.neighbourhood,
        location: f.geometry.coordinates,
        fits: (kind) => kind !== 'supermarket' || !NOT_SUPERMARKET.test(f.properties.name ?? ''),
      }));
    },
  };
}

/** The same store mapped twice (a point and a building outline) sits a few metres apart: keep one. */
function dedupe(options: PlaceOption[]): PlaceOption[] {
  const out: PlaceOption[] = [];
  for (const o of options) if (!out.some((p) => p.chain === o.chain && haversine(p.location, o.location) < 150)) out.push(o);
  return out;
}

export interface Branches {
  options: PlaceOption[];
  /** Part of the area couldn't be searched (the service was busy). */
  partial: boolean;
}

async function walkSource(src: Source, chain: string, box: BBox, kind: 'supermarket' | 'any', signal?: AbortSignal): Promise<Branches> {
  const want = norm(chain);
  const seen = new Map<string, PlaceOption>();
  let partial = false;
  const walk = async (b: BBox, depth: number): Promise<void> => {
    let found: Hit[];
    try {
      found = await src.search(chain.trim(), b, signal);
    } catch (e) {
      if (depth === 0 || (e as Error).name === 'AbortError') throw e;
      partial = true; // keep what the rest of the area gave
      return;
    }
    for (const h of found) {
      if (!h.name || !norm(h.name).includes(want) || !h.fits(kind) || seen.has(h.key)) continue;
      seen.set(h.key, {
        id: newId(),
        name: h.where && !h.name.includes(h.where) ? `${h.name}, ${h.where}` : h.name,
        location: [Math.round(h.location[0] * 1e5) / 1e5, Math.round(h.location[1] * 1e5) / 1e5],
        chain,
      });
    }
    if (found.length >= src.limit && depth < 2) {
      const [w, s, e, n] = b;
      const mx = (w + e) / 2;
      const my = (s + n) / 2;
      // The shared limit keeps this to three requests at a time.
      await Promise.all(([[w, s, mx, my], [mx, s, e, my], [w, my, mx, n], [mx, my, e, n]] as BBox[]).map((q) => walk(q, depth + 1)));
    }
  };
  await walk(box, 0);
  return { options: dedupe([...seen.values()]), partial };
}

/**
 * Every branch of a chain in an area, from OpenStreetMap via Photon; if Photon is down and there's a key, from
 * openrouteservice's geocoder. A box that comes back full is split into quarters (twice at most). Names must contain
 * the chain's name as whole words, so "Revolutions Health & Fitness" isn't taken for Revo Fitness.
 */
export async function findBranches(chain: string, box: BBox, kind: 'supermarket' | 'any', signal?: AbortSignal): Promise<Branches> {
  try {
    return await walkSource(photon, chain, box, kind, signal);
  } catch (e) {
    const key = appStore.getState().key;
    if (!key || (e as Error).name === 'AbortError') throw e;
    return walkSource(pelias(key), chain, box, kind, signal);
  }
}

/** Where to look for branches: the search area plus 5 km (a home near the edge may shop just outside it). */
export function searchBox(area: Area | null, centre: LonLat): BBox {
  const [w, s, e, n] = area ? areaBBox(area) : [centre[0], centre[1], centre[0], centre[1]];
  const pad = area ? 5 : 15;
  const dLat = pad / 111;
  const dLon = pad / (111 * Math.cos((((s + n) / 2) * Math.PI) / 180));
  return [w - dLon, s - dLat, e + dLon, n + dLat].map((v) => Math.round(v * 1e4) / 1e4) as BBox;
}

export function covers(outer: BBox | undefined, inner: BBox): boolean {
  return !!outer && outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}

/** Adds branches, skipping any at a spot already listed. */
export function mergeBranches(cur: PlaceOption[], found: PlaceOption[]): PlaceOption[] {
  const at = new Set(cur.map((o) => `${o.location[0].toFixed(4)},${o.location[1].toFixed(4)}`));
  return [...cur, ...found.filter((o) => !at.has(`${o.location[0].toFixed(4)},${o.location[1].toFixed(4)}`))];
}
