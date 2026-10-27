import { describe, expect, it } from 'vitest';
import { OrsError, orsPost, readQuota } from '../../src/routing/ors/client';
import { oneToMany } from '../../src/routing/ors/matrix';
import { snapDistances } from '../../src/routing/ors/snap';

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}): { fn: typeof fetch; calls: { url: string; body: unknown; headers: Record<string, string> }[] } {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('quota headers', () => {
  it('reads epoch seconds and seconds-from-now', () => {
    const now = 1_700_000_000_000;
    expect(readQuota(new Headers({ 'x-ratelimit-remaining': '462', 'x-ratelimit-reset': '1700003600' }), now)).toEqual({ remaining: 462, resetAt: 1_700_003_600_000, seenAt: now });
    expect(readQuota(new Headers({ 'x-ratelimit-remaining': '3', 'x-ratelimit-reset': '23' }), now)?.resetAt).toBe(now + 23_000);
    expect(readQuota(new Headers({}), now)).toBeNull();
  });
});

describe('matrix one-to-many', () => {
  const place: [number, number] = [151.2, -33.87];
  const pts: [number, number][] = [[151.1, -33.8], [151.11, -33.8], [151.12, -33.8]];

  it('asks for points → place with explicit sources and destinations, and parses the column', async () => {
    const { fn, calls } = fakeFetch(
      200,
      {
        durations: [[600], [null], [1200]],
        distances: [[8.2], [null], [15.5]],
        sources: [{ location: [151.1, -33.8], snapped_distance: 12 }, null, { location: [151.12, -33.8], snapped_distance: 410 }],
        destinations: [{ location: place, snapped_distance: 3 }],
      },
      { 'x-ratelimit-remaining': '499', 'x-ratelimit-reset': '1700003600' },
    );
    const r = await oneToMany('driving-car', place, pts, 'to', 'KEY', undefined, fn);
    expect(calls[0].url).toBe('https://api.heigit.org/openrouteservice/v2/matrix/driving-car');
    expect(calls[0].headers.Authorization).toBe('KEY');
    expect(calls[0].body).toMatchObject({ sources: [1, 2, 3], destinations: [0], metrics: ['duration', 'distance'] });
    expect(Array.from(r.minutes)).toEqual([10, Number.NaN, 20]);
    expect(Array.from(r.snappedM)).toEqual([12, Number.NaN, 410]);
    expect(r.placeUnroutable).toBe(false);
    expect(r.quota?.remaining).toBe(499);
  });

  it('asks for place → points and parses the row', async () => {
    const { fn, calls } = fakeFetch(200, { durations: [[300, 360, null]], sources: [null], destinations: [{ location: pts[0] }, { location: pts[1] }, null] });
    const r = await oneToMany('driving-car', place, pts, 'from', 'KEY', undefined, fn);
    expect(calls[0].body).toMatchObject({ sources: [0], destinations: [1, 2, 3] });
    expect(Array.from(r.minutes)).toEqual([5, 6, Number.NaN]);
    expect(r.placeUnroutable).toBe(true);
  });

  it('classifies errors', async () => {
    const cases: [number, unknown, Record<string, string>, string][] = [
      [400, { error: { code: 6004, message: 'Only a total of 3500 routes are allowed.' } }, {}, 'too-big'],
      [400, { error: { code: 6010, message: 'Source point(s) out of bounds' } }, {}, 'out-of-bounds'],
      [400, { error: { code: 6099, message: 'Unable to compute a distance/duration matrix.' } }, {}, 'too-far'],
      [401, { error: 'Authorization field missing' }, {}, 'auth'],
      [403, { error: 'Access to this API has been disallowed' }, {}, 'auth'],
      [403, { error: 'Quota exceeded' }, { 'x-ratelimit-remaining': '0' }, 'quota'],
      [429, { error: 'Rate Limit Exceeded' }, {}, 'rate'],
      [502, null, {}, 'server'],
    ];
    for (const [status, body, headers, kind] of cases) {
      const { fn } = fakeFetch(status, body, headers);
      const e = await oneToMany('driving-car', place, pts, 'to', 'KEY', undefined, fn).catch((x) => x);
      expect(e).toBeInstanceOf(OrsError);
      expect((e as OrsError).kind, `${status} ${JSON.stringify(body)}`).toBe(kind);
    }
  });

  it('reports a network failure', async () => {
    const fn = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const e = await orsPost('/v2/snap/driving-car', {}, 'KEY', undefined, fn).catch((x) => x);
    expect((e as OrsError).kind).toBe('network');
  });
});

describe('snap', () => {
  it('gives metres to the road, NaN where none is near', async () => {
    const { fn, calls } = fakeFetch(200, { locations: [{ location: [151.1, -33.8], snapped_distance: 40.5 }, null, { location: [151.12, -33.8] }] });
    const r = await snapDistances('driving-car', [[151.1, -33.8], [151.4, -33.85], [151.12, -33.8]], 300, 'KEY', undefined, fn);
    expect(calls[0].body).toEqual({ locations: [[151.1, -33.8], [151.4, -33.85], [151.12, -33.8]], radius: 300 });
    expect(r.metres[0]).toBeCloseTo(40.5, 3);
    expect(Number.isNaN(r.metres[1])).toBe(true);
    expect(r.metres[2]).toBe(0);
  });
});
