import type { FieldSpec } from '../domain/fields';
import type { LonLat, ModeId } from '../domain/types';
import { idToMercator } from '../grid/lattice';
import { fromMercator, haversine } from '../grid/mercator';
import { TargetIndex } from '../grid/nearest';

/**
 * Rough door-to-door minutes from straight-line distance, for the demo, before a key is added, and to fill gaps.
 * Always shown as an estimate. Roads wind (detour factor), and cars go faster on longer trips (motorways).
 */
export function estimateMinutes(mode: ModeId, a: LonLat, b: LonLat): number {
  const km = haversine(a, b) / 1000;
  switch (mode) {
    case 'car': {
      const d = km * 1.35;
      const kmh = 30 + 30 * Math.min(1, Math.max(0, (d - 2) / 28));
      return 2 + (d / kmh) * 60;
    }
    case 'bike':
      return 1 + ((km * 1.3) / 16) * 60;
    case 'walk':
      return ((km * 1.25) / 4.8) * 60;
    case 'pt':
      return 10 + ((km * 1.3) / 22) * 60;
  }
}

/**
 * An estimated field over a list of point ids (same order): minutes to the nearest target. Estimates are the same
 * both ways.
 */
export function estimateField(spec: FieldSpec, ids: ArrayLike<number>): Float32Array {
  const out = new Float32Array(ids.length);
  if (spec.targets.length === 1) {
    const t = spec.targets[0];
    for (let k = 0; k < ids.length; k++) out[k] = estimateMinutes(spec.mode, fromMercator(idToMercator(ids[k])), t);
    return out;
  }
  const index = new TargetIndex(spec.targets);
  for (let k = 0; k < ids.length; k++) {
    const [x, y] = idToMercator(ids[k]);
    const p = fromMercator([x, y]);
    let best = Infinity;
    for (const i of index.candidates(x, y)) best = Math.min(best, estimateMinutes(spec.mode, p, spec.targets[i]));
    out[k] = best;
  }
  return out;
}

/** Which target is quickest from a point, by estimate. */
export function estimateNearest(spec: FieldSpec, p: LonLat): number {
  if (spec.targets.length === 1) return 0;
  let best = -1;
  let bestMin = Infinity;
  for (const i of new TargetIndex(spec.targets).candidatesAt(p)) {
    const m = estimateMinutes(spec.mode, p, spec.targets[i]);
    if (m < bestMin) {
      bestMin = m;
      best = i;
    }
  }
  return best;
}
