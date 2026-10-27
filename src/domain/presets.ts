import { BRANCHING, DEFAULT_MULTIPLIERS, DEFAULT_SUPERMARKETS } from './modes';
import type { Frequency, Id, LonLat, ModeId, Person, Place, PlaceCategory, Scenario, Settings, TimeBand, Trip } from './types';

export function newId(): Id {
  return crypto.randomUUID().slice(0, 8);
}

/** Basic colours to choose from for each person (the first five are the defaults, in order). */
export const PERSON_COLOURS = ['#c2255c', '#e8590c', '#7048e8', '#2b8a3e', '#495057', '#e03131', '#f08c00', '#1c7ed6', '#0c8599', '#9c36b5', '#795548', '#000000'];

export const SYDNEY: LonLat = [151.15, -33.84];

export function defaultSettings(): Settings {
  return {
    accounting: 'per-person',
    view: { kind: 'balanced' },
    trafficMultipliers: { ...DEFAULT_MULTIPLIERS },
    symmetric: { car: false, bike: false },
    area: { mode: 'auto' },
    bands: { mode: 'absolute', step: 'auto' },
    display: { style: 'bands', palette: 'ylgnbu', opacity: 0.6, edges: false, overall: 'ranked', uneven: 2 },
    branchRouting: 'focus',
  };
}

interface CategoryDefault {
  frequency: Frequency;
  /** 'one' = the first person only; 'all' = everyone, together. */
  who: 'one' | 'all';
  band: TimeBand;
}

/** Sensible starting values when a place of this category is added. */
export const CATEGORY_DEFAULTS: Record<PlaceCategory, CategoryDefault> = {
  work: { frequency: { count: 5, per: 'week' }, who: 'one', band: 'peak' },
  study: { frequency: { count: 5, per: 'week' }, who: 'one', band: 'peak' },
  church: { frequency: { count: 1, per: 'week' }, who: 'all', band: 'weekend' },
  gym: { frequency: { count: 3, per: 'week' }, who: 'one', band: 'offpeak' },
  shopping: { frequency: { count: 1, per: 'week' }, who: 'all', band: 'weekend' },
  social: { frequency: { count: 2, per: 'month' }, who: 'all', band: 'weekend' },
  family: { frequency: { count: 2, per: 'month' }, who: 'all', band: 'weekend' },
  service: { frequency: { count: 2, per: 'month' }, who: 'one', band: 'offpeak' },
  other: { frequency: { count: 1, per: 'week' }, who: 'all', band: 'offpeak' },
};

export function newPerson(name: string, index: number): Person {
  return { id: newId(), name, colour: PERSON_COLOURS[index % PERSON_COLOURS.length] };
}

/** A new place. Supermarkets and services are always "any branch" (supermarkets start with Woolworths, Coles and Aldi). */
export function newPlace(name: string, category: PlaceCategory, location: LonLat | null = null, address?: string): Place {
  const p: Place = { id: newId(), name, category, location, address };
  if (BRANCHING[category] === 'always') p.anyOf = { chains: category === 'shopping' ? [...DEFAULT_SUPERMARKETS] : [], options: [] };
  return p;
}

/** A trip to `place` using its category's defaults. `traveller` is who goes when the default is one person. */
export function tripFor(place: Place, people: Person[], traveller?: Id, mode: ModeId = 'car'): Trip {
  const d = CATEGORY_DEFAULTS[place.category];
  const travellers = d.who === 'all' ? people.map((p) => p.id) : [traveller ?? people[0]?.id].filter((x): x is Id => !!x);
  return {
    id: newId(),
    placeIds: [place.id],
    travellers,
    together: d.who === 'all',
    mode,
    frequency: { ...d.frequency },
    legs: 'return',
    out: { band: d.band },
    back: { band: d.band },
    overheadMin: 0,
    enabled: true,
  };
}

