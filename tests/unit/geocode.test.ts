import { afterEach, describe, expect, it, vi } from 'vitest';
import { peliasAutocomplete } from '../../src/routing/ors/pelias';
import { parseCoordinates } from '../../src/routing/photon';
import { readFileSync } from 'node:fs';
import { oneToMany } from '../../src/routing/ors/matrix';

afterEach(() => vi.unstubAllGlobals());

describe('pelias autocomplete', () => {
  it('asks the new host with the key and focus, and tidies the labels', async () => {
    const calls: { url: string; auth: string }[] = [];
    vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), auth: (init.headers as Record<string, string>).Authorization });
      return new Response(
        JSON.stringify({ features: [{ geometry: { coordinates: [151.181291, -33.796701] }, properties: { label: '436 Victoria Avenue, Chatswood, NSW, Australia', name: '436 Victoria Avenue', country_code: 'AU' } }] }),
        { status: 200 },
      );
    });
    const r = await peliasAutocomplete('436 Victoria Ave', [151.15, -33.84], 'AU', 'KEY');
    expect(calls[0].url).toContain('https://api.heigit.org/pelias/v1/autocomplete?text=436+Victoria+Ave');
    expect(calls[0].url).toContain('boundary.country=AU');
    expect(calls[0].auth).toBe('KEY');
    expect(r).toEqual([{ label: '436 Victoria Avenue, Chatswood, NSW', name: '436 Victoria Avenue', location: [151.181291, -33.796701], country: 'AU' }]);
  });
});

describe('coordinates', () => {
  it('reads latitude-first pasted coordinates', () => {
    expect(parseCoordinates('-33.8688, 151.2093')).toEqual([151.2093, -33.8688]);
    expect(parseCoordinates('-33.8688 151.2093')).toEqual([151.2093, -33.8688]);
    expect(parseCoordinates('Wynyard')).toBeNull();
  });
});

describe('recorded ORS responses (from the live spike, 27 Oct 2026)', () => {
  it('parses a real points → place matrix', async () => {
    const rec = JSON.parse(readFileSync(new URL('../fixtures/ors/matrix-to-6.json', import.meta.url), 'utf8'));
    const [place, ...pts] = rec.request.locations;
    const fetchImpl = (async () => new Response(JSON.stringify(rec.response), { status: 200 })) as unknown as typeof fetch;
    const r = await oneToMany('driving-car', place, pts, 'to', 'KEY', undefined, fetchImpl);
    expect(r.minutes.length).toBe(6);
    for (const m of r.minutes) {
      expect(m).toBeGreaterThan(5);
      expect(m).toBeLessThan(90);
    }
    expect(r.placeUnroutable).toBe(false);
  });

  it('parses the real 6004 error', async () => {
    const rec = JSON.parse(readFileSync(new URL('../fixtures/ors/error-6004.json', import.meta.url), 'utf8'));
    const fetchImpl = (async () => new Response(JSON.stringify(rec), { status: 400 })) as unknown as typeof fetch;
    const e = await oneToMany('driving-car', [151.2, -33.87], [[151.1, -33.8]], 'to', 'KEY', undefined, fetchImpl).catch((x) => x);
    expect(e.kind).toBe('too-big');
    expect(e.code).toBe(6004);
  });
});
