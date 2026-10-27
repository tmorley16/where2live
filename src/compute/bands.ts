import type { PaletteId } from '../domain/types';
import { fmtEdge } from './format';
import { bandColours } from './palettes';

export interface Band {
  lower: number;
  upper: number;
  colour: string;
  label: string;
}

export interface Bands {
  /** rank: the Overall view, banded by how a spot ranks against the rest of the map. */
  mode: 'absolute' | 'relative' | 'rank';
  /** Band width in minutes a week (absolute mode). */
  step: number;
  bands: Band[];
  /** Upper edge of the last band; anything above is left unshaded. */
  top: number;
  /** Lower edge of the first band. */
  base: number;
}

export const STEPS = [10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720];
export const RELATIVE = [15, 30, 60, 90, 120, 180, 240, 360];
const MAX_AUTO_BANDS = 7;

function relLabel(a: number, b: number): string {
  return a === 0 ? `best to +${fmtEdge(b)}` : `+${fmtEdge(a)} to +${fmtEdge(b)}`;
}

/**
 * Band edges for a surface whose best value is `min` and whose 90th percentile is `p90` (minutes a week).
 * Absolute: round steps (10 min … 12 h) giving about seven bands up to the 90th percentile.
 * Relative: extra time compared with the best spot.
 */
export function makeBands(min: number, p90: number, mode: 'absolute' | 'relative', step: number | 'auto', palette: PaletteId): Bands {
  if (!Number.isFinite(min)) return { mode, step: 0, bands: [], top: Number.NaN, base: Number.NaN };
  const hi = Math.max(p90, min);
  if (mode === 'relative') {
    let n = RELATIVE.findIndex((o) => o >= hi - min) + 1;
    if (n === 0) n = RELATIVE.length;
    n = Math.min(RELATIVE.length, Math.max(3, n));
    const colours = bandColours(palette, n);
    const edges = [0, ...RELATIVE.slice(0, n)];
    const bands = colours.map((colour, k) => ({ lower: min + edges[k], upper: min + edges[k + 1], colour, label: relLabel(edges[k], edges[k + 1]) }));
    return { mode, step: 0, bands, top: bands[n - 1].upper, base: min };
  }
  const count = (s: number) => Math.max(1, Math.ceil((hi - Math.floor(min / s) * s) / s));
  let s = typeof step === 'number' && step > 0 ? step : STEPS.find((x) => count(x) <= MAX_AUTO_BANDS) ?? STEPS[STEPS.length - 1];
  if (typeof step === 'number' && count(s) > 12) s = STEPS.find((x) => count(x) <= 12) ?? s;
  const base = Math.floor(min / s) * s;
  const n = Math.min(12, count(s));
  const colours = bandColours(palette, n);
  const bands = colours.map((colour, k) => {
    const lower = base + k * s;
    const upper = lower + s;
    return { lower, upper, colour, label: `${fmtEdge(lower)} – ${fmtEdge(upper)}` };
  });
  return { mode, step: s, bands, top: bands[n - 1].upper, base };
}

/** How the Overall view bands the map: the best 5% of spots, then the best 10%, and so on to 60%. */
export const RANKS = [0.05, 0.1, 0.2, 0.3, 0.45, 0.6];

/** Bands by rank, from every valid value in ascending order. */
export function rankBands(sorted: Float32Array, palette: PaletteId): Bands {
  if (sorted.length === 0) return { mode: 'rank', step: 0, bands: [], top: Number.NaN, base: Number.NaN };
  const colours = bandColours(palette, RANKS.length);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
  const bands = RANKS.map((q, k) => ({ lower: k === 0 ? sorted[0] : at(RANKS[k - 1]), upper: at(q), colour: colours[k], label: `Top ${Math.round(q * 100)}%` }));
  return { mode: 'rank', step: 0, bands, top: bands[bands.length - 1].upper, base: sorted[0] };
}

/** Index of the band holding a value, or −1 when unshaded. */
export function bandOf(b: Bands, v: number): number {
  if (!Number.isFinite(v) || v > b.top) return -1;
  for (let k = 0; k < b.bands.length; k++) if (v <= b.bands[k].upper) return k;
  return -1;
}
