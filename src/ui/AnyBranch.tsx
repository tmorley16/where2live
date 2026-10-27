import { useState } from 'react';
import { newId } from '../domain/presets';
import type { LonLat, Place, Scenario } from '../domain/types';
import { findBranches, mergeBranches, searchBox, SUPERMARKET_CHAINS } from '../routing/chains';
import { edit } from '../state/scenarioStore';
import { useResult } from './hooks';
import { PlaceSearch } from './PlaceSearch';

const EXAMPLES: Partial<Record<Place['category'], string>> = { gym: 'e.g. Revo Fitness', shopping: 'Another chain' };

/** "Any branch will do": choose chains (found in OpenStreetMap) and add any branches the map data lacks by hand. */
export function AnyBranch({ place, scenario }: { place: Place; scenario: Scenario }) {
  const area = useResult((r) => r.area);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [chainText, setChainText] = useState('');
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const any = place.anyOf!;
  const presets = place.category === 'shopping' ? SUPERMARKET_CHAINS : [];
  const custom = any.chains.filter((c) => !presets.includes(c));

  const change = (recipe: (a: NonNullable<Place['anyOf']>) => void) =>
    edit((d) => {
      const p = d.places.find((x) => x.id === place.id);
      if (p?.anyOf) recipe(p.anyOf);
    });

  const toggleChain = async (chain: string) => {
    if (any.chains.includes(chain)) {
      change((a) => {
        a.chains = a.chains.filter((c) => c !== chain);
        a.options = a.options.filter((o) => o.chain !== chain);
      });
      return;
    }
    setBusy(chain);
    setNote(null);
    try {
      const box = searchBox(area, scenario.region.centre);
      const { options: found, partial } = await findBranches(chain, box, presets.includes(chain) ? 'supermarket' : 'any');
      change((a) => {
        a.chains = [...a.chains, chain];
        a.options = mergeBranches(a.options, found);
        // A partial search is retried when the area next changes (it isn't marked as covering the area).
        if (!partial) a.searched = box;
      });
      if (found.length === 0) setNote(`No ${chain} branches in the map data around here. Add them yourself with “Add a branch”.`);
      else if (partial) setNote(`Found ${found.length} ${chain} branches, but the search service was busy for part of the area. Untick and tick ${chain} in a minute to fill any gaps.`);
    } catch {
      setNote('Search isn’t available right now. Try again in a moment, or add branches yourself.');
    } finally {
      setBusy(null);
    }
  };

  const n = any.options.length;
  return (
    <div className="anyof">
      {(presets.length > 0 || custom.length > 0) && (
        <div className="chips" role="group" aria-label="Chains">
          {[...presets, ...custom].map((c) => {
            const on = any.chains.includes(c);
            return (
              <button key={c} type="button" className={`chip-toggle${on ? ' on' : ''}`} aria-pressed={on} disabled={busy !== null} onClick={() => void toggleChain(c)}>
                {busy === c ? `${c}…` : c}
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
          if (c && !any.chains.includes(c)) void toggleChain(c);
          setChainText('');
        }}
      >
        <input value={chainText} placeholder={EXAMPLES[place.category] ?? 'Chain or brand name'} aria-label="Chain or brand name" onChange={(e) => setChainText(e.target.value)} />
        <button type="submit" className="btn btn-sm" disabled={!chainText.trim() || busy !== null}>
          Find
        </button>
      </form>
      <div className="anyof-summary">
        {n === 0 ? 'No branches yet' : `${n} branch${n === 1 ? '' : 'es'}: each home counts its quickest one`}
        {n > 0 && (
          <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'List'}
          </button>
        )}
        <button type="button" className="link" aria-expanded={adding} onClick={() => setAdding(!adding)}>
          {adding ? 'Done' : 'Add a branch'}
        </button>
      </div>
      {note && <div className="place-note">{note}</div>}
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
