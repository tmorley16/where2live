import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryKV } from '../../src/cache/kv';
import { coordKey, specKey, type FieldSpec } from '../../src/domain/fields';
import type { LonLat } from '../../src/domain/types';
import { LEVEL, idToLonLat, windowFor, windowIds } from '../../src/grid/lattice';
import { haversine, toMercator } from '../../src/grid/mercator';
import { OrsProvider } from '../../src/routing/orsProvider';
import type { JobStatus } from '../../src/state/appStore';

beforeEach(() => vi.useFakeTimers({ now: 1_000_000_000_000 }));
afterEach(() => vi.useRealTimers());

interface FakeOpts {
  water?: (p: LonLat) => boolean;
  island?: Set<string>;
  maxRoutes?: number;
}

/** A pretend openrouteservice: 10 m/s as the crow flies; water has no roads; an island point nulls whole matrices. */
function fakeOrs(o: FakeOpts = {}) {
  const calls: { kind: 'snap' | 'matrix'; n: number }[] = [];
  const water = o.water ?? (() => false);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': String(500 - calls.length), 'x-ratelimit-reset': '9999999999' } });
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (url.includes('/snap/')) {
      calls.push({ kind: 'snap', n: body.locations.length });
      return json({ locations: body.locations.map((l: LonLat) => (water(l) ? null : { location: l, snapped_distance: 12 })) });
    }
    const locs: LonLat[] = body.locations;
    const routes = body.sources.length * body.destinations.length;
    calls.push({ kind: 'matrix', n: routes });
    if (routes > (o.maxRoutes ?? 3500)) return json({ error: { code: 6004, message: `Only a total of ${o.maxRoutes} routes are allowed.` } }, 400);
    const island = locs.some((l) => o.island?.has(coordKey(l)));
    const at = (i: number) => (water(locs[i]) ? null : { location: locs[i], snapped_distance: 8 });
    return json({
      durations: body.sources.map((i: number) => body.destinations.map((j: number) => (island || water(locs[i]) || water(locs[j]) ? null : haversine(locs[i], locs[j]) / 10))),
      distances: body.sources.map((i: number) => body.destinations.map((j: number) => (island ? null : haversine(locs[i], locs[j]) / 1000))),
      sources: body.sources.map(at),
      destinations: body.destinations.map(at),
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function setup(fake: ReturnType<typeof fakeOrs>, kv = { fields: new MemoryKV(), snaps: new MemoryKV() }, maxChunk = { n: 3400 }) {
  const statuses: JobStatus[] = [];
  const p = new OrsProvider({
    key: () => 'KEY',
    kv,
    fetchImpl: fake.fetchImpl,
    planDelay: 0,
    onStatus: (s) => statuses.push(s),
    maxChunk: () => maxChunk.n,
    onMaxChunk: (n) => (maxChunk.n = n),
  });
  return { p, statuses, kv, maxChunk };
}

async function settle(statuses: JobStatus[]) {
  for (let i = 0; i < 400; i++) {
    await vi.advanceTimersByTimeAsync(500);
    const s = statuses.at(-1);
    if (i > 2 && s && ['idle', 'error', 'confirm', 'auth'].includes(s.state)) break;
  }
  await vi.advanceTimersByTimeAsync(1000); // let saves flush
}

const [cx, cy] = toMercator([151.15, -33.84]);
const window = windowFor([cx - 4000, cy - 4000, cx + 4000, cy + 4000], LEVEL.standard);
const ids = windowIds(window);
const work: FieldSpec = { mode: 'car', dir: 'to', targets: [[151.2057, -33.8657]] };
const needs = (...specs: FieldSpec[]) => new Map(specs.map((s) => [specKey(s), { spec: s, weight: 1 }]));

describe('OrsProvider', () => {
  it('checks roads, then fetches the coarse lattice, then the rest; then serves real times', async () => {
    const fake = fakeOrs({ water: ([lon]) => lon > 151.175 && lon < 151.2 }); // a strip of "harbour" on the east side
    const { p, statuses } = setup(fake);
    const before = p.get(work, window, ids);
    expect(before.estimate).toBe(true);
    p.need(window, ids, needs(work));
    await settle(statuses);
    const snaps = fake.calls.filter((c) => c.kind === 'snap');
    const matrix = fake.calls.filter((c) => c.kind === 'matrix');
    expect(snaps.reduce((a, c) => a + c.n, 0)).toBe(ids.length);
    expect(matrix.length).toBe(2); // coarse, then the rest
    expect(matrix[0].n).toBeLessThan(matrix[1].n);
    const mask = p.mask(window, ids)!;
    const landIds = Array.from(ids).filter((_, k) => !mask[k]);
    expect(matrix.reduce((a, c) => a + c.n, 0)).toBe(landIds.length); // water points are never routed
    const after = p.get(work, window, ids);
    expect(after.estimate).toBe(false);
    expect(after.provisional).toBe(0);
    const k = ids.indexOf(landIds[0]);
    expect(after.values[k]).toBeCloseTo(haversine(idToLonLat(landIds[0]), work.targets[0]) / 600, 1);
    expect(statuses.at(-1)?.state).toBe('idle');
  });

  it('serves the cache without a single request, and moving a place fetches only that place', async () => {
    const fake = fakeOrs();
    const first = setup(fake);
    first.p.need(window, ids, needs(work));
    await settle(first.statuses);
    const n = fake.calls.length;
    // A fresh provider (a reload) with the same storage.
    const again = setup(fake, first.kv);
    again.p.need(window, ids, needs(work));
    await settle(again.statuses);
    expect(fake.calls.length).toBe(n);
    // Move the place: matrix requests for the new spot only, no new road checks.
    const moved: FieldSpec = { ...work, targets: [[151.21, -33.87]] };
    again.p.need(window, ids, needs(moved));
    await settle(again.statuses);
    const extra = fake.calls.slice(n);
    expect(extra.every((c) => c.kind === 'matrix')).toBe(true);
    expect(extra.length).toBe(2);
  });

  it('finds a point on a separate network (all-null matrices) and keeps everything else', async () => {
    const islandId = ids[Math.floor(ids.length / 2) + 3];
    const fake = fakeOrs({ island: new Set([coordKey(idToLonLat(islandId))]) });
    const { p, statuses } = setup(fake);
    p.need(window, ids, needs(work));
    await settle(statuses);
    const d = p.get(work, window, ids);
    expect(d.estimate).toBe(false);
    const known = Array.from(d.values).filter(Number.isFinite).length;
    expect(known).toBe(ids.length); // the island point is filled from its neighbours
    expect(fake.calls.length).toBeLessThan(40);
    // A reload doesn't ask about the island point again.
    const n = fake.calls.length;
    const again = setup(fake, { fields: new MemoryKV(), snaps: (p as unknown as { o: { kv: { snaps: MemoryKV } } }).o.kv.snaps });
    again.p.need(window, ids, needs(work));
    await settle(again.statuses);
    expect(fake.calls.slice(n).filter((c) => c.kind === 'matrix').some((c) => c.n === 1)).toBe(false);
  });

  it('halves requests after a 6004 and remembers the limit', async () => {
    const fake = fakeOrs({ maxRoutes: 100 });
    const { p, statuses, maxChunk } = setup(fake);
    p.need(window, ids, needs(work));
    await settle(statuses);
    expect(maxChunk.n).toBeLessThanOrEqual(100);
    expect(p.get(work, window, ids).provisional).toBe(0);
  });

  it('reports a place it can’t reach', async () => {
    const fake = fakeOrs({ water: ([lon, lat]) => Math.abs(lon - 151.3) < 0.01 && Math.abs(lat + 33.8) < 0.01 });
    const { p, statuses } = setup(fake);
    const wet: FieldSpec = { mode: 'car', dir: 'to', targets: [[151.3, -33.8]] };
    p.need(window, ids, needs(wet));
    await settle(statuses);
    expect(statuses.at(-1)?.failures?.[specKey(wet)]).toBe('no-road');
  });

  it('asks before a big batch, and goes on a yes', async () => {
    const fake = fakeOrs();
    const { p, statuses, maxChunk } = setup(fake, undefined, { n: 5 });
    p.need(window, ids, needs(work));
    await settle(statuses);
    const s = statuses.at(-1)!;
    expect(s.state).toBe('confirm');
    expect(s.confirm!.requests).toBeGreaterThan(30);
    expect(fake.calls.filter((c) => c.kind === 'matrix').length).toBe(0);
    maxChunk.n = 3400;
    p.confirmBatch();
    await settle(statuses);
    expect(fake.calls.filter((c) => c.kind === 'matrix').length).toBeGreaterThan(30);
  });
});
