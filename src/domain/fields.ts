import { MODES } from './modes';
import type { LonLat, ModeId, Settings } from './types';

/**
 * A travel-time field: the minutes between one place and every candidate home point, for one mode and direction.
 * `to` = home → place (the leg there); `from` = place → home (the leg back).
 */
export interface FieldSpec {
  mode: ModeId;
  dir: 'to' | 'from';
  place: LonLat;
}

/** Coordinates to 5 decimal places (about 1 m), so moving a pin back, or two places at one spot, share data. */
export function coordKey([lon, lat]: LonLat): string {
  return `${lon.toFixed(5)},${lat.toFixed(5)}`;
}

export function specKey(s: FieldSpec): string {
  return `${s.mode}|${s.dir}|${coordKey(s.place)}`;
}

/** The field a leg reads. The leg back uses the outbound field when the mode is treated as symmetric. */
export function legSpec(mode: ModeId, leg: 'out' | 'back', place: LonLat, settings: Settings): FieldSpec {
  if (leg === 'out') return { mode, dir: 'to', place };
  const symmetric = MODES[mode].alwaysSymmetric || (mode === 'car' && settings.symmetric.car) || (mode === 'bike' && settings.symmetric.bike);
  return { mode, dir: symmetric ? 'to' : 'from', place };
}
