import { legSpec, specKey, type FieldSpec } from './fields';
import { tripsPerWeek } from './frequency';
import { MODES } from './modes';
import type { Id, LegTiming, LonLat, Place, Scenario, Trip } from './types';

/**
 * Weekly minutes as a linear function of travel-time fields:
 *   value(h) = constant + Σ coef[k] · field_k(h)      (fields in minutes)
 * Every edit to frequencies, travellers or multipliers only changes the coefficients, so the
 * whole map can be recomputed from cached fields in about a millisecond.
 */
export interface LinearForm {
  coef: Map<string, number>;
  specs: Map<string, FieldSpec>;
  constant: number;
}

export function emptyForm(): LinearForm {
  return { coef: new Map(), specs: new Map(), constant: 0 };
}

function addTerm(form: LinearForm, spec: FieldSpec, c: number) {
  if (c === 0) return;
  const k = specKey(spec);
  form.coef.set(k, (form.coef.get(k) ?? 0) + c);
  form.specs.set(k, spec);
}

function addForm(into: LinearForm, from: LinearForm, scale: number) {
  if (scale === 0) return;
  for (const [k, c] of from.coef) {
    into.coef.set(k, (into.coef.get(k) ?? 0) + c * scale);
    into.specs.set(k, from.specs.get(k)!);
  }
  into.constant += from.constant * scale;
}

export function legMultiplier(trip: Trip, leg: LegTiming, scenario: Scenario): number {
  if (leg.multiplier !== undefined && Number.isFinite(leg.multiplier)) return leg.multiplier;
  return MODES[trip.mode].traffic ? scenario.settings.trafficMultipliers[leg.band] : 1;
}

/** The trip's destination, if it has one placed. MVP trips have exactly one place. */
export function tripPlace(trip: Trip, places: Map<Id, Place>): (Place & { location: LonLat }) | null {
  const p = places.get(trip.placeIds[0]);
  return p && p.location ? (p as Place & { location: LonLat }) : null;
}

/** Valid travellers: people who still exist. */
export function tripTravellers(trip: Trip, scenario: Scenario): Id[] {
  const ids = new Set(scenario.people.map((p) => p.id));
  return trip.travellers.filter((t) => ids.has(t));
}

/** Does this trip count towards the totals? */
export function tripCounts(trip: Trip, scenario: Scenario, places: Map<Id, Place>): boolean {
  return trip.enabled && tripsPerWeek(trip.frequency) > 0 && tripTravellers(trip, scenario).length > 0 && tripPlace(trip, places) !== null;
}

/** People counted for a trip: each traveller, or one for a shared trip under household counting. */
export function countedPeople(trip: Trip, scenario: Scenario): number {
  const n = tripTravellers(trip, scenario).length;
  if (n === 0) return 0;
  return scenario.settings.accounting === 'household' && trip.together ? 1 : n;
}

/** Weekly minutes for ONE traveller on this trip, as a linear form. */
export function tripUnitForm(trip: Trip, scenario: Scenario, places: Map<Id, Place>): LinearForm {
  const form = emptyForm();
  const place = tripPlace(trip, places);
  if (!place) return form;
  const w = tripsPerWeek(trip.frequency);
  const out = trip.legs !== 'back-only';
  const back = trip.legs !== 'there-only';
  if (out) addTerm(form, legSpec(trip.mode, 'out', place.location, scenario.settings), w * legMultiplier(trip, trip.out, scenario));
  if (back) addTerm(form, legSpec(trip.mode, 'back', place.location, scenario.settings), w * legMultiplier(trip, trip.back, scenario));
  form.constant += w * ((out ? 1 : 0) + (back ? 1 : 0)) * Math.max(0, trip.overheadMin || 0);
  return form;
}

export interface Forms {
  /** The household total under the chosen counting. */
  combined: LinearForm;
  /** Each person's own travel. */
  persons: Map<Id, LinearForm>;
  /** Every field any form reads. */
  specs: Map<string, FieldSpec>;
}

export function buildForms(scenario: Scenario): Forms {
  const places = new Map(scenario.places.map((p) => [p.id, p]));
  const combined = emptyForm();
  const persons = new Map<Id, LinearForm>(scenario.people.map((p) => [p.id, emptyForm()]));
  for (const trip of scenario.trips) {
    if (!tripCounts(trip, scenario, places)) continue;
    const unit = tripUnitForm(trip, scenario, places);
    addForm(combined, unit, countedPeople(trip, scenario));
    for (const t of tripTravellers(trip, scenario)) addForm(persons.get(t)!, unit, 1);
  }
  const specs = new Map(combined.specs);
  for (const f of persons.values()) for (const [k, s] of f.specs) specs.set(k, s);
  return { combined, persons, specs };
}

/** Evaluate a form at one point, given each field's minutes there. NaN if any field it needs is missing. */
export function evaluateAt(form: LinearForm, minutesFor: (key: string) => number): number {
  let v = form.constant;
  for (const [k, c] of form.coef) v += c * minutesFor(k);
  return v;
}
