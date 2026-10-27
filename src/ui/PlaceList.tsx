import { useState } from 'react';
import { legSpec, specKey } from '../domain/fields';
import { CATEGORIES, CATEGORY_ORDER, MODES } from '../domain/modes';
import type { LonLat, Place, PlaceCategory, Scenario } from '../domain/types';
import { uiStore } from '../state/uiStore';
import { addPlace, addTrip, removePlace, updatePlace } from './actions';
import { useApp, useResult, useUI } from './hooks';
import { PlaceSearch } from './PlaceSearch';
import { TripRow } from './TripRow';

const QUICK_ADD: PlaceCategory[] = ['work', 'church', 'gym', 'shopping', 'social', 'family', 'other'];

function PlaceCard({ place, scenario, fresh }: { place: Place; scenario: Scenario; fresh: boolean }) {
  const [changing, setChanging] = useState(false);
  const picking = useUI((u) => u.picking === place.id);
  const near = useResult((r) => r.area?.centre) ?? scenario.region.centre;
  const trips = scenario.trips.filter((t) => t.placeIds[0] === place.id);
  const searching = !place.location || changing;
  const far = useResult((r) => r.area?.far.includes(place.id) ?? false);
  const failures = useApp((a) => a.job.failures);
  const problem = place.location
    ? trips
        .flatMap((t) => (['out', 'back'] as const).map((leg) => ({ mode: t.mode, reason: failures?.[specKey(legSpec(t.mode, leg, place.location!, scenario.settings))] })))
        .find((x) => x.reason)
    : undefined;

  return (
    <section className="place" aria-label={place.name}>
      <div className="place-head">
        <select className="cat" value={place.category} aria-label="Kind of place" title={CATEGORIES[place.category].label} onChange={(e) => updatePlace(place.id, { category: e.target.value as PlaceCategory })}>
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {CATEGORIES[c].glyph} {CATEGORIES[c].label}
            </option>
          ))}
        </select>
        <input className="place-name" value={place.name} aria-label="Place name" onChange={(e) => updatePlace(place.id, { name: e.target.value })} />
        <button type="button" className="icon-btn" aria-label={`Remove ${place.name}`} title="Remove this place" onClick={() => removePlace(place.id)}>
          ×
        </button>
      </div>
      {searching ? (
        <div className="place-where">
          <PlaceSearch
            near={near as LonLat}
            country={scenario.region.country || undefined}
            autoFocus={fresh || changing}
            onCancel={() => setChanging(false)}
            onChoose={(r) => {
              updatePlace(place.id, { location: r.location, address: r.label, ...(place.name === 'New place' ? { name: r.name } : {}) });
              setChanging(false);
            }}
          />
          <button type="button" className={`btn btn-sm${picking ? ' btn-on' : ''}`} onClick={() => uiStore.setState({ picking: picking ? null : place.id })}>
            {picking ? 'Click the map…' : 'Pick on map'}
          </button>
        </div>
      ) : (
        <div className="place-where">
          <span className="addr" title={place.address ?? 'Placed on the map'}>
            {place.address ?? `Pinned at ${place.location![1].toFixed(4)}, ${place.location![0].toFixed(4)}`}
          </span>
          <button type="button" className="link" onClick={() => setChanging(true)}>
            Change
          </button>
        </div>
      )}
      {far && <div className="place-note">Outside the search area: still counted, just not shown on the map.</div>}
      {problem && (
        <div className="trip-warn">
          {problem.reason === 'no-road'
            ? `There’s no road for ${MODES[problem.mode].label.toLowerCase()} trips near this pin. Drag it onto a street.`
            : `${MODES[problem.mode].label} trips can’t reach this spot from the rest of the map (an island?). Try another mode, or move the pin.`}{' '}
          Estimates are used meanwhile.
        </div>
      )}
      {trips.map((t) => (
        <TripRow key={t.id} trip={t} people={scenario.people} scenario={scenario} />
      ))}
      <button type="button" className="link add-trip" onClick={() => addTrip(place.id)}>
        + Another trip here (someone else, another mode)
      </button>
    </section>
  );
}

export function PlaceList({ scenario }: { scenario: Scenario }) {
  const [fresh, setFresh] = useState<string | null>(null);
  return (
    <div className="places">
      {scenario.places.length === 0 && (
        <p className="hint">
          Add the places you go regularly. Start with work, then church, the gym, the shops and friends. Each comes with typical settings you can change.
        </p>
      )}
      {scenario.places.map((p) => (
        <PlaceCard key={p.id} place={p} scenario={scenario} fresh={p.id === fresh} />
      ))}
      <div className="quick-add" role="group" aria-label="Add a place">
        {QUICK_ADD.map((c) => (
          <button key={c} type="button" className="btn btn-sm" onClick={() => setFresh(addPlace(c))}>
            + {CATEGORIES[c].label}
          </button>
        ))}
      </div>
    </div>
  );
}
