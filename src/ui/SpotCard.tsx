import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { engine } from '../compute/engine';
import { fmtDelta, fmtDuration } from '../compute/format';
import { homeResult, scenarioSpecs } from '../compute/homes';
import { fairnessText, isOverall, rankText } from '../compute/overall';
import { exactStore } from '../routing/exact';
import { reverseGeocode } from '../routing/geocode';
import { exact } from '../routing/wire';
import { uiStore } from '../state/uiStore';
import { addCandidate } from './actions';
import { PersonBars, TripLines } from './Breakdown';
import { useApp, useResult, useScenario, useUI } from './hooks';

/** The spot clicked on the map, trip by trip. */
export function SpotCard() {
  const probe = useUI((u) => u.probe);
  const scenario = useScenario((s) => s);
  const best = useResult((r) => r.frame?.headline ?? Number.NaN);
  const sorted = useResult((r) => r.frame?.stats.sorted);
  useResult((r) => r.frame?.version);
  const hasKey = useApp((a) => !!a.key);
  const busy = useStore(exactStore, (s) => s.busy > 0);
  useStore(exactStore, (s) => s.version);
  const [wantExact, setWantExact] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const card = useRef<HTMLElement>(null);

  useEffect(() => {
    setWantExact(false);
    setLabel(null);
    if (!probe) return;
    // On a phone the panel sits under the map: bring the card into view.
    if (globalThis.matchMedia?.('(max-width: 760px)').matches) requestAnimationFrame(() => card.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    const ctrl = new AbortController();
    reverseGeocode(probe, ctrl.signal)
      .then((r) => setLabel(r?.label ?? null))
      .catch(() => {});
    return () => ctrl.abort();
  }, [probe?.[0], probe?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!probe || !scenario) return null;
  const res = homeResult(scenario, probe, exact, engine, wantExact);
  if (!res) return null;
  const delta = res.value - best;
  const overall = isOverall(scenario.settings.view, scenario.people);
  const fair = overall ? fairnessText(res.breakdown.persons, scenario.people) : '';
  return (
    <section ref={card} className="spot" aria-label="This spot">
      <header className="spot-head">
        <div>
          <div className="spot-title">This spot</div>
          <div className="spot-addr">{label ?? `${probe[1].toFixed(4)}, ${probe[0].toFixed(4)}`}</div>
        </div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={() => uiStore.setState({ probe: null })}>
          ×
        </button>
      </header>
      <div className="spot-total">
        ≈ <strong>{fmtDuration(res.value)}</strong> a week{' '}
        <span className="spot-delta">
          {overall
            ? sorted && `· ${rankText(sorted, res.breakdown.balanced)}`
            : Number.isFinite(delta)
              ? fmtDelta(delta) === 'best'
                ? '· about the best there is'
                : `· ${fmtDelta(delta)} vs the best spot`
              : ''}
        </span>
      </div>
      <div className="spot-badge">{res.exact ? 'Exact road times for this address' : res.estimate ? 'Straight-line estimate' : 'Read off the map (nearest calculated points)'}</div>
      {scenario.people.length > 1 && <PersonBars breakdown={res.breakdown} people={scenario.people} />}
      {fair && <div className="spot-fair">{fair}</div>}
      <TripLines breakdown={res.breakdown} scenario={scenario} />
      <div className="inline wrap">
        {hasKey && !res.exact && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => {
              setWantExact(true);
              void exact.ensure([probe], scenarioSpecs(scenario));
            }}
          >
            {busy ? 'Getting exact times…' : 'Exact times'}
          </button>
        )}
        <button type="button" className="btn btn-sm btn-primary" onClick={() => addCandidate(probe, label)}>
          Add to shortlist
        </button>
      </div>
    </section>
  );
}
