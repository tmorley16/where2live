import { useState } from 'react';
import { BAND_ORDER, MODE_ORDER, MODES, TIME_BANDS } from '../domain/modes';
import type { FreqUnit, Person, Scenario, TimeBand, Trip } from '../domain/types';
import { startDrag } from '../state/uiStore';
import { addTrip, duplicateTrip, removeTrip, updateTrip } from './actions';
import { Switch } from './controls';

const RANGE: Record<FreqUnit, { max: number; step: number }> = {
  week: { max: 14, step: 0.5 },
  fortnight: { max: 14, step: 1 },
  month: { max: 20, step: 1 },
  year: { max: 52, step: 1 },
};

const UNIT_LABEL: Record<FreqUnit, string> = { week: '× a week', fortnight: '× a fortnight', month: '× a month', year: '× a year' };

function bandLabel(band: TimeBand, trip: Trip, s: Scenario): string {
  const m = s.settings.trafficMultipliers[band];
  return MODES[trip.mode].traffic && m !== 1 ? `${TIME_BANDS[band].label} ×${m}` : TIME_BANDS[band].label;
}

function BandSelect({ value, trip, scenario, label, onChange }: { value: TimeBand; trip: Trip; scenario: Scenario; label: string; onChange: (b: TimeBand) => void }) {
  return (
    <select className="compact band" value={value} aria-label={label} title={TIME_BANDS[value].hint} onChange={(e) => onChange(e.target.value as TimeBand)}>
      {BAND_ORDER.map((b) => (
        <option key={b} value={b}>
          {bandLabel(b, trip, scenario)}
        </option>
      ))}
    </select>
  );
}

/** One regular trip, in two compact lines: who · how · when · on/off, then how often · more. */
export function TripRow({ trip, people, scenario }: { trip: Trip; people: Person[]; scenario: Scenario }) {
  const [more, setMore] = useState(false);
  const set = (fn: (t: Trip) => void) => updateTrip(trip.id, fn);
  const range = RANGE[trip.frequency.per];
  const noone = trip.travellers.filter((t) => people.some((p) => p.id === t)).length === 0;

  return (
    <div className={`trip${trip.enabled ? '' : ' trip-off'}`}>
      <div className="trip-line">
        <div className="who" role="group" aria-label="Who goes">
          {people.map((p) => {
            const on = trip.travellers.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={`who-chip${on ? ' on' : ''}`}
                style={{ ['--c' as string]: p.colour }}
                aria-pressed={on}
                onClick={() =>
                  set((t) => {
                    t.travellers = on ? t.travellers.filter((x) => x !== p.id) : [...t.travellers, p.id];
                    t.together = t.travellers.length > 1 && (t.together || !on);
                  })
                }
              >
                {p.name}
              </button>
            );
          })}
        </div>
        <select className="compact mode" value={trip.mode} aria-label="How" onChange={(e) => set((t) => void (t.mode = e.target.value as Trip['mode']))}>
          {MODE_ORDER.map((m) => (
            <option key={m} value={m} disabled={!MODES[m].available}>
              {MODES[m].available ? MODES[m].label : `${MODES[m].label} (soon)`}
            </option>
          ))}
        </select>
        <BandSelect value={trip.out.band} trip={trip} scenario={scenario} label="When" onChange={(b) => set((t) => void (t.out.band = t.back.band = b))} />
        <Switch checked={trip.enabled} onChange={(v) => set((t) => void (t.enabled = v))} label="Count this trip" title={trip.enabled ? 'Counted (switch off to see the map without it)' : 'Not counted'} />
      </div>
      <div className="trip-line freq">
        <input
          type="range"
          min={0}
          max={range.max}
          step={range.step}
          value={Math.min(trip.frequency.count, range.max)}
          aria-label="How often"
          onPointerDown={startDrag}
          onChange={(e) => set((t) => void (t.frequency.count = Number(e.target.value)))}
        />
        <input
          type="number"
          className="num"
          min={0}
          step="any"
          value={trip.frequency.count}
          aria-label="Times"
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= 0) set((t) => void (t.frequency.count = v));
          }}
        />
        <select className="compact per" value={trip.frequency.per} aria-label="Per" onChange={(e) => set((t) => void (t.frequency.per = e.target.value as FreqUnit))}>
          {(Object.keys(RANGE) as FreqUnit[]).map((u) => (
            <option key={u} value={u}>
              {UNIT_LABEL[u]}
            </option>
          ))}
        </select>
        <button type="button" className="icon-btn" aria-label="More options for this trip" aria-expanded={more} title="More options" onClick={() => setMore(!more)}>
          ⋯
        </button>
      </div>
      {noone && <div className="trip-warn">Choose who goes</div>}
      {more && (
        <div className="trip-more">
          <label className="inline">
            There
            <BandSelect value={trip.out.band} trip={trip} scenario={scenario} label="There" onChange={(b) => set((t) => void (t.out.band = b))} />
          </label>
          <label className="inline">
            Back
            <BandSelect value={trip.back.band} trip={trip} scenario={scenario} label="Back" onChange={(b) => set((t) => void (t.back.band = b))} />
          </label>
          <label className="inline">
            Legs
            <select className="compact" value={trip.legs} onChange={(e) => set((t) => void (t.legs = e.target.value as Trip['legs']))}>
              <option value="return">There and back</option>
              <option value="there-only">There only</option>
              <option value="back-only">Back only</option>
            </select>
          </label>
          <label className="inline" title="Parking, walking to the car or the stop: added to each leg">
            Extra each way
            <input type="number" className="num" min={0} max={60} step={1} value={trip.overheadMin} onChange={(e) => set((t) => void (t.overheadMin = Math.max(0, Number(e.target.value) || 0)))} />
            min
          </label>
          {MODES[trip.mode].traffic && (
            <label className="inline" title="Leave empty to use the time band's multiplier (Settings)">
              Traffic ×
              <input
                type="number"
                className="num"
                min={0.5}
                max={4}
                step={0.05}
                placeholder={String(scenario.settings.trafficMultipliers[trip.out.band])}
                value={trip.out.multiplier ?? ''}
                onChange={(e) =>
                  set((t) => {
                    const v = e.target.value === '' ? undefined : Number(e.target.value);
                    t.out.multiplier = v;
                    t.back.multiplier = v;
                  })
                }
              />
            </label>
          )}
          {trip.travellers.length > 1 && (
            <label className="check" title="You travel together, in one car. Only matters when shared trips are counted once (Settings).">
              <input type="checkbox" checked={trip.together} onChange={(e) => set((t) => void (t.together = e.target.checked))} />
              Together
            </label>
          )}
          <div className="trip-actions">
            <button type="button" className="link" onClick={() => addTrip(trip.placeIds[0])} title="Someone else goes too, at another time, or by another mode">
              Add another trip here
            </button>
            <button type="button" className="link" onClick={() => duplicateTrip(trip.id)}>
              Copy
            </button>
            <button type="button" className="link danger" onClick={() => removeTrip(trip.id)}>
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
