import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryKV } from '../../src/cache/kv';
import { legSpec, specKey, type FieldSpec } from '../../src/domain/fields';
import { buildForms, evaluateAt } from '../../src/domain/formula';
import { defaultSettings, newId } from '../../src/domain/presets';
import type { LonLat, Scenario } from '../../src/domain/types';
import { parseScenario } from '../../src/domain/validate';
import { autoArea } from '../../src/grid/area';
import { LEVEL, idToLonLat, windowFor, windowIds } from '../../src/grid/lattice';
import { haversine, toMercator } from '../../src/grid/mercator';
import { TargetIndex } from '../../src/grid/nearest';
import { findBranches, mergeBranches } from '../../src/routing/chains';
import { estimateField, estimateMinutes } from '../../src/routing/estimate';
import { OrsProvider } from '../../src/routing/orsProvider';
import type { JobStatus } from '../../src/state/appStore';

const line = (n: number): LonLat[] => Array.from({ length: n }, (_, i) => [151 + i * 0.01, -33.8] as LonLat);

describe('nearest branches', () => {
  it('routes each home to its few nearest branches, plus any nearly as near', () => {
    const idx = new TargetIndex(line(12));
    const c = idx.candidatesAt([151.0501, -33.8]);
    expect(c.slice(0, 2).sort()).toEqual([5, 6]);
    expect(c.length).toBeGreaterThanOrEqual(4);
    expect(c.length).toBeLessThanOrEqual(8);
    expect(new TargetIndex(line(3)).candidatesAt([151, -33.8])).toEqual([0, 1, 2]);
  });

  it('keys a set of branches the same whatever the order, and uses the outbound field both ways', () => {
    const s = defaultSettings();
    const a = legSpec('car', 'out', line(3), s);
    const b = legSpec('car', 'out', [...line(3)].reverse(), s);
    expect(specKey(a)).toBe(specKey(b));
    expect(specKey(a)).toContain('any:');
    expect(legSpec('car', 'back', line(3), s).dir).toBe('to');
    expect(legSpec('car', 'back', line(1), s).dir).toBe('from');
  });

  it('estimates the nearest branch exactly (same as checking every branch)', () => {
    const targets: LonLat[] = Array.from({ length: 40 }, (_, i) => [151 + ((i * 37) % 40) * 0.005, -33.9 + ((i * 17) % 40) * 0.005]);
    const spec: FieldSpec = { mode: 'car', dir: 'to', targets };
    const [x, y] = toMercator([151.1, -33.8]);
    const w = windowFor([x - 6000, y - 6000, x + 6000, y + 6000], LEVEL.coarse);
    const ids = windowIds(w);
    const est = estimateField(spec, ids);
    for (let k = 0; k < ids.length; k += 7) {
      const p = idToLonLat(ids[k]);
      expect(est[k]).toBeCloseTo(Math.min(...targets.map((t) => estimateMinutes('car', p, t))), 4);
    }
  });
});

function scenarioWithShops(): Scenario {
  return {
    schema: 1,
    name: 't',
    region: { country: 'AU', centre: [151.15, -33.84] },
    people: [{ id: 'a', name: 'A', colour: '#000' }],
    places: [
      { id: 'work', name: 'Work', category: 'work', location: [151.2, -33.87] },
      { id: 'shops', name: 'Shops', category: 'shopping', location: null, anyOf: { chains: ['Coles'], options: [{ id: 'o1', name: 'Coles 1', location: [151.1, -33.8], chain: 'Coles' }, { id: 'o2', name: 'Coles 2', location: [150.5, -33.2], chain: 'Coles' }] } },
    ],
    trips: ['work', 'shops'].map((id) => ({ id: `t-${id}`, placeIds: [id], travellers: ['a'], together: false, mode: 'car' as const, frequency: { count: 1, per: 'week' as const }, legs: 'return' as const, out: { band: 'weekend' as const }, back: { band: 'weekend' as const }, overheadMin: 0, enabled: true })),
    candidates: [],
    settings: defaultSettings(),
  };
}

describe('any-branch places in the model', () => {
  it('reads one "any:" field for both legs, and its branches never stretch the area', () => {
    const s = scenarioWithShops();
    const f = buildForms(s);
    const anyKeys = [...f.specs.keys()].filter((k) => k.includes('any:'));
    expect(anyKeys).toHaveLength(1);
    expect(evaluateAt(f.combined, () => 10)).toBeCloseTo(10 * 4, 6); // work there and back, shops there and back
    const a = autoArea(s);
    const [, south] = [0, a.box[1]];
    expect(south).toBeGreaterThan(toMercator([151, -33.95])[1]); // the far-off Coles at −33.2 doesn't stretch it north…
    expect(a.box[3]).toBeLessThan(toMercator([151, -33.5])[1]); // …or anywhere
  });

  it('survives saving and loading', () => {
    const s = scenarioWithShops();
    const back = parseScenario(JSON.parse(JSON.stringify(s)))!;
    expect(back.places[1].anyOf?.options.map((o) => o.name)).toEqual(['Coles 1', 'Coles 2']);
    expect(back.places[1].anyOf?.chains).toEqual(['Coles']);
  });

  it('merges search results without repeating a branch at the same spot', () => {
    const cur = [{ id: '1', name: 'Mine', location: [151.1, -33.8] as LonLat }];
    expect(mergeBranches(cur, [{ id: '2', name: 'Same', location: [151.10001, -33.80001] }, { id: '3', name: 'New', location: [151.2, -33.8] }]).map((o) => o.name)).toEqual(['Mine', 'New']);
  });
});

