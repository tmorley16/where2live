import { contours } from 'd3-contour';
import type { Feature, FeatureCollection, MultiPolygon } from 'geojson';
import type { GridWindow } from '../grid/lattice';
import { fromMercator } from '../grid/mercator';
import type { Bands } from './bands';

export interface BandProps {
  band: number;
  colour: string;
  /** Higher draws on top: the best band, innermost, goes last. */
  sort: number;
}

/**
 * Nested band polygons from a surface. Contours run on −T, so each polygon is "T ≤ the band's upper edge":
 * masked (NaN) points fall below every threshold and stay unshaded, and the best band is innermost.
 * Drawn best-on-top in one layer with a layer-level opacity, the nesting reads as clean, non-overlapping bands.
 */
export function bandFeatures(values: Float32Array, w: GridWindow, b: Bands): FeatureCollection<MultiPolygon, BandProps> {
  const neg = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) neg[i] = -values[i];
  const gen = contours().size([w.nx, w.ny]);
  const n = b.bands.length;
  const features: Feature<MultiPolygon, BandProps>[] = [];
  // Grid units: ⟨c + 0.5, r + 0.5⟩ is the centre of element (c, r), i.e. lattice point (i0 + c, jTop − r).
  const toLonLat = ([x, y]: number[]) => fromMercator([(w.i0 + x - 0.5) * w.s, (w.jTop - (y - 0.5)) * w.s]);
  for (let k = n - 1; k >= 0; k--) {
    const shape = gen.contour(neg as unknown as number[], -b.bands[k].upper);
    if (shape.coordinates.length === 0) continue;
    const coordinates = shape.coordinates.map((poly) => poly.map((ring) => ring.map(toLonLat)));
    features.push({ type: 'Feature', properties: { band: k, colour: b.bands[k].colour, sort: n - k }, geometry: { type: 'MultiPolygon', coordinates } });
  }
  return { type: 'FeatureCollection', features };
}

/** Where a surface is at or above a level, as one polygon feature (NaN points are left out). */
export function aboveFeatures(values: Float32Array, w: GridWindow, level: number): FeatureCollection<MultiPolygon> {
  const vals = Float64Array.from(values);
  const shape = contours().size([w.nx, w.ny]).contour(vals as unknown as number[], level);
  if (shape.coordinates.length === 0) return { type: 'FeatureCollection', features: [] };
  const toLonLat = ([x, y]: number[]) => fromMercator([(w.i0 + x - 0.5) * w.s, (w.jTop - (y - 0.5)) * w.s]);
  const coordinates = shape.coordinates.map((poly) => poly.map((ring) => ring.map(toLonLat)));
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates } }] };
}
