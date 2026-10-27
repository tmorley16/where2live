import type { Geometry } from 'geojson';
import type { Map as MlMap } from 'maplibre-gl';
import type { LonLat } from '../domain/types';
import { lonLatToElement, windowBox, type GridWindow } from '../grid/lattice';
import { fromMercator } from '../grid/mercator';

/** National parks and reserves: no homes (masked in estimate mode; with routing, the road check finds them). */
const PARK_CLASSES = new Set(['national_park', 'nature_reserve']);

/** Is the whole window inside the current view, so its basemap tiles are loaded? */
export function windowInView(map: MlMap, w: GridWindow): boolean {
  const [x0, y0, x1, y1] = windowBox(w);
  const [west, south] = fromMercator([x0, y0]);
  const [east, north] = fromMercator([x1, y1]);
  const b = map.getBounds();
  return b.getWest() <= west && b.getEast() >= east && b.getSouth() <= south && b.getNorth() >= north;
}

/**
 * Rasterises the basemap's water (and optionally national parks) onto the lattice: one canvas pixel per point,
 * so a point is masked when the polygons cover it. Needs the window's tiles loaded (see windowInView).
 */
export function basemapMask(map: MlMap, w: GridWindow, parks: boolean): Uint8Array | null {
  if (!map.getSource('openmaptiles')) return null;
  const features = [
    ...map.querySourceFeatures('openmaptiles', { sourceLayer: 'water' }),
    ...(parks ? map.querySourceFeatures('openmaptiles', { sourceLayer: 'park' }).filter((f) => PARK_CLASSES.has(String(f.properties?.class))) : []),
  ];
  const canvas = document.createElement('canvas');
  canvas.width = w.nx;
  canvas.height = w.ny;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = '#000';
  // Pixel centres sit at +0.5, matching lattice points.
  const pt = (p: number[]): [number, number] => {
    const [c, r] = lonLatToElement(w, p as LonLat);
    return [c + 0.5, r + 0.5];
  };
  const drawPolygon = (rings: number[][][]) => {
    ctx.beginPath();
    for (const ring of rings) {
      ring.forEach((p, i) => {
        const [x, y] = pt(p);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
    ctx.fill('evenodd'); // holes (islands) stay unmasked; each polygon filled on its own so overlaps don't cancel
  };
  const draw = (g: Geometry) => {
    if (g.type === 'Polygon') drawPolygon(g.coordinates);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach(drawPolygon);
  };
  for (const f of features) draw(f.geometry);
  const data = ctx.getImageData(0, 0, w.nx, w.ny).data;
  const mask = new Uint8Array(w.nx * w.ny);
  for (let k = 0; k < mask.length; k++) mask[k] = data[k * 4 + 3] >= 128 ? 1 : 0;
  return mask;
}