// ---------- The routing side ----------

beforeEach(() => vi.useFakeTimers({ now: 1_000_000_000_000 }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A pretend openrouteservice (10 m/s as the crow flies) that records each matrix request's size. */
function fakeOrs() {
  const matrices: { sources: number; destinations: number }[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (url.includes('/snap/')) return json({ locations: body.locations.map((l: LonLat) => ({ location: l, snapped_distance: 10 })) });
    const locs: LonLat[] = body.locations;
    matrices.push({ sources: body.sources.length, destinations: body.destinations.length });
    return json({ durations: body.sources.map((i: number) => body.destinations.map((j: number) => haversine(locs[i], locs[j]) / 10)), sources: body.sources.map((i: number) => ({ location: locs[i] })), destinations: body.destinations.map((j: number) => ({ location: locs[j] })) });
  }) as unknown as typeof fetch;
  return { fetchImpl, matrices };
}

async function settle(statuses: JobStatus[]) {
  for (let i = 0; i < 400; i++) {
    await vi.advanceTimersByTimeAsync(500);
    const s = statuses.at(-1);
    if (i > 2 && s && ['idle', 'error', 'confirm'].includes(s.state)) break;
  }
  await vi.advanceTimersByTimeAsync(1000);
}

describe('any-branch fields from openrouteservice', () => {
  const [cx, cy] = toMercator([151.15, -33.84]);
  const w = windowFor([cx - 5000, cy - 5000, cx + 5000, cy + 5000], LEVEL.standard);
  const ids = windowIds(w);
  const branches: LonLat[] = Array.from({ length: 12 }, (_, i) => [151.1 + (i % 4) * 0.03, -33.88 + Math.floor(i / 4) * 0.035]);
  const spec: FieldSpec = { mode: 'car', dir: 'to', targets: branches };

  it('packs homes × nearby branches into requests within the route limit, and serves the nearest', async () => {
    const fake = fakeOrs();
    const statuses: JobStatus[] = [];
    const kv = { fields: new MemoryKV(), snaps: new MemoryKV() };
    const p = new OrsProvider({ key: () => 'K', kv, fetchImpl: fake.fetchImpl, planDelay: 0, onStatus: (s) => statuses.push(s) });
    p.need(w, ids, new Map([[specKey(spec), { spec, weight: 1 }]]));
    await settle(statuses);
    expect(statuses.at(-1)?.state).toBe('idle');
    expect(fake.matrices.length).toBeGreaterThan(0);
    for (const m of fake.matrices) expect(m.sources * m.destinations).toBeLessThanOrEqual(3400);
    const d = p.get(spec, w, ids);
    expect(d.estimate).toBe(false);
    expect(d.provisional).toBe(0);
    for (let k = 0; k < ids.length; k += 11) {
      const home = idToLonLat(ids[k]);
      expect(d.values[k]).toBeCloseTo(Math.min(...branches.map((b) => haversine(home, b) / 600)), 2);
    }

    // Leave a branch out: the nearest is worked out again from what's cached, with only a few new requests.
    const before = fake.matrices.length;
    const fewer: FieldSpec = { ...spec, targets: branches.slice(1) };
    p.need(w, ids, new Map([[specKey(fewer), { spec: fewer, weight: 1 }]]));
    await settle(statuses);
    expect(fake.matrices.length - before).toBeLessThanOrEqual(Math.ceil(before * 0.5));
    const d2 = p.get(fewer, w, ids);
    expect(d2.provisional).toBe(0);
  });
});

describe('finding a chain’s branches (Photon)', () => {
  it('keeps real branches of the chain, splits a full box, and drops look-alikes', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: URL) => {
      const u = new URL(String(url));
      calls.push(u.searchParams.get('bbox')!);
      const depth = calls.length === 1 ? 0 : 1;
      const feature = (name: string, key: string, value: string, i: number, dx = 0) => ({
        geometry: { coordinates: [151 + i * 0.01 + dx, -33.8 - depth * 0.3] },
        properties: { name, osm_key: key, osm_value: value, osm_type: 'N', osm_id: i + depth * 1000 + calls.length * 100, district: 'Ryde' },
      });
      const features =
        depth === 0
          ? Array.from({ length: 50 }, (_, i) => feature(i % 10 === 0 ? 'Revolutions Health & Fitness' : 'Revo Fitness', 'leisure', 'fitness_centre', i))
          : [
              feature('Revo Fitness', 'leisure', 'fitness_centre', 1),
              feature('Revo Fitness', 'leisure', 'fitness_centre', 1, 0.0004), // the same gym mapped twice, ~40 m apart
              feature('Revo Fitness car park', 'amenity', 'parking', 2),
              feature('Revo Street', 'highway', 'residential', 3),
            ];
      return new Response(JSON.stringify({ features }), { status: 200 });
    });
    const pending = findBranches('Revo Fitness', [151, -34, 151.4, -33.6], 'any');
    await vi.advanceTimersByTimeAsync(5000); // the pauses between requests (fake timers in this file)
    const { options: found, partial } = await pending;
    expect(partial).toBe(false);
    expect(calls.length).toBe(5); // the full box, then its four quarters
    expect(found.some((o) => o.name.startsWith('Revolutions'))).toBe(false);
    expect(found.some((o) => o.name.startsWith('Revo Street'))).toBe(false);
    expect(found.filter((o) => o.name === 'Revo Fitness, Ryde').length).toBe(45 + 1); // 45 from the full box, 1 (twice-mapped) from the quarters
    expect(found[0].chain).toBe('Revo Fitness');
    expect(newId()).toHaveLength(8);
  });

  it('keeps what it found when part of the area fails', async () => {
    let n = 0;
    vi.stubGlobal('fetch', async () => {
      n++;
      if (n === 1) return new Response(JSON.stringify({ features: Array.from({ length: 50 }, (_, i) => ({ geometry: { coordinates: [151 + i * 0.01, -33.8] }, properties: { name: 'Coles', osm_key: 'shop', osm_value: 'supermarket', osm_type: 'N', osm_id: i } })) }), { status: 200 });
      throw new TypeError('Failed to fetch'); // every quarter fails, even after a retry
    });
    const r = findBranches('Coles', [151, -34, 151.4, -33.6], 'supermarket');
    await vi.advanceTimersByTimeAsync(20000);
    const { options, partial } = await r;
    expect(partial).toBe(true);
    expect(options.length).toBe(50);
  });
});

