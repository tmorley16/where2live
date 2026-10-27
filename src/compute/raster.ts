import type { PaletteId } from '../domain/types';
import { bandOf, type Bands } from './bands';
import { hexToRgb, rampColour } from './palettes';

/**
 * One RGBA pixel per lattice point, for the Cells (sharp squares) and Smooth (blended) styles.
 * Unshaded where there's no data or the value is beyond the top band.
 */
export function rasterPixels(values: Float32Array, b: Bands, style: 'cells' | 'smooth', palette: PaletteId): Uint8ClampedArray {
  const px = new Uint8ClampedArray(values.length * 4);
  const rgb = b.bands.map((x) => hexToRgb(x.colour));
  const span = b.top - b.base;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const k = bandOf(b, v);
    if (k < 0) continue;
    const c = style === 'cells' ? rgb[k] : rampColour(palette, span > 0 ? (v - b.base) / span : 0);
    px[i * 4] = c[0];
    px[i * 4 + 1] = c[1];
    px[i * 4 + 2] = c[2];
    px[i * 4 + 3] = 255;
  }
  return px;
}
