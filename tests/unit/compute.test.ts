import { describe, expect, it } from 'vitest';
import { bandOf, makeBands } from '../../src/compute/bands';
import { breakdownAt } from '../../src/compute/breakdown';
import { bandFeatures } from '../../src/compute/contours';
import { fmtDuration, fmtEdge, fmtHM } from '../../src/compute/format';
import { rasterPixels } from '../../src/compute/raster';
import { sampleAt } from '../../src/compute/sample';
import { stats, viewValues, applyMask } from '../../src/compute/surface';
import { specKey } from '../../src/domain/fields';
import { buildForms } from '../../src/domain/formula';
import { demoScenario } from '../../src/domain/presets';
import { LEVEL, windowFor, windowIds, elementMercator } from '../../src/grid/lattice';
import { fromMercator, toMercator } from '../../src/grid/mercator';
import { estimateField } from '../../src/routing/estimate';

describe('format', () => {
  it('formats durations', () => {
    expect(fmtDuration(294)).toBe('4 h 54 min');
    expect(fmtDuration(35)).toBe('35 min');
    expect(fmtDuration(600)).toBe('10 h');
    expect(fmtHM(608.83)).toBe('10:09');
    expect(fmtEdge(570)).toBe('9 h 30');
    expect(fmtEdge(45)).toBe('45 min');
  });
});

describe('bands', () => {
  it('picks a round step giving at most seven bands up to the 90th percentile', () => {
    const b = makeBands(578, 900, 'absolute', 'auto', 'ylgnbu');
    expect(b.step).toBe(60);
    expect(b.base).toBe(540);
    expect(b.bands.length).toBeLessThanOrEqual(7);
    expect(b.top).toBeGreaterThanOrEqual(900);
    expect(b.bands[0].label).toBe('9 h – 10 h');
    expect(b.bands[0].colour).toBe('#0c2c84');
    expect(b.bands.at(-1)!.colour).toBe('#ffffd9');
  });
  it('makes relative bands from the best value', () => {
    const b = makeBands(578, 640, 'relative', 'auto', 'ylgnbu');
    expect(b.bands.map((x) => x.upper - 578)).toEqual([15, 30, 60, 90]);
    expect(b.bands[0].label).toBe('best to +15 min');
  });
  it('finds the band of a value', () => {
    const b = makeBands(578, 900, 'absolute', 'auto', 'ylgnbu');
    expect(bandOf(b, 578)).toBe(0);
    expect(bandOf(b, 601)).toBe(1);
    expect(bandOf(b, b.top + 1)).toBe(-1);
    expect(bandOf(b, Number.NaN)).toBe(-1);
  });
});

describe('surface, contours and raster on the demo', () => {
  const s = demoScenario();
  const forms = buildForms(s);
  const [x, y] = toMercator([151.15, -33.84]);
  const w = windowFor([x - 12000, y - 12000, x + 12000, y + 12000], LEVEL.standard);
  const ids = windowIds(w);
  const dense = new Map([...forms.specs].map(([k, spec]) => [k, estimateField(spec, ids)]));
  const n = w.nx * w.ny;

  it('evaluates every point and finds a best spot', () => {
    const v = viewValues(forms, { kind: 'combined' }, dense, n);
    const st = stats(v);
    expect(st.valid).toBe(n);
    expect(st.min).toBeGreaterThan(60);
    expect(st.min).toBeLessThan(st.p90);
    // Fairest is the busier person, so never more than the combined total.
    const fair = viewValues(forms, { kind: 'fairest' }, dense, n);
    for (let i = 0; i < n; i += 97) expect(fair[i]).toBeLessThanOrEqual(v[i] + 1e-3);
  });

  it('draws masked points unshaded and nests bands best-innermost', () => {
    const v = viewValues(forms, { kind: 'combined' }, dense, n);
    const mask = new Uint8Array(n);
    mask[0] = 1;
    applyMask(v, mask);
    const st = stats(v);
    const b = makeBands(st.min, st.p90, 'absolute', 'auto', 'ylgnbu');
    const fc = bandFeatures(v, w, b);
    expect(fc.features.length).toBe(b.bands.length);
    // The best band is drawn last (on top).
    expect(fc.features.at(-1)!.properties.band).toBe(0);
    // Coordinates are lon/lat inside the window.
    const [lon, lat] = fc.features[0].geometry.coordinates[0][0][0];
    expect(lon).toBeGreaterThan(150.9);
    expect(lat).toBeLessThan(-33.6);
    // The best point lies inside the best band's polygon (checked by its bounding box).
    const best = fromMercator(elementMercator(w, st.argmin % w.nx, Math.floor(st.argmin / w.nx)));
    const ring = fc.features.at(-1)!.geometry.coordinates.flat(2);
    const lons = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    expect(best[0]).toBeGreaterThanOrEqual(Math.min(...lons));
    expect(best[0]).toBeLessThanOrEqual(Math.max(...lons));
    expect(best[1]).toBeGreaterThanOrEqual(Math.min(...lats));
    expect(best[1]).toBeLessThanOrEqual(Math.max(...lats));
    // Raster: masked pixel transparent, best pixel opaque in the best colour.
    const px = rasterPixels(v, b, 'cells', 'ylgnbu');
    expect(px[3]).toBe(0);
    expect(px[st.argmin * 4 + 3]).toBe(255);
  });

  it('samples between points and agrees with the per-trip breakdown', () => {
    const v = viewValues(forms, { kind: 'combined' }, dense, n);
    const p = fromMercator(elementMercator(w, 10, 12));
    const smp = sampleAt(v, w, p)!;
    const bd = breakdownAt(s, (spec) => sampleAt(dense.get(specKey(spec))!, w, p)!.value);
    expect(smp.value).toBeCloseTo(bd.combined, 2);
    expect([...bd.persons.values()].reduce((a, c) => a + c, 0)).toBeCloseTo(bd.combined, 2);
    expect(bd.fairest).toBe(Math.max(...bd.persons.values()));
  });
});
