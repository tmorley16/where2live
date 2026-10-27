import type { FeatureCollection } from 'geojson';
import type { GeoJSONSource, ImageSource, Map as MlMap } from 'maplibre-gl';
import { bandFeatures } from '../compute/contours';
import type { Frame } from '../compute/engine';
import { rasterPixels } from '../compute/raster';
import type { Place, Settings } from '../domain/types';
import { areaBBox, type Area } from '../grid/area';
import { windowCorners } from '../grid/lattice';
import { BANDS_BEFORE, WASHOUT_LAYERS } from './style';

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const CLEAR_PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/**
 * The travel-time surface on the map: vector bands (default), or a raster of cells / a smooth ramp.
 * Everything sits beneath the basemap's water, roads and labels, so the geography stays readable.
 */
export class SurfaceLayers {
  private busy = false;
  private next: (() => Promise<void>) | null = null;
  private canvas = document.createElement('canvas');
  private lastStyle: Settings['display']['style'] | null = null;

  constructor(private map: MlMap) {
    const before = map.getLayer(BANDS_BEFORE) ? BANDS_BEFORE : undefined;
    map.addSource('w2l-bands', { type: 'geojson', data: EMPTY, maxzoom: 12 });
    map.addLayer(
      {
        id: 'w2l-bands',
        type: 'fill',
        source: 'w2l-bands',
        layout: { 'fill-sort-key': ['get', 'sort'] },
        paint: { 'fill-color': ['get', 'colour'], 'fill-layer-opacity': 0.6 },
      },
      before,
    );
    map.addLayer(
      {
        id: 'w2l-band-edges',
        type: 'line',
        source: 'w2l-bands',
        layout: { visibility: 'none' },
        paint: { 'line-color': '#1d2125', 'line-opacity': 0.3, 'line-width': 0.6 },
      },
      before,
    );
    map.addSource('w2l-cells', { type: 'image', url: CLEAR_PIXEL, coordinates: [[0, 0.001], [0.001, 0.001], [0.001, 0], [0, 0]] });
    map.addLayer(
      {
        id: 'w2l-cells',
        type: 'raster',
        source: 'w2l-cells',
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 0.6, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' },
      },
      before,
    );
    map.addSource('w2l-area', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'w2l-area', type: 'line', source: 'w2l-area', paint: { 'line-color': '#5b6670', 'line-width': 1, 'line-dasharray': [3, 3], 'line-opacity': 0.7 } });
    // The branches of "any branch" places: small dots (a supermarket chain can have a hundred).
    map.addSource('w2l-branches', { type: 'geojson', data: EMPTY });
    map.addLayer({
      id: 'w2l-branches',
      type: 'circle',
      source: 'w2l-branches',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 14, 5], 'circle-color': '#1d2125', 'circle-opacity': 0.65 },
    });
    for (const id of WASHOUT_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
  }

  /** Draw a frame. Only the latest update is kept waiting while the map is still busy with the previous one. */
  render(frame: Frame | null, display: Settings['display']): void {
    this.enqueue(async () => {
      if (!frame) {
        this.lastStyle = null;
        await (this.map.getSource('w2l-bands') as GeoJSONSource).setData(EMPTY);
        this.map.setLayoutProperty('w2l-cells', 'visibility', 'none');
        return;
      }
      const vector = display.style === 'bands';
      if (vector) {
        await (this.map.getSource('w2l-bands') as GeoJSONSource).setData(bandFeatures(frame.values, frame.window, frame.bands));
      } else {
        const { nx, ny } = frame.window;
        this.canvas.width = nx;
        this.canvas.height = ny;
        const ctx = this.canvas.getContext('2d')!;
        ctx.putImageData(new ImageData(rasterPixels(frame.values, frame.bands, display.style === 'cells' ? 'cells' : 'smooth', display.palette) as Uint8ClampedArray<ArrayBuffer>, nx, ny), 0, 0);
        (this.map.getSource('w2l-cells') as ImageSource).updateImage({ image: this.canvas, coordinates: windowCorners(frame.window) });
        if (this.lastStyle === 'bands' || this.lastStyle === null) await (this.map.getSource('w2l-bands') as GeoJSONSource).setData(EMPTY);
      }
      this.applyDisplay(display);
      this.lastStyle = display.style;
    });
  }

  applyDisplay(display: Settings['display']): void {
    const vector = display.style === 'bands';
    this.map.setLayoutProperty('w2l-cells', 'visibility', vector ? 'none' : 'visible');
    this.map.setLayoutProperty('w2l-band-edges', 'visibility', vector && display.edges ? 'visible' : 'none');
    this.map.setPaintProperty('w2l-bands', 'fill-layer-opacity', display.opacity);
    this.map.setPaintProperty('w2l-cells', 'raster-opacity', display.opacity);
    this.map.setPaintProperty('w2l-cells', 'raster-resampling', display.style === 'cells' ? 'nearest' : 'linear');
  }

  private branchesKey = '';

  showBranches(places: Place[]): void {
    const features = places.flatMap((p) =>
      (p.anyOf?.options ?? []).map((o) => ({ type: 'Feature' as const, properties: { name: o.name, place: p.name }, geometry: { type: 'Point' as const, coordinates: o.location } })),
    );
    const key = features.map((f) => f.geometry.coordinates.join(',')).join(';');
    if (key === this.branchesKey) return;
    this.branchesKey = key;
    void (this.map.getSource('w2l-branches') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
  }

  showArea(area: Area | null): void {
    if (!area) {
      void (this.map.getSource('w2l-area') as GeoJSONSource).setData(EMPTY);
      return;
    }
    const [w, s, e, n] = areaBBox(area);
    void (this.map.getSource('w2l-area') as GeoJSONSource).setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[w, s], [e, s], [e, n], [w, n], [w, s]] },
    });
  }

  private enqueue(job: () => Promise<void>): void {
    if (this.busy) {
      this.next = job;
      return;
    }
    this.busy = true;
    job()
      .catch((e) => console.warn('Where2Live: drawing failed', e))
      .finally(() => {
        this.busy = false;
        const n = this.next;
        this.next = null;
        if (n) this.enqueue(n);
      });
  }
}
