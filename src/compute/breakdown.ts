import { legSpec, type FieldSpec } from '../domain/fields';
import { tripsPerWeek } from '../domain/frequency';
import { countedPeople, legMultiplier, tripCounts, tripPlace, tripTravellers } from '../domain/formula';
import type { Frequency, Id, ModeId, Scenario } from '../domain/types';

export interface LegLine {
  /** Free-flow minutes for one leg. */
  minutes: number;
  multiplier: number;
}

export interface TripLine {
  tripId: Id;
  placeName: string;
  /** For an "any branch" place: the branch quickest from this home. */
  via?: string;
  mode: ModeId;
  travellers: Id[];
  together: boolean;
  perWeek: number;
  frequency: Frequency;
  out?: LegLine;
  back?: LegLine;
  overheadMin: number;
  /** Weekly minutes for one traveller. */
  perTraveller: number;
  /** Weekly minutes counted in the household total (× the people counted). */
  counted: number;
  /** Counts towards the totals (enabled, placed, has travellers). */
  active: boolean;
}

export interface Breakdown {
  lines: TripLine[];
  persons: Map<Id, number>;
  combined: number;
  /** The busier person's weekly minutes. */
  fairest: number;
}

/**
 * The weekly minutes at one home, trip by trip. `legMinutes` gives a field's free-flow minutes at that home;
 * `nearestOf` (optional) which of an "any branch" field's targets is quickest from it.
 */
export function breakdownAt(s: Scenario, legMinutes: (spec: FieldSpec) => number, nearestOf?: (spec: FieldSpec) => number): Breakdown {
  const places = new Map(s.places.map((p) => [p.id, p]));
  const persons = new Map<Id, number>(s.people.map((p) => [p.id, 0]));
  const lines: TripLine[] = [];
  let combined = 0;
  for (const t of s.trips) {
    const tp = tripPlace(t, places);
    if (!tp) continue;
    const { place, targets } = tp;
    const w = tripsPerWeek(t.frequency);
    const leg = (which: 'out' | 'back'): LegLine => ({
      minutes: legMinutes(legSpec(t.mode, which, targets, s.settings)),
      multiplier: legMultiplier(t, which === 'out' ? t.out : t.back, s),
    });
    // For an "any branch" place, which branch is the quickest from here.
    const via = place.anyOf && place.anyOf.options.length > 1 && nearestOf ? place.anyOf.options[nearestOf(legSpec(t.mode, 'out', targets, s.settings))]?.name : undefined;
    const out = t.legs !== 'back-only' ? leg('out') : undefined;
    const back = t.legs !== 'there-only' ? leg('back') : undefined;
    const overhead = Math.max(0, t.overheadMin || 0);
    const perTrip = (out ? out.minutes * out.multiplier + overhead : 0) + (back ? back.minutes * back.multiplier + overhead : 0);
    const perTraveller = w * perTrip;
    const active = tripCounts(t, s, places);
    const counted = active ? perTraveller * countedPeople(t, s) : 0;
    if (active) {
      combined += counted;
      for (const id of tripTravellers(t, s)) persons.set(id, (persons.get(id) ?? 0) + perTraveller);
    }
    lines.push({ tripId: t.id, placeName: place.name, via, mode: t.mode, travellers: t.travellers, together: t.together, perWeek: w, frequency: t.frequency, out, back, overheadMin: overhead, perTraveller, counted, active });
  }
  const fairest = Math.max(0, ...persons.values());
  return { lines, persons, combined, fairest };
}
