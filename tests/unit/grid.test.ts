import { describe, expect, it } from 'vitest';
import { demoScenario, newScenario } from '../../src/domain/presets';
import { autoArea } from '../../src/grid/area';
import { FieldData, densify } from '../../src/grid/dense';
import { despike, fillIsolatedGaps } from '../../src/grid/filters';
import { LEVEL, decodeId, idAt, idToLonLat, onLevel, pointId, windowFor, windowIds, type MercBox } from '../../src/grid/lattice';
import { fromMercator, groundScale, haversine, toMercator } from '../../src/grid/mercator';
import { mortonKey } from '../../src/grid/zorder';
import { estimateMinutes } from '../../src/routing/estimate';

describe('mercator', () => {
  it('round-trips lon/lat', () => {
    for (const p of [[151.2093, -33.8688], [0, 0], [-122.4, 37.8]] as [number, number][]) {
      const back = fromMercator(toMercator(p));
      expect(back[0]).toBeCloseTo(p[0], 9);
      expect(back[1]).toBeCloseTo(p[1], 9);
    }
  });
  it('scales to ground distance', () => {
    expect(groundScale(-33.87)).toBeCloseTo(0.83, 2);
    expect(haversine([151, -33.8], [151.01, -33.8]) / 1000).toBeCloseTo(0.925, 2);
  });
});

describe('lattice', () => {
  it('encodes and decodes ids', () => {
    for (const [i, j] of [[0, 0], [-78271, 78271], [65432, -12345]]) expect(decodeId(pointId(i, j))).toEqual([i, j]);
  });
  it('nests levels: a coarse point is the same id at finer levels', () => {
    expect(idAt(LEVEL.coarse, 3, -7)).toBe(idAt(LEVEL.standard, 6, -14));
    expect(idAt(LEVEL.standard, 6, -14)).toBe(idAt(LEVEL.fine, 12, -28));
    expect(onLevel(idAt(LEVEL.coarse, 3, -7), LEVEL.coarse)).toBe(true);
    expect(onLevel(idAt(LEVEL.standard, 7, -14), LEVEL.coarse)).toBe(false);
  });
  it('gives the same ids for overlapping windows', () => {
    const [x, y] = toMercator([151.15, -33.84]);
    const a = windowFor([x, y, x + 10000, y + 10000], LEVEL.standard);
    const b = windowFor([x + 3000, y - 2000, x + 14000, y + 8000], LEVEL.standard);
    const idsA = new Set(windowIds(a));
    const shared = [...windowIds(b)].filter((id) => idsA.has(id));
    expect(shared.length).toBeGreaterThan(100);
    // Rows run north to south.
    const ids = windowIds(a);
    expect(idToLonLat(ids[0])[1]).toBeGreaterThan(idToLonLat(ids[ids.length - 1])[1]);
  });
});

describe('auto area', () => {
  it('leaves a far, rarely visited place out of the extent', () => {
    const s = demoScenario();
    const a = autoArea(s);
    const wollongong = s.places.find((p) => p.name.includes('Wollongong'))!;
    expect(a.far).toContain(wollongong.id);
    const [, south] = fromMercator([a.box[0], a.box[1]]);
    expect(south).toBeGreaterThan(-34.1); // doesn't stretch to Wollongong (−34.43)
    expect(a.level).toBe(LEVEL.standard);
  });
  it('makes a sensible area for one place, and for none', () => {
    const s = newScenario();
    expect(autoArea(s).box[2] - autoArea(s).box[0]).toBeGreaterThan(10000);
    s.places = [{ id: 'p', name: 'Work', category: 'work', location: [151.2, -33.87] }];
    const a = autoArea(s);
    const widthKm = ((a.box[2] - a.box[0]) * groundScale(-33.87)) / 1000;
    expect(widthKm).toBeGreaterThanOrEqual(10);
    expect(widthKm).toBeLessThan(16);
  });
  it('snaps to the coarse lattice so small moves keep the same area', () => {
    const s = demoScenario();
    const a = autoArea(s);
    s.places[0].location = [s.places[0].location![0] + 0.0001, s.places[0].location![1]];
    expect(autoArea(s).box).toEqual(a.box);
    for (const v of a.box) expect(Number.isInteger(v / 1024)).toBe(true);
  });
});

describe('densify', () => {
  const box: MercBox = [0, 0, 4096, 4096];
  const w = windowFor(box, LEVEL.standard);
  const ids = windowIds(w);
  it('interpolates points not yet fetched from the coarse lattice', () => {
    const f = new FieldData();
    // Coarse points only: value = i_coarse * 10
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) f.merge([idAt(LEVEL.coarse, i, j)], [i * 10]);
    const d = densify(w, ids, f);
    expect(d.missing).toBe(0);
    expect(d.provisional).toBe(w.nx * w.ny - 25);
    // standard point i=1 (halfway between coarse 0 and 1) → 5
    const k = ids.indexOf(idAt(LEVEL.standard, 1, 2));
    expect(d.values[k]).toBeCloseTo(5, 6);
  });
  it('falls back to the estimate where nothing is known', () => {
    const fallback = new Float32Array(ids.length).fill(42);
    const d = densify(w, ids, undefined, fallback);
    expect(d.values.every((v) => v === 42)).toBe(true);
  });
});

describe('filters', () => {
  it('fills an isolated gap and removes a spike, but keeps a real edge', () => {
    const nx = 5;
    const ny = 5;
    const v = new Float32Array(25).fill(20);
    v[12] = Number.NaN;
    expect(fillIsolatedGaps(v, nx, ny)).toBe(1);
    expect(v[12]).toBe(20);
    v[12] = 40; // a spike 20 min above all neighbours
    expect(despike(v, nx, ny)).toEqual([12]);
    expect(v[12]).toBe(20);
    // A river edge: left half 20, right half 40. Nothing is beyond all its neighbours.
    const edge = new Float32Array(25).map((_, k) => (k % 5 < 3 ? 20 : 40));
    expect(despike(edge, nx, ny)).toEqual([]);
  });
  it('never fills masked points', () => {
    const v = new Float32Array(25).fill(20);
    v[12] = Number.NaN;
    const mask = new Uint8Array(25);
    mask[12] = 1;
    expect(fillIsolatedGaps(v, 5, 5, mask)).toBe(0);
  });
});

describe('z-order and estimates', () => {
  it('orders nearby points close together', () => {
    const a = mortonKey(pointId(100, 100));
    const b = mortonKey(pointId(101, 100));
    const far = mortonKey(pointId(5000, 100));
    expect(Math.abs(b - a)).toBeLessThan(Math.abs(far - a));
  });
  it('gives plausible door-to-door minutes', () => {
    const cbd: [number, number] = [151.2093, -33.8688];
    const parra: [number, number] = [151.003, -33.815];
    const car = estimateMinutes('car', cbd, parra);
    expect(car).toBeGreaterThan(25);
    expect(car).toBeLessThan(45);
    expect(estimateMinutes('walk', cbd, [151.2093, -33.8778])).toBeGreaterThan(12); // 1 km walk
    expect(estimateMinutes('bike', cbd, parra)).toBeGreaterThan(car);
  });
});
