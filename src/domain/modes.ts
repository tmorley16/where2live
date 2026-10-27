import type { ModeId, PlaceCategory, TimeBand } from './types';

export interface ModeInfo {
  label: string;
  /** openrouteservice profile, where ORS can route this mode. */
  orsProfile?: 'driving-car' | 'cycling-regular' | 'foot-walking';
  /** Selectable in the UI. Public transport arrives in phase 2. */
  available: boolean;
  /** Always use one time for both directions. */
  alwaysSymmetric: boolean;
  /** Traffic multipliers apply. */
  traffic: boolean;
}

export const MODES: Record<ModeId, ModeInfo> = {
  car: { label: 'Car', orsProfile: 'driving-car', available: true, alwaysSymmetric: false, traffic: true },
  bike: { label: 'Bike', orsProfile: 'cycling-regular', available: true, alwaysSymmetric: false, traffic: false },
  walk: { label: 'Walk', orsProfile: 'foot-walking', available: true, alwaysSymmetric: true, traffic: false },
  pt: { label: 'Public transport', available: false, alwaysSymmetric: false, traffic: false },
};

export const MODE_ORDER: ModeId[] = ['car', 'bike', 'walk', 'pt'];

export const TIME_BANDS: Record<TimeBand, { label: string; hint: string }> = {
  peak: { label: 'Peak', hint: 'Weekday rush hour' },
  offpeak: { label: 'Off-peak', hint: 'Weekday, outside rush hour' },
  weekend: { label: 'Weekend', hint: 'Saturday or Sunday daytime' },
  night: { label: 'Night', hint: 'Evenings and nights' },
};

export const BAND_ORDER: TimeBand[] = ['peak', 'offpeak', 'weekend', 'night'];

export const DEFAULT_MULTIPLIERS: Record<TimeBand, number> = { peak: 1.4, offpeak: 1.15, weekend: 1, night: 1 };

export const CATEGORIES: Record<PlaceCategory, { label: string; glyph: string }> = {
  work: { label: 'Work', glyph: 'W' },
  study: { label: 'Study', glyph: 'S' },
  church: { label: 'Church', glyph: '✝' },
  gym: { label: 'Gym', glyph: 'G' },
  shopping: { label: 'Shopping', glyph: '$' },
  social: { label: 'Friends', glyph: '♥' },
  family: { label: 'Family', glyph: 'F' },
  other: { label: 'Other', glyph: '•' },
};

export const CATEGORY_ORDER: PlaceCategory[] = ['work', 'study', 'church', 'gym', 'shopping', 'social', 'family', 'other'];
