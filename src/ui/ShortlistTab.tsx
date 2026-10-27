import { useStore } from 'zustand';
import { engine } from '../compute/engine';
import { fmtDelta, fmtDuration } from '../compute/format';
import { homeResult, letter } from '../compute/homes';
import type { LonLat, Scenario } from '../domain/types';
import { exactStore } from '../routing/exact';
import { exact } from '../routing/wire';
import { flyTo, uiStore } from '../state/uiStore';
import { addCandidate, removeCandidate, updateCandidate } from './actions';
import { useResult } from './hooks';
import { PlaceSearch } from './PlaceSearch';

export function ShortlistTab({ scenario }: { scenario: Scenario }) {
  useStore(exactStore, (s) => s.version);
  const busy = useStore(exactStore, (s) => s.busy > 0);
  const error = useStore(exactStore, (s) => s.error);
  useResult((r) => r.frame?.version);
  const best = useResult((r) => r.frame?.stats.min ?? Number.NaN);
  const near = useResult((r) => r.area?.centre) ?? scenario.region.centre;
  const rows = scenario.candidates.map((c, i) => ({ c, letter: letter(i), res: homeResult(scenario, c.location, exact, engine, true) }));
  const sorted = [...rows].sort((a, b) => (a.res?.value ?? Infinity) - (b.res?.value ?? Infinity));
  const names = new Map(scenario.people.map((p) => [p.id, p]));

  return (
    <div className="shortlist">
      <p className="hint">Add rental listings, or the homes you live in now, to compare them exactly. Click any spot on the map and choose “Add to shortlist”, or search:</p>
      <PlaceSearch near={near as LonLat} country={scenario.region.country || undefined} placeholder="Add an address to compare" onChoose={(r) => addCandidate(r.location, r.label)} />
      {busy && <p className="hint">Getting exact road times…</p>}
      {error && <p className="notice">{error}</p>}
      {sorted.length > 0 && (
        <ol className="cands">
          {sorted.map(({ c, letter: l, res }, rank) => (
            <li key={c.id} className={`cand-row${c.kind === 'current-home' ? ' cand-row-current' : ''}`}>
              <div className="cand-head">
                <span className="cand-letter" title={rank === 0 ? 'Least travel on your shortlist' : undefined}>
                  {l}
                </span>
                <input className="cand-name" value={c.label} aria-label="Name" onChange={(e) => updateCandidate(c.id, { label: e.target.value })} />
                <button type="button" className="icon-btn" aria-label={`Remove ${c.label}`} onClick={() => removeCandidate(c.id)}>
                  ×
                </button>
              </div>
              {c.address && <div className="addr">{c.address}</div>}
              {res && (
                <div className="cand-total">
                  <strong>{fmtDuration(res.value)}</strong> a week
                  <span className="spot-delta">{Number.isFinite(best) ? (fmtDelta(res.value - best) === 'best' ? ' · about the best there is' : ` · ${fmtDelta(res.value - best)} vs the best spot`) : ''}</span>
                  <span className={`tag${res.exact ? ' tag-exact' : ''}`}>{res.exact ? 'exact' : res.estimate ? 'estimate' : 'from map'}</span>
                </div>
              )}
              {res && scenario.people.length > 1 && (
                <div className="cand-people">
                  {scenario.people.map((p) => (
                    <span key={p.id}>
                      <i style={{ background: names.get(p.id)?.colour }} />
                      {p.name} {fmtDuration(res.breakdown.persons.get(p.id) ?? 0)}
                    </span>
                  ))}
                </div>
              )}
              <div className="cand-fields">
                <label className="inline">
                  Rent $
                  <input
                    type="number"
                    className="num"
                    min={0}
                    step={10}
                    value={c.rentPerWeek ?? ''}
                    placeholder="–"
                    onChange={(e) => updateCandidate(c.id, { rentPerWeek: e.target.value === '' ? undefined : Number(e.target.value) })}
                  />
                  /wk
                </label>
                <input className="cand-link" type="url" value={c.url ?? ''} placeholder="Listing link" aria-label="Listing link" onChange={(e) => updateCandidate(c.id, { url: e.target.value || undefined })} />
                {c.url && /^https?:\/\//.test(c.url) && (
                  <a className="link" href={c.url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                )}
              </div>
              <input className="cand-notes" value={c.notes ?? ''} placeholder="Notes" aria-label="Notes" onChange={(e) => updateCandidate(c.id, { notes: e.target.value || undefined })} />
              <div className="inline wrap">
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    flyTo(c.location);
                    uiStore.setState({ probe: c.location });
                  }}
                >
                  Show on map
                </button>
                <label className="check">
                  <input type="checkbox" checked={c.kind === 'current-home'} onChange={(e) => updateCandidate(c.id, { kind: e.target.checked ? 'current-home' : 'listing' })} />
                  Where we live now
                </label>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
