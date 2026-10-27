import type { LonLat } from '../domain/types';
import { toMercator } from './mercator';

/** Branches routed per home: the few nearest as the crow flies… */
export const NEAREST_K = 4;
/** …plus any nearly as near (a closer branch across the water can be further by road), up to this many. */
export const NEAREST_MAX = 8;

/**
 * For "any branch" places: which branches to route each home to. Routing every home to every branch would cost
 * hundreds of requests for a supermarket chain; the nearest few by straight line almost always include the
 * nearest by road.
 */
export class TargetIndex {
  readonly merc: [number, number][];
  constructor(readonly targets: LonLat[]) {
    this.merc = targets.map(toMercator);
  }

  /** Candidate branch indices for a Mercator point, nearest first. */
  candidates(x: number, y: number): number[] {
    const n = this.merc.length;
    if (n <= NEAREST_K) return Array.from({ length: n }, (_, i) => i);
    // Keep the NEAREST_MAX smallest squared distances (insertion into a short sorted list).
    const best: number[] = [];
    const dist: number[] = [];
    for (let i = 0; i < n; i++) {
      const dx = this.merc[i][0] - x;
      const dy = this.merc[i][1] - y;
      const d = dx * dx + dy * dy;
      if (best.length === NEAREST_MAX && d >= dist[NEAREST_MAX - 1]) continue;
      if (best.length < NEAREST_MAX) {
        best.push(i);
        dist.push(d);
      } else {
        best[NEAREST_MAX - 1] = i; // replace the furthest kept
        dist[NEAREST_MAX - 1] = d;
      }
      for (let j = best.length - 1; j > 0 && dist[j - 1] > dist[j]; j--) {
        [best[j - 1], best[j]] = [best[j], best[j - 1]];
        [dist[j - 1], dist[j]] = [dist[j], dist[j - 1]];
      }
    }
    const near = Math.sqrt(dist[0]);
    const slack = (1.5 * near + 1200) ** 2; // Mercator metres; 1,200 ≈ 1 km on the ground in Sydney
    const out = best.slice(0, NEAREST_K);
    for (let i = NEAREST_K; i < best.length; i++) if (dist[i] <= slack) out.push(best[i]);
    return out;
  }

  candidatesAt(p: LonLat): number[] {
    const [x, y] = toMercator(p);
    return this.candidates(x, y);
  }
}