describe('which places branch', () => {
  it('starts a supermarket with Woolworths, Coles and Aldi ticked, and leaves work as one place', async () => {
    const { newPlace } = await import('../../src/domain/presets');
    expect(newPlace('Supermarket', 'shopping').anyOf?.chains).toEqual(['Woolworths', 'Coles', 'Aldi']);
    expect(newPlace('Chemist', 'service').anyOf?.chains).toEqual([]);
    expect(newPlace('Gym', 'gym').anyOf).toBeUndefined();
    expect(newPlace('Work', 'work').anyOf).toBeUndefined();
  });

  it('turns an older single supermarket into one with the usual chains, keeping its pin as a branch', () => {
    const s = scenarioWithShops();
    s.places[1] = { id: 'old', name: 'Shops', category: 'shopping', location: [151.1, -33.8] };
    const back = parseScenario(JSON.parse(JSON.stringify(s)))!;
    expect(back.places[1].anyOf?.chains).toEqual(['Woolworths', 'Coles', 'Aldi']);
    expect(back.places[1].anyOf?.options[0].location).toEqual([151.1, -33.8]);
    expect(back.settings.branchRouting).toBe('focus');
  });
});

describe('focusing any-branch road times on the promising part of the map', () => {
  const [cx, cy] = toMercator([151.15, -33.84]);
  const w = windowFor([cx - 5000, cy - 5000, cx + 5000, cy + 5000], LEVEL.standard);
  const ids = windowIds(w);
  const branches: LonLat[] = Array.from({ length: 12 }, (_, i) => [151.1 + (i % 4) * 0.03, -33.88 + Math.floor(i / 4) * 0.035]);
  const spec: FieldSpec = { mode: 'car', dir: 'to', targets: branches };

  it('routes only focused homes, and doesn’t wait on the rest', async () => {
    const routes = async (focus?: Uint8Array) => {
      const fake = fakeOrs();
      const statuses: JobStatus[] = [];
      const p = new OrsProvider({ key: () => 'K', kv: { fields: new MemoryKV(), snaps: new MemoryKV() }, fetchImpl: fake.fetchImpl, planDelay: 0, onStatus: (s) => statuses.push(s) });
      p.need(w, ids, new Map([[specKey(spec), { spec, weight: 1 }]]), focus);
      await settle(statuses);
      return { n: fake.matrices.reduce((a, m) => a + m.sources, 0), d: p.get(spec, w, ids) };
    };
    const all = await routes();
    const half = new Uint8Array(ids.length).map((_, k) => (k % w.nx < w.nx / 2 ? 1 : 0)); // the west half
    const some = await routes(half);
    expect(some.n).toBeLessThan(all.n * 0.6);
    expect(some.d.provisional).toBe(0);
    expect(some.d.estimate).toBe(false);
  });
});