export function newScenario(centre: LonLat = SYDNEY, country = 'AU'): Scenario {
  return {
    schema: 1,
    name: 'Our places',
    region: { country, centre },
    people: [newPerson('Person 1', 0), newPerson('Person 2', 1)],
    places: [],
    trips: [],
    candidates: [],
    settings: defaultSettings(),
  };
}

/** A fictional Sydney couple. Public landmarks only; no real people's addresses. */
export function demoScenario(): Scenario {
  const s = newScenario(SYDNEY, 'AU');
  s.name = 'Demo: Sam and Alex';
  s.demo = true;
  const [sam, alex] = [newPerson('Sam', 0), newPerson('Alex', 1)];
  s.people = [sam, alex];
  const place = (name: string, category: PlaceCategory, lon: number, lat: number) => newPlace(name, category, [lon, lat]);
  const samWork = place('Sam’s work, Macquarie Park', 'work', 151.124, -33.779);
  const alexWork = place('Alex’s work, Wynyard', 'work', 151.2057, -33.8657);
  const church = place('Church, Chatswood', 'church', 151.181, -33.7966);
  const gym = place('Gym, Macquarie Centre', 'gym', 151.1205, -33.7765);
  // Any Woolworths, Coles or Aldi nearby: a few real stores, so the demo needs no search.
  const shops = newPlace('Supermarket', 'shopping');
  const store = (name: string, chain: string, lon: number, lat: number) => ({ id: newId(), name, location: [lon, lat] as LonLat, chain });
  shops.anyOf = {
    chains: [...DEFAULT_SUPERMARKETS],
    searched: [140, -45, 160, -25],
    options: [
      store('Woolworths, Burwood', 'Woolworths', 151.10197, -33.87746),
      store('Woolworths, Chatswood', 'Woolworths', 151.19811, -33.78634),
      store('Woolworths, Sydney', 'Woolworths', 151.2073, -33.87327),
      store('Coles, Lane Cove', 'Coles', 151.16926, -33.81353),
      store('Coles, Five Dock', 'Coles', 151.12906, -33.86784),
      store('Coles, Macquarie Park', 'Coles', 151.12108, -33.77796),
      store('Aldi, Chatswood', 'Aldi', 151.18816, -33.79509),
      store('Aldi, Eastwood', 'Aldi', 151.08468, -33.791),
      store('Aldi, North Strathfield', 'Aldi', 151.08797, -33.86357),
      store('Aldi, North Sydney', 'Aldi', 151.20852, -33.83917),
    ],
  };
  const parra = place('Friends, Parramatta', 'social', 151.003, -33.815);
  const bondi = place('Friends, Bondi', 'social', 151.274, -33.891);
  const family = place('Family, Wollongong', 'family', 150.893, -34.425);
  s.places = [samWork, alexWork, church, gym, shops, parra, bondi, family];
  const both = [sam.id, alex.id];
  const trip = (p: Place, travellers: Id[], mode: ModeId, frequency: Frequency, band: TimeBand): Trip => ({
    id: newId(),
    placeIds: [p.id],
    travellers,
    together: travellers.length > 1,
    mode,
    frequency,
    legs: 'return',
    out: { band },
    back: { band },
    overheadMin: 0,
    enabled: true,
  });
  s.trips = [
    trip(samWork, [sam.id], 'car', { count: 5, per: 'week' }, 'peak'),
    trip(alexWork, [alex.id], 'car', { count: 4, per: 'week' }, 'peak'),
    trip(church, both, 'car', { count: 1, per: 'week' }, 'weekend'),
    trip(gym, [sam.id], 'bike', { count: 3, per: 'week' }, 'offpeak'),
    trip(shops, both, 'car', { count: 1, per: 'week' }, 'weekend'),
    trip(parra, both, 'car', { count: 2, per: 'month' }, 'weekend'),
    trip(bondi, both, 'car', { count: 1, per: 'month' }, 'weekend'),
    trip(family, both, 'car', { count: 1, per: 'month' }, 'weekend'),
  ];
  return s;
}
