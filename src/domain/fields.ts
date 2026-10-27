import { MODES } from './modes';
import type { LonLat, ModeId, Settings } from './types';

/**
 * A travel-time field: the minutes between every candidate home point and the nearest of `targets` (one place, or
 * every branch of an "any branch" place), for one mode and direction.
 * `to` = home → place (the leg there); `from` = place → home (the leg back).
 */
export interface FieldSpec {
  mode: ModeId;
  dir: 'to' | 'from';
  targets: LonLat[];
}

/** Coordinates to 5 decimal places (about 1 m), so moving a pin back, or two places at one spot, share data. */
export function coordKey([lon, lat]: LonLat): string {
  return `${lon.toFixed(5)},${lat.toFixed(5)}`;
}

/** FNV-1a over the sorted target keys: the same set of branches always gives the same key. */
function setHash(targets: LonLat[]): string {
  let h = 0x811c9dc5;
  for (const ch of targets.map(coordKey).sort().join(';')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(36)}.${targets.length}`;
}

export function specKey(s: FieldSpec): string {
  return s.targets.length === 1 ? `${s.mode}|${s.dir}|${coordKey(s.targets[0])}` : `${s.mode}|${s.dir}|any:${setHash(s.targets)}`;
}

/**
 * The field a leg reads. The leg back uses the outbound field when the mode is treated as symmetric, and always for
 * "any branch" places (the nearest branch is about as near both ways, and it halves the requests).
 */
export function legSpec(mode: ModeId, leg: 'out' | 'back', targets: LonLat[], settings: Settings): FieldSpec {
  if (leg === 'out') return { mode, dir: 'to', targets };
  const symmetric = targets.length > 1 || MODES[mode].alwaysSymmetric || (mode === 'car' && settings.symmetric.car) || (mode === 'bike' && settings.symmetric.bike);
  return { mode, dir: symmetric ? 'to' : 'from', targets };
}
