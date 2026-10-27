import { CATEGORY_ORDER, MODE_ORDER, BAND_ORDER } from './modes';
import { defaultSettings } from './presets';
import type { Scenario } from './types';

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isLonLat = (x: unknown): x is [number, number] =>
  Array.isArray(x) && x.length === 2 && x.every((v) => typeof v === 'number' && Number.isFinite(v)) && Math.abs(x[0] as number) <= 180 && Math.abs(x[1] as number) <= 90;

/**
 * Checks and repairs a scenario loaded from storage or imported from a file. Returns null if it isn't one.
 * Unknown fields are dropped; missing settings get defaults, so older saves keep working.
 */
export function parseScenario(raw: unknown): Scenario | null {
  if (!isObj(raw) || raw.schema !== 1 || !Array.isArray(raw.people) || !Array.isArray(raw.places) || !Array.isArray(raw.trips)) return null;
  const d = defaultSettings();
  const st = isObj(raw.settings) ? raw.settings : {};
  const people = raw.people.filter(isObj).filter((p) => typeof p.id === 'string').map((p) => ({ id: String(p.id), name: String(p.name ?? 'Someone'), colour: String(p.colour ?? '#495057') }));
  const places = raw.places.filter(isObj).filter((p) => typeof p.id === 'string').map((p) => ({
    id: String(p.id),
    name: String(p.name ?? 'Place'),
    category: CATEGORY_ORDER.includes(p.category as never) ? (p.category as Scenario['places'][number]['category']) : 'other',
    location: isLonLat(p.location) ? (p.location as [number, number]) : null,
    ...(typeof p.address === 'string' ? { address: p.address } : {}),
  }));
  const band = (x: unknown) => (isObj(x) && BAND_ORDER.includes(x.band as never) ? { band: x.band as Scenario['trips'][number]['out']['band'], ...(typeof x.multiplier === 'number' ? { multiplier: x.multiplier } : {}) } : { band: 'offpeak' as const });
  const trips = raw.trips.filter(isObj).filter((t) => typeof t.id === 'string' && Array.isArray(t.placeIds)).map((t) => {
    const f = isObj(t.frequency) ? t.frequency : {};
    return {
      id: String(t.id),
      placeIds: (t.placeIds as unknown[]).map(String),
      travellers: Array.isArray(t.travellers) ? t.travellers.map(String) : [],
      together: !!t.together,
      mode: MODE_ORDER.includes(t.mode as never) ? (t.mode as Scenario['trips'][number]['mode']) : 'car',
      frequency: { count: typeof f.count === 'number' && Number.isFinite(f.count) ? Math.max(0, f.count) : 1, per: (['week', 'fortnight', 'month', 'year'] as const).find((u) => u === f.per) ?? 'week' },
      legs: (['return', 'there-only', 'back-only'] as const).find((l) => l === t.legs) ?? 'return',
      out: band(t.out),
      back: band(t.back),
      overheadMin: typeof t.overheadMin === 'number' && Number.isFinite(t.overheadMin) ? Math.max(0, t.overheadMin) : 0,
      enabled: t.enabled !== false,
    };
  });
  const candidates = (Array.isArray(raw.candidates) ? raw.candidates : []).filter(isObj).filter((c) => typeof c.id === 'string' && isLonLat(c.location)).map((c) => ({
    id: String(c.id),
    kind: c.kind === 'current-home' ? ('current-home' as const) : ('listing' as const),
    label: String(c.label ?? 'Home'),
    location: c.location as [number, number],
    ...(typeof c.address === 'string' ? { address: c.address } : {}),
    ...(typeof c.url === 'string' ? { url: c.url } : {}),
    ...(typeof c.rentPerWeek === 'number' ? { rentPerWeek: c.rentPerWeek } : {}),
    ...(typeof c.notes === 'string' ? { notes: c.notes } : {}),
  }));
  const region = isObj(raw.region) && isLonLat(raw.region.centre) ? { country: String(raw.region.country ?? ''), centre: raw.region.centre as [number, number] } : { country: '', centre: [151.15, -33.84] as [number, number] };
  const settings = { ...d, ...st } as Scenario['settings'];
  settings.trafficMultipliers = { ...d.trafficMultipliers, ...(isObj(st.trafficMultipliers) ? st.trafficMultipliers : {}) } as Scenario['settings']['trafficMultipliers'];
  settings.symmetric = { ...d.symmetric, ...(isObj(st.symmetric) ? st.symmetric : {}) } as Scenario['settings']['symmetric'];
  settings.bands = { ...d.bands, ...(isObj(st.bands) ? st.bands : {}) } as Scenario['settings']['bands'];
  settings.display = { ...d.display, ...(isObj(st.display) ? st.display : {}) } as Scenario['settings']['display'];
  if (!isObj(st.view) || !['combined', 'fairest', 'person'].includes(String(st.view.kind))) settings.view = d.view;
  if (!isObj(st.area) || (st.area.mode === 'manual' && !Array.isArray(st.area.bbox))) settings.area = d.area;
  return { schema: 1, name: String(raw.name ?? 'Our places'), region, people, places, trips, candidates, settings };
}
