import { BRANCHING, DEFAULT_SUPERMARKETS } from '../domain/modes';
import { CATEGORY_DEFAULTS, demoScenario, newId, newPerson, newPlace, newScenario, tripFor } from '../domain/presets';
import type { Id, LonLat, Person, Place, PlaceCategory, Scenario, Trip } from '../domain/types';
import { edit, getScenario, setScenario } from '../state/scenarioStore';
import { requestFit, uiStore } from '../state/uiStore';

export function loadDemo(): void {
  setScenario(demoScenario());
  requestFit();
}

export function startOwn(centre?: LonLat, country?: string): void {
  setScenario(newScenario(centre, country ?? ''));
  requestFit();
}

export function addCandidate(location: LonLat, label?: string | null, kind: 'listing' | 'current-home' = 'listing'): void {
  edit((d) => {
    d.candidates.push({ id: newId(), kind, label: label?.split(',')[0] || `Home ${d.candidates.length + 1}`, location, ...(label ? { address: label } : {}) });
  });
  uiStore.setState({ tab: 'shortlist' });
}

export function updateCandidate(id: Id, patch: Partial<Scenario['candidates'][number]>): void {
  edit((d) => {
    const c = d.candidates.find((x) => x.id === id);
    if (c) Object.assign(c, patch);
  });
}

export function removeCandidate(id: Id): void {
  edit((d) => {
    d.candidates = d.candidates.filter((c) => c.id !== id);
  });
}

export function setAreaToView(): boolean {
  const bbox = uiStore.getState().viewBBox;
  if (!bbox) return false;
  edit((d) => void (d.settings.area = { mode: 'manual', bbox }));
  return true;
}

export function setAreaAuto(): void {
  edit((d) => void (d.settings.area = { mode: 'auto' }));
  requestFit();
}

export function exportScenario(): void {
  const s = getScenario();
  if (!s) return;
  const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `where2live-${s.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'scenario'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function addPerson(): void {
  edit((d) => {
    if (d.people.length >= 5) return;
    d.people.push(newPerson(d.people.length === 1 ? 'Partner' : `Person ${d.people.length + 1}`, d.people.length));
  });
}

export function updatePerson(id: Id, patch: Partial<Person>): void {
  edit((d) => {
    const p = d.people.find((x) => x.id === id);
    if (p) Object.assign(p, patch);
  });
}

export function removePerson(id: Id): void {
  edit((d) => {
    if (d.people.length <= 1) return;
    d.people = d.people.filter((p) => p.id !== id);
    for (const t of d.trips) t.travellers = t.travellers.filter((x) => x !== id);
    if (d.settings.view.kind === 'person' && d.settings.view.id === id) d.settings.view = { kind: 'combined' };
  });
}

/** Adds a place with one trip using its category's defaults. Returns the new place's id. */
export function addPlace(category: PlaceCategory = 'other', name?: string, location: LonLat | null = null, address?: string): Id {
  const s = getScenario();
  const place = newPlace(name ?? (category === 'other' ? 'New place' : CATEGORY_LABEL_NEW[category]), category, location, address);
  edit((d) => {
    d.places.push(place);
    // Work and study default to someone who doesn't already have a workplace.
    const busy = new Set(d.trips.filter((t) => t.placeIds.some((id) => ['work', 'study'].includes(d.places.find((p) => p.id === id)?.category ?? ''))).flatMap((t) => t.travellers));
    const free = d.people.find((p) => !busy.has(p.id))?.id;
    d.trips.push(tripFor(place, d.people, CATEGORY_DEFAULTS[category].who === 'one' ? (free ?? d.people[0]?.id) : undefined));
  });
  if (!s?.places.length) requestFit();
  return place.id;
}

const CATEGORY_LABEL_NEW: Record<PlaceCategory, string> = {
  work: 'Work',
  study: 'Uni or school',
  church: 'Church',
  gym: 'Gym',
  shopping: 'Supermarket',
  social: 'Friends',
  family: 'Family',
  service: 'Chemist, post office…',
  other: 'New place',
};

/**
 * Changes a place's kind. Supermarkets and services become "any branch" (a supermarket with Woolworths, Coles and
 * Aldi ticked, its pin kept as a branch); kinds that can't branch go back to one place.
 */
export function setCategory(id: Id, category: PlaceCategory): void {
  edit((d) => {
    const p = d.places.find((x) => x.id === id);
    if (!p) return;
    p.category = category;
    const rule = BRANCHING[category];
    if (rule === 'always' && !p.anyOf) {
      const name = p.address?.split(',').slice(0, 2).join(',') || p.name;
      p.anyOf = { chains: category === 'shopping' ? [...DEFAULT_SUPERMARKETS] : [], options: p.location ? [{ id: newId(), name, location: p.location }] : [] };
    } else if (rule === 'never' && p.anyOf) {
      p.location ??= p.anyOf.options[0]?.location ?? null;
      delete p.anyOf;
    }
  });
}

export function updatePlace(id: Id, patch: Partial<Place>): void {
  const firstPlaced = patch.location && !getScenario()?.places.some((p) => p.id !== id && p.location);
  edit((d) => {
    const p = d.places.find((x) => x.id === id);
    if (p) Object.assign(p, patch);
  });
  if (firstPlaced) requestFit(); // the first place sets where the map looks
}

/**
 * Switches a place between one location and "any branch". The current pin becomes the first branch (your usual
 * gym stays in the list); switching back pins the first branch.
 */
export function toggleAnyOf(place: Place): void {
  edit((d) => {
    const p = d.places.find((x) => x.id === place.id);
    if (!p) return;
    if (p.anyOf) {
      if (!p.location && p.anyOf.options.length) p.location = p.anyOf.options[0].location;
      delete p.anyOf;
    } else {
      const name = p.address?.split(',').slice(0, 2).join(',') || p.name;
      p.anyOf = { chains: [], options: p.location ? [{ id: newId(), name, location: p.location }] : [] };
    }
  });
}

export function removePlace(id: Id): void {
  edit((d) => {
    d.places = d.places.filter((p) => p.id !== id);
    d.trips = d.trips.filter((t) => !t.placeIds.includes(id));
  });
  if (uiStore.getState().picking === id) uiStore.setState({ picking: null });
}

export function addTrip(placeId: Id): void {
  edit((d) => {
    const place = d.places.find((p) => p.id === placeId);
    if (place) d.trips.push(tripFor(place, d.people));
  });
}

export function updateTrip(id: Id, recipe: (t: Trip) => void): void {
  edit((d) => {
    const t = d.trips.find((x) => x.id === id);
    if (t) recipe(t);
  });
}

export function removeTrip(id: Id): void {
  edit((d) => {
    d.trips = d.trips.filter((t) => t.id !== id);
  });
}

export function duplicateTrip(id: Id): void {
  edit((d) => {
    const t = d.trips.find((x) => x.id === id);
    if (t) d.trips.splice(d.trips.indexOf(t) + 1, 0, { ...structuredClone(t), id: newId() });
  });
}
