import { newId } from '../domain/presets';
import type { BBox, LonLat, PlaceOption } from '../domain/types';
import { areaBBox, type Area } from '../grid/area';
import { haversine } from '../grid/mercator';

/** Australia's main supermarket chains, offered as one-click choices for a "Shopping" place. */
export const SUPERMARKET_CHAINS = ['Woolworths', 'Coles', 'Aldi', 'IGA', 'Harris Farm'];

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: { osm_id?: number; osm_type?: string; osm_key?: string; osm_value?: string; name?: string; city?: string; district?: string; locality?: string };
}

const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

/** Kinds of map feature a chain branch can be (not streets, suburbs or buildings that happen to share the name). */
const BUSINESS_KEYS = new Set(['shop', 'leisure', 'amenity', 'office', 'craft', 'healthcare', 'club', 'sport', 'tourism']);

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function photonBox(q: string, box: BBox, signal?: AbortSignal): Promise<PhotonFeature[]> {
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', q);
  url.searchParams.set('bbox', box.join(','));
  url.searchParams.set('limit', '50');
  url.searchParams.set('lang', 'en');
  // Photon is a free service that throttles bursts: one retry after a pause.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      return ((await res.json()) as { features?: PhotonFeature[] }).features ?? [];
    } catch (e) {
      if ((e as Error).name === 'AbortError' || attempt >= 1) throw e;
      await pause(1500);
    }
  }
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

/**
 * Every branch of a chain in an area, from OpenStreetMap (via Photon). Photon returns at most 50 results, so a box
 * that comes back full is split into quarters (twice at most), a request at a time. Names must contain the chain's
 * name as whole words, so "Revolutions Health & Fitness" isn't taken for Revo Fitness.
 */
export async function findBranches(chain: string, box: BBox, kind: 'supermarket' | 'any', signal?: AbortSignal): Promise<Branches> {
  const want = norm(chain);
  const seen = new Map<string, PlaceOption>();
  let partial = false;
  let requests = 0;
  const walk = async (b: BBox, depth: number): Promise<void> => {
    if (requests++) await pause(250);
    let found: PhotonFeature[];
    try {
      found = await photonBox(chain.trim(), b, signal);
    } catch (e) {
      if (depth === 0 || (e as Error).name === 'AbortError') throw e;
      partial = true; // keep what the rest of the area gave
      return;
    }
    for (const f of found) {
      const p = f.properties;
      if (!p.name || !norm(p.name).includes(want)) continue;
      const ok = kind === 'supermarket' ? p.osm_key === 'shop' && p.osm_value === 'supermarket' : BUSINESS_KEYS.has(p.osm_key ?? '');
      if (!ok) continue;
      const key = `${p.osm_type}${p.osm_id}`;
      if (seen.has(key)) continue;
      const where = p.district ?? p.locality ?? p.city;
      seen.set(key, {
        id: newId(),
        name: where && !p.name.includes(where) ? `${p.name}, ${where}` : p.name,
        location: [Math.round(f.geometry.coordinates[0] * 1e5) / 1e5, Math.round(f.geometry.coordinates[1] * 1e5) / 1e5],
        chain,
      });
    }
    if (found.length >= 50 && depth < 2) {
      const [w, s, e, n] = b;
      const mx = (w + e) / 2;
      const my = (s + n) / 2;
      const quarters: BBox[] = [[w, s, mx, my], [mx, s, e, my], [w, my, mx, n], [mx, my, e, n]];
      // Two at a time: about twice as fast, still gentle on a free service.
      for (let i = 0; i < quarters.length; i += 2) await Promise.all(quarters.slice(i, i + 2).map((q) => walk(q, depth + 1)));
    }
  };
  await walk(box, 0);
  return { options: dedupe([...seen.values()]), partial };
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
