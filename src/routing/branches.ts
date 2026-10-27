import { createStore } from 'zustand/vanilla';
import { resultStore } from '../compute/engine';
import type { Id, Place } from '../domain/types';
import { edit, getScenario, scenarioStore } from '../state/scenarioStore';
import { covers, findBranches, mergeBranches, searchBox, SUPERMARKET_CHAINS, type Branches } from './chains';

/** What the branch search is doing, per place, for the card. */
export const branchSearch = createStore<Record<Id, { busy: boolean; note?: string }>>(() => ({}));

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
/** A place whose search failed isn't tried again for a minute (every edit would retry it otherwise). */
const cooldown = new Map<Id, number>();

function kindFor(p: Place, chain: string): 'supermarket' | 'any' {
  return p.category === 'shopping' && SUPERMARKET_CHAINS.includes(chain) ? 'supermarket' : 'any';
}

/** Searches one place's chains together and merges what's found (branches added by hand are kept). */
export async function searchPlace(p: Place, chains = p.anyOf?.chains ?? []): Promise<void> {
  const s = getScenario();
  if (!s || !p.anyOf || chains.length === 0) return;
  const box = searchBox(resultStore.getState().area, s.region.centre);
  branchSearch.setState({ [p.id]: { busy: true } });
  const results = await Promise.allSettled(chains.map((c) => findBranches(c, box, kindFor(p, c))));
  const ok = results.filter((r): r is PromiseFulfilledResult<Branches> => r.status === 'fulfilled').map((r) => r.value);
  const failed = chains.filter((_, i) => results[i].status === 'rejected');
  const partial = failed.length > 0 || ok.some((r) => r.partial);
  edit((d) => {
    const q = d.places.find((x) => x.id === p.id);
    if (!q?.anyOf) return;
    for (const r of ok) q.anyOf.options = mergeBranches(q.anyOf.options, r.options);
    if (!partial) q.anyOf.searched = box;
  });
  const empty = chains.filter((_, i) => results[i].status === 'fulfilled' && (results[i] as PromiseFulfilledResult<Branches>).value.options.length === 0);
  const note = failed.length
    ? `Couldn’t search for ${failed.join(', ')} just now (the search service is busy). It tries again shortly, or add branches yourself.`
    : empty.length
      ? `No ${empty.join(' or ')} branches in the map data around here. Add them yourself with “Add a branch”.`
      : partial
        ? 'The search service was busy for part of the area; it fills the gaps shortly.'
        : undefined;
  if (partial) cooldown.set(p.id, Date.now() + 60_000);
  branchSearch.setState({ [p.id]: { busy: false, note } });
}

/**
 * Searches chains that are ticked but not yet searched for the current area: a new supermarket (Woolworths, Coles
 * and Aldi ticked), or an area that has grown past the last search.
 */
async function refresh() {
  const s = getScenario();
  if (!s || running) return;
  const box = searchBox(resultStore.getState().area, s.region.centre);
  const now = Date.now();
  const stale = s.places.filter((p) => p.anyOf && p.anyOf.chains.length && !covers(p.anyOf.searched, box) && (cooldown.get(p.id) ?? 0) < now && !branchSearch.getState()[p.id]?.busy);
  if (!stale.length) return;
  running = true;
  try {
    await Promise.all(stale.map((p) => searchPlace(p)));
  } finally {
    running = false;
  }
}

function soon(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void refresh(), ms);
}

export function watchBranches(): void {
  resultStore.subscribe((st, prev) => {
    if (st.area !== prev.area) soon(1500);
  });
  scenarioStore.subscribe((st, prev) => {
    if (st.scenario?.places !== prev.scenario?.places) soon(600);
  });
  soon(600);
}
