import { useState } from 'react';
import { useStore } from 'zustand';
import { newId } from '../domain/presets';
import type { LonLat, Place, Scenario } from '../domain/types';
import { branchSearch, searchPlace } from '../routing/branches';
import { mergeBranches, SUPERMARKET_CHAINS } from '../routing/chains';
import { edit, getScenario } from '../state/scenarioStore';
import { useResult } from './hooks';
import { PlaceSearch } from './PlaceSearch';

const EXAMPLES: Partial<Record<Place['category'], string>> = { gym: 'Chain, e.g. Revo Fitness', shopping: 'Another chain', service: 'e.g. Chemist Warehouse, Australia Post' };

/**
 * "Any branch will do": the chains whose branches count (found in OpenStreetMap; supermarkets start with Woolworths,
 * Coles and Aldi ticked), plus any branches the map data lacks, added by hand.
 */
export function AnyBranch({ place, scenario }: { place: Place; scenario: Scenario }) {
  const area = useResult((r) => r.area);
  const status = useStore(branchSearch, (s) => s[place.id]);
  const [chainText, setChainText] = useState('');
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const any = place.anyOf!;
  const presets = place.category === 'shopping' ? SUPERMARKET_CHAINS : [];
  const custom = any.chains.filter((c) => !presets.includes(c));
  const busy = !!status?.busy;

  const change = (recipe: (a: NonNullable<Place['anyOf']>) => void) =>
    edit((d) => {
      const p = d.places.find((x) => x.id === place.id);
      if (p?.anyOf) recipe(p.anyOf);
    });

  const toggleChain = (chain: string) => {
    if (any.chains.includes(chain)) {
      change((a) => {
        a.chains = a.chains.filter((c) => c !== chain);
        a.options = a.options.filter((o) => o.chain !== chain);
      });
      return;
    }
    change((a) => void (a.chains = [...a.chains, chain]));
    const now = getScenario()?.places.find((p) => p.id === place.id);
    if (now) void searchPlace(now, [chain]);
  };

  const n = any.options.length;
  return (
    <div className="anyof">
      {(presets.length > 0 || custom.length > 0) && (
        <div className="chips" role="group" aria-label="Chains">
          {[...presets, ...custom].map((c) => {
            const on = any.chains.includes(c);
            return (
              <button key={c} type="button" className={`chip-toggle${on ? ' on' : ''}`} aria-pressed={on} disabled={busy} onClick={() => toggleChain(c)}>
                {c}
              </button>
            );
          })}
        </div>
      )}
      <form
        className="inline anyof-find"
        onSubmit={(e) => {
          e.preventDefault();
          const c = chainText.trim();
          if (c && !any.chains.includes(c)) toggleChain(c);
          setChainText('');
        }}
      >
        <input value={chainText} placeholder={EXAMPLES[place.category] ?? 'Chain or brand name'} aria-label="Chain or brand name" onChange={(e) => setChainText(e.target.value)} />
        <button type="submit" className="btn btn-sm" disabled={!chainText.trim() || busy}>
          Find
        </button>
      </form>
      <div className="anyof-summary">
        {busy ? 'Finding branches…' : n === 0 ? 'No branches yet' : `${n} branch${n === 1 ? '' : 'es'}: each home counts its quickest one`}
        {n > 0 && (
          <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'List'}
          </button>
        )}
        <button type="button" className="link" aria-expanded={adding} onClick={() => setAdding(!adding)}>
          {adding ? 'Done' : 'Add a branch'}
        </button>
      </div>
      {status?.note && !busy && <div className="place-note">{status.note}</div>}
      {adding && (
        <PlaceSearch
          near={(area?.centre ?? scenario.region.centre) as LonLat}
          country={scenario.region.country || undefined}
          placeholder="Search for a branch’s address"
          autoFocus
          onCancel={() => setAdding(false)}
          onChoose={(r) => change((a) => void (a.options = mergeBranches(a.options, [{ id: newId(), name: r.label.split(',').slice(0, 2).join(','), location: r.location }])))}
        />
      )}
      {open && (
        <ul className="branches">
          {any.options.map((o) => (
            <li key={o.id}>
              <span>{o.name}</span>
              <button type="button" className="icon-btn" aria-label={`Remove ${o.name}`} title="Leave this branch out" onClick={() => change((a) => void (a.options = a.options.filter((x) => x.id !== o.id)))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
