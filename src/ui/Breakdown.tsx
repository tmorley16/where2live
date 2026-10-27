import type { Breakdown } from '../compute/breakdown';
import { fmtDuration } from '../compute/format';
import { describeFrequency } from '../domain/frequency';
import { MODES } from '../domain/modes';
import type { Person, Scenario } from '../domain/types';

function legText(minutes: number, multiplier: number): string {
  const m = Math.round(minutes);
  return multiplier !== 1 ? `${m} min ×${multiplier}` : `${m} min`;
}

/** Each person's weekly travel as a bar. */
export function PersonBars({ breakdown, people }: { breakdown: Breakdown; people: Person[] }) {
  const max = Math.max(1, ...people.map((p) => breakdown.persons.get(p.id) ?? 0));
  return (
    <ul className="bars">
      {people.map((p) => {
        const v = breakdown.persons.get(p.id) ?? 0;
        return (
          <li key={p.id}>
            <span className="bar-name">{p.name}</span>
            <span className="bar">
              <i style={{ width: `${(v / max) * 100}%`, background: p.colour }} />
            </span>
            <span className="bar-value">{fmtDuration(v)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Trip by trip: "Work · Sam · Car · 5× a week: 20 min ×1.4 there, 22 min ×1.4 back → 4 h 54 min". */
export function TripLines({ breakdown, scenario }: { breakdown: Breakdown; scenario: Scenario }) {
  const names = new Map(scenario.people.map((p) => [p.id, p.name]));
  const lines = [...breakdown.lines].filter((l) => l.active).sort((a, b) => b.counted - a.counted);
  return (
    <ul className="lines">
      {lines.map((l) => {
        const who = l.travellers.map((t) => names.get(t)).filter(Boolean);
        const each = who.length > 1 && scenario.settings.accounting === 'per-person' ? ` (${fmtDuration(l.perTraveller)} each)` : '';
        const legs = [l.out && `${legText(l.out.minutes, l.out.multiplier)} there`, l.back && `${legText(l.back.minutes, l.back.multiplier)} back`].filter(Boolean).join(', ');
        return (
          <li key={l.tripId}>
            <div className="line-head">
              <span className="line-name">{l.placeName}</span>
              <span className="line-value">
                {fmtDuration(l.counted)}
                {each}
              </span>
            </div>
            {l.via && <div className="line-sub line-via">nearest: {l.via}</div>}
            <div className="line-sub">
              {who.join(' and ')} · {MODES[l.mode].label} · {describeFrequency(l.frequency)} · {legs}
              {l.overheadMin ? ` (+${l.overheadMin} min each way)` : ''}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
