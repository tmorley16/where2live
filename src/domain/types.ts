export type Id = string;
export type LonLat = [lon: number, lat: number];
/** [west, south, east, north] in degrees. */
export type BBox = [west: number, south: number, east: number, north: number];

export type ModeId = 'car' | 'bike' | 'walk' | 'pt';
/** When a leg is usually travelled. Sets the car traffic multiplier now, and the departure time for public transport later. */
export type TimeBand = 'peak' | 'offpeak' | 'weekend' | 'night';
export type FreqUnit = 'week' | 'fortnight' | 'month' | 'year';
export type PlaceCategory = 'work' | 'study' | 'church' | 'gym' | 'shopping' | 'social' | 'family' | 'service' | 'other';
export type Legs = 'return' | 'there-only' | 'back-only';

export interface Person {
  id: Id;
  name: string;
  colour: string;
}

/** One branch of an "any branch" place. */
export interface PlaceOption {
  id: Id;
  name: string;
  location: LonLat;
  /** The chain search it came from; absent when added by hand (kept when the search is re-run). */
  chain?: string;
}

export interface Place {
  id: Id;
  name: string;
  category: PlaceCategory;
  /** Null until the user has placed it. Trips to an unplaced place are left out of the totals. */
  location: LonLat | null;
  address?: string;
  /**
   * Any branch will do (any Woolworths, Coles or Aldi; any gym of a chain): each home counts the branch quickest
   * to reach from it. When set, `location` is unused.
   */
  anyOf?: {
    chains: string[];
    options: PlaceOption[];
    /** The area the chains were searched in, so a grown area can be searched again. */
    searched?: BBox;
  };
}

export interface LegTiming {
  band: TimeBand;
  /** Overrides the settings' multiplier for this band (car only). */
  multiplier?: number;
}

export interface Frequency {
  count: number;
  per: FreqUnit;
}

/** A trip you make regularly. */
export interface Trip {
  id: Id;
  /** MVP: exactly one. More than one will be a chained trip (home → work → gym → home) in phase 2. */
  placeIds: Id[];
  /** The people who go. */
  travellers: Id[];
  /** They travel together (one car). Only matters for household counting. */
  together: boolean;
  mode: ModeId;
  frequency: Frequency;
  legs: Legs;
  out: LegTiming;
  back: LegTiming;
  /** Extra minutes per leg: parking, walking to the car. */
  overheadMin: number;
  /** A quick what-if switch. */
  enabled: boolean;
}

export interface Candidate {
  id: Id;
  kind: 'listing' | 'current-home';
  label: string;
  location: LonLat;
  address?: string;
  url?: string;
  rentPerWeek?: number;
  notes?: string;
}

/** combined = the total; balanced = the total plus half the gap between people; fairest = the busier person. */
export type View = { kind: 'balanced' } | { kind: 'combined' } | { kind: 'fairest' } | { kind: 'person'; id: Id };
export type BandStyle = 'bands' | 'cells' | 'smooth';
export type PaletteId = 'ylgnbu' | 'viridis' | 'magma';

export interface Settings {
  /** per-person: each traveller's time counts (two people in one car = double). household: a shared trip counts once. */
  accounting: 'per-person' | 'household';
  view: View;
  /** Car only. */
  trafficMultipliers: Record<TimeBand, number>;
  /** Use the outbound time for the return too (halves routing requests). Walking is always treated as symmetric. */
  symmetric: { car: boolean; bike: boolean };
  area: { mode: 'auto' } | { mode: 'manual'; bbox: BBox };
  bands: { mode: 'absolute' | 'relative'; step: number | 'auto' };
  display: { style: BandStyle; palette: PaletteId; opacity: number; edges: boolean };
  /**
   * Road times for "any branch" places: only where the map is promising (the better 40% of it; elsewhere the
   * straight-line estimate, since one short trip barely changes a poor area), or everywhere.
   */
  branchRouting: 'focus' | 'all';
}

export interface Scenario {
  schema: 1;
  name: string;
  region: { country: string; centre: LonLat };
  people: Person[];
  places: Place[];
  trips: Trip[];
  candidates: Candidate[];
  settings: Settings;
}
