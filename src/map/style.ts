import type { StyleSpecification } from 'maplibre-gl';

/** OpenFreeMap's light style: free, no key, and muted enough to carry a data overlay. */
export const POSITRON_URL = 'https://tiles.openfreemap.org/styles/positron';

/** A plain background with no network requests, for tests (`?style=blank`) and as a fallback. */
export const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f2f1ee' } }],
};

export function styleFor(search: string): string | StyleSpecification {
  return new URLSearchParams(search).get('style') === 'blank' ? BLANK_STYLE : POSITRON_URL;
}

/** Positron's layers that wash out the bands when drawn over them. Hidden while the bands are shown. */
export const WASHOUT_LAYERS = ['landuse_residential', 'landcover_wood'];

/** The bands go beneath this layer, so opaque water clips them and roads and labels sit on top. */
export const BANDS_BEFORE = 'water';
