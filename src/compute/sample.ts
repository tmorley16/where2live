import type { LonLat } from '../domain/types';
import { lonLatToElement, type GridWindow } from '../grid/lattice';

export interface Sample {
  value: number;
  /** Range of the surrounding points: a wide range means the value changes sharply here (a river, a motorway). */
  lo: number;
  hi: number;
}

/**
 * Bilinear sample of a window's values at a point. Masked corners are left out and the rest re-weighted;
 * null outside the window or where less than a quarter of the weight is known.
 */
export function sampleAt(values: Float32Array, w: GridWindow, p: LonLat): Sample | null {
  const [c, r] = lonLatToElement(w, p);
  if (c < 0 || r < 0 || c > w.nx - 1 || r > w.ny - 1) return null;
  const c0 = Math.min(w.nx - 2, Math.floor(c));
  const r0 = Math.min(w.ny - 2, Math.floor(r));
  const fx = c - c0;
  const fy = r - r0;
  let sum = 0;
  let weight = 0;
  let lo = Infinity;
  let hi = -Infinity;
  const corners: [number, number, number][] = [[c0, r0, (1 - fx) * (1 - fy)], [c0 + 1, r0, fx * (1 - fy)], [c0, r0 + 1, (1 - fx) * fy], [c0 + 1, r0 + 1, fx * fy]];
  for (const [cc, rr, wt] of corners) {
    if (cc < 0 || rr < 0 || cc >= w.nx || rr >= w.ny) continue;
    const v = values[rr * w.nx + cc];
    if (!Number.isFinite(v)) continue;
    sum += v * wt;
    weight += wt;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (weight < 0.25) return null;
  return { value: sum / weight, lo, hi };
}
