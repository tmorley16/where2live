import { openKV } from '../cache/kv';
import { engine } from '../compute/engine';
import { scenarioSpecs } from '../compute/homes';
import { scenarioStore } from '../state/scenarioStore';
import { appStore, noteQuota, remaining } from '../state/appStore';
import { ExactTimes } from './exact';
import { OrsProvider } from './orsProvider';
import { EstimateProvider } from './provider';

const kv = { fields: openKV('fields'), snaps: openKV('snaps') };
let ors: OrsProvider | null = null;

/** Real road times when there's a key; estimates when there isn't. */
function sync() {
  const key = appStore.getState().key;
  if (key && !ors) {
    ors = new OrsProvider({
      key: () => appStore.getState().key,
      kv,
      onStatus: (job) => appStore.setState({ job }),
      onQuota: noteQuota,
      maxChunk: () => appStore.getState().maxChunk,
      onMaxChunk: (n) => appStore.setState({ maxChunk: Math.max(1, n) }),
      remaining: () => remaining('matrix'),
    });
    engine.setProvider(ors);
    // Ask the browser not to clear the cached travel times under storage pressure.
    void globalThis.navigator?.storage?.persist?.().catch(() => {});
  } else if (!key && ors) {
    ors = null;
    engine.setProvider(new EstimateProvider());
    appStore.setState({ job: { state: 'idle', todo: 0, done: 0, failed: 0 } });
  } else if (key && ors) {
    ors.retry();
  }
}

appStore.subscribe((s, p) => {
  if (s.key !== p.key) sync();
});
sync();

export function routing(): OrsProvider | null {
  return ors;
}

/** Exact times for specific homes: the clicked spot and the shortlist. */
export const exact = new ExactTimes(() => ors);

// Shortlisted homes always get exact times (a few requests per batch), fetched shortly after any change.
let shortlistTimer: ReturnType<typeof setTimeout> | null = null;
function refreshShortlist() {
  if (shortlistTimer) clearTimeout(shortlistTimer);
  shortlistTimer = setTimeout(() => {
    const s = scenarioStore.getState().scenario;
    if (s && s.candidates.length && ors) void exact.ensure(s.candidates.map((c) => c.location), scenarioSpecs(s));
  }, 1000);
}
scenarioStore.subscribe((s, p) => {
  if (s.scenario?.candidates !== p.scenario?.candidates || s.scenario?.places !== p.scenario?.places || s.scenario?.trips !== p.scenario?.trips) refreshShortlist();
});
appStore.subscribe((s, p) => {
  if (s.key !== p.key) refreshShortlist();
});
refreshShortlist();
