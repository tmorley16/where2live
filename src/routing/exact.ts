import { createStore } from 'zustand/vanilla';
import { openKV, type KV } from '../cache/kv';
import { coordKey, type FieldSpec } from '../domain/fields';
import { MODES } from '../domain/modes';
import type { LonLat } from '../domain/types';
import { estimateMinutes } from './estimate';
import { smallMatrix } from './ors/matrix';
import type { OrsProvider } from './orsProvider';

/** Bumped whenever exact times arrive, so the UI re-renders. */
export const exactStore = createStore<{ version: number; busy: number; error: string | null }>(() => ({ version: 0, busy: 0, error: null }));

const MAX_ROUTES = 3000;

/**
 * Exact travel times between specific homes (a shortlisted listing, a clicked spot) and the places:
 * no grid, no interpolation. From openrouteservice when there's a key (a few requests per batch), from the
 * estimate otherwise. Cached in IndexedDB by coordinate pair.
 */
export class ExactTimes {
  private mem = new Map<string, number>();
  private inflight = new Map<string, Promise<void>>();
  private kv: KV;

  constructor(
    private ors: () => OrsProvider | null,
    kv?: KV,
  ) {
    this.kv = kv ?? openKV('pairs');
  }

  private key(provider: string, spec: FieldSpec, home: LonLat): string {
    const profile = MODES[spec.mode].orsProfile ?? spec.mode;
    return `${provider}|${profile}|${spec.dir}|${coordKey(home)}|${coordKey(spec.place)}`;
  }

  private provider(): 'ors' | 'estimate' {
    return this.ors()?.keyValue ? 'ors' : 'estimate';
  }

  /** Minutes for one home and one field, if known. Estimates are always known. */
  get(home: LonLat, spec: FieldSpec): number | undefined {
    const p = this.provider();
    if (p === 'estimate') return estimateMinutes(spec.mode, home, spec.place);
    return this.mem.get(this.key('ors', spec, home));
  }

  isExact(): boolean {
    return this.provider() === 'ors';
  }

  /** Fetches whatever is missing for these homes and fields. */
  async ensure(homes: LonLat[], specs: FieldSpec[]): Promise<void> {
    const ors = this.ors();
    if (!ors?.keyValue || homes.length === 0 || specs.length === 0) return;
    // Look in IndexedDB first.
    const missing: { home: LonLat; spec: FieldSpec; k: string }[] = [];
    for (const home of homes) {
      for (const spec of specs) {
        if (!MODES[spec.mode].orsProfile) continue;
        const k = this.key('ors', spec, home);
        if (this.mem.has(k)) continue;
        const v = await this.kv.get<number>(k).catch(() => undefined);
        if (v !== undefined) this.mem.set(k, v);
        else missing.push({ home, spec, k });
      }
    }
    if (missing.length === 0) return exactStore.setState((s) => ({ version: s.version + 1 }));
    // Group by profile and direction: one matrix each (split if huge).
    const groups = new Map<string, { profile: string; dir: 'to' | 'from'; homes: Map<string, LonLat>; places: Map<string, LonLat> }>();
    for (const m of missing) {
      const profile = MODES[m.spec.mode].orsProfile!;
      const g = groups.get(`${profile}|${m.spec.dir}`) ?? { profile, dir: m.spec.dir, homes: new Map(), places: new Map() };
      g.homes.set(coordKey(m.home), m.home);
      g.places.set(coordKey(m.spec.place), m.spec.place);
      groups.set(`${profile}|${m.spec.dir}`, g);
    }
    exactStore.setState((s) => ({ busy: s.busy + 1, error: null }));
    try {
      for (const g of groups.values()) {
        const gk = `${g.profile}|${g.dir}|${[...g.homes.keys()].join(';')}|${[...g.places.keys()].join(';')}`;
        let job = this.inflight.get(gk);
        if (!job) {
          job = this.fetchGroup(ors, g.profile, g.dir, [...g.homes.values()], [...g.places.values()]).finally(() => this.inflight.delete(gk));
          this.inflight.set(gk, job);
        }
        await job;
      }
    } catch (e) {
      exactStore.setState({ error: (e as Error).message });
    } finally {
      exactStore.setState((s) => ({ busy: s.busy - 1, version: s.version + 1 }));
    }
  }

  private async fetchGroup(ors: OrsProvider, profile: string, dir: 'to' | 'from', homes: LonLat[], places: LonLat[]): Promise<void> {
    const per = Math.max(1, Math.floor(MAX_ROUTES / places.length));
    for (let i = 0; i < homes.length; i += per) {
      const batch = homes.slice(i, i + per);
      await ors.acquire();
      const key = ors.keyValue;
      if (!key) return;
      const { minutes } = dir === 'to' ? await smallMatrix(profile, batch, places, key) : await smallMatrix(profile, places, batch, key);
      batch.forEach((home, h) =>
        places.forEach((place, p) => {
          const v = dir === 'to' ? minutes[h]?.[p] : minutes[p]?.[h];
          const k = `ors|${profile}|${dir}|${coordKey(home)}|${coordKey(place)}`;
          const m = typeof v === 'number' ? v : Number.NaN;
          this.mem.set(k, m);
          void this.kv.set(k, m).catch(() => {});
        }),
      );
    }
  }
}
