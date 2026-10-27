import { resultStore } from '../compute/engine';
import { edit, getScenario } from '../state/scenarioStore';
import { covers, findBranches, mergeBranches, searchBox, SUPERMARKET_CHAINS } from './chains';

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

/**
 * When the search area grows past where an "any branch" place's chains were searched (a new place further out),
 * search again so homes near the new edge count their nearest branch. Branches added by hand are kept.
 */
async function refresh() {
  const s = getScenario();
  const area = resultStore.getState().area;
  if (!s || !area || running) return;
  const box = searchBox(area, s.region.centre);
  const stale = s.places.filter((p) => p.anyOf && p.anyOf.chains.length && !covers(p.anyOf.searched, box));
  if (!stale.length) return;
  running = true;
  try {
    for (const p of stale) {
      let found = p.anyOf!.options;
      let partial = false;
      for (const chain of p.anyOf!.chains) {
        const kind = SUPERMARKET_CHAINS.includes(chain) && p.category === 'shopping' ? 'supermarket' : 'any';
        const r = await findBranches(chain, box, kind);
        found = mergeBranches(found, r.options);
        partial ||= r.partial;
      }
      edit((d) => {
        const q = d.places.find((x) => x.id === p.id);
        if (q?.anyOf) {
          q.anyOf.options = mergeBranches(q.anyOf.options, found);
          if (!partial) q.anyOf.searched = box;
        }
      });
    }
  } catch {
    /* search unavailable: try again on the next change */
  } finally {
    running = false;
  }
}

export function watchBranches(): void {
  resultStore.subscribe((st, prev) => {
    if (st.area === prev.area) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 2000);
  });
}
