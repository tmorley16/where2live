import type { KV } from '../cache/kv';
import { coordKey, type FieldSpec } from '../domain/fields';
import { MODES } from '../domain/modes';
import type { LonLat } from '../domain/types';
import { FieldData, densify } from '../grid/dense';
import { despike, fillIsolatedGaps } from '../grid/filters';
import { LEVEL, idToLonLat, idToMercator, lonLatToElement, onLevel, windowKey, type GridWindow } from '../grid/lattice';
import { TargetIndex } from '../grid/nearest';
import { zOrder } from '../grid/zorder';
import { Scheduler, type SchedulerStatus, type Task } from '../jobs/scheduler';
import type { JobStatus } from '../state/appStore';
import { estimateField, estimateNearest } from './estimate';
import type { OrsErrorKind, Quota } from './ors/client';
import { oneToMany, smallMatrix } from './ors/matrix';
import { snapDistances } from './ors/snap';
import type { DenseField, FieldProvider } from './provider';

/** Homes need a road: points with no drivable road within this distance are masked (water, bush, parks). */
const MASK_PROFILE = 'driving-car';
const MASK_RADIUS_M = 300;
const SNAP_CHUNK = 2500;
/** A matrix answer routed from further than this is treated as "no road here" (ORS searches up to ~2 km itself). */
const MAX_SNAPPED_M = 300;
/** Ask before a batch bigger than this (or more than half of what's left today). */
const CONFIRM_ABOVE = 30;
const PLAN_DELAY_MS = 800;
const FIELD_TTL_MS = 60 * 24 * 3600_000;
/** sources × destinations per request (the server allows 3,500). */
const MAX_ROUTES = 3400;

interface SnapTask extends Task {
  kind: 'snap';
  ids: number[];
}

interface MatrixTask extends Task {
  kind: 'matrix';
  spec: FieldSpec;
  specKey: string;
  ids: number[];
  depth: number;
  /** All-null came back for these ids: probe whether the place itself is reachable before splitting. */
  probe?: boolean;
  /** An "any branch" field: every home to each of these branches in one many-to-many request. */
  options?: LonLat[];
  optionKeys?: string[];
}

type OrsTask = SnapTask | MatrixTask;

interface FieldRecord {
  ids: Float64Array;
  minutes: Float32Array;
  km: Float32Array;
  at: number;
}

interface SnapRecord {
  ids: Float64Array;
  masked: Uint8Array;
  at: number;
}

export interface OrsOptions {
  key: () => string | null;
  kv: { fields: KV; snaps: KV };
  fetchImpl?: typeof fetch;
  onStatus?: (s: JobStatus) => void;
  onQuota?: (endpoint: 'matrix' | 'snap', q: Quota | null) => void;
  maxChunk?: () => number;
  onMaxChunk?: (n: number) => void;
  remaining?: () => number | null;
  /** For tests: run plans immediately. */
  planDelay?: number;
  now?: () => number;
}

function profileOf(spec: FieldSpec): string {
  return MODES[spec.mode].orsProfile ?? MASK_PROFILE;
}

/** The cache key of one target's field. A place and a branch at the same spot share it. */
function targetKey(profile: string, dir: 'to' | 'from', t: LonLat): string {
  return `ors|${profile}|${dir}|${coordKey(t)}`;
}

function cacheKey(spec: FieldSpec): string {
  return targetKey(profileOf(spec), spec.dir, spec.targets[0]);
}

/** Every cached field a spec reads: one, or one per branch. */
function keysOf(spec: FieldSpec): string[] {
  const profile = profileOf(spec);
  return spec.targets.map((t) => targetKey(profile, spec.dir, t));
}

function chunks<X>(xs: X[], size: number): X[][] {
  const out: X[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/**
 * Real road travel times from openrouteservice, cached in IndexedDB and fetched as the map needs them:
 * first a road check of every point (the mask), then the coarse lattice for every field (a quick first map),
 * then the remaining standard points. Answers at once from what it has, estimates filling the rest.
 *
 * "Any branch" fields keep one sparse field per branch (keyed like any place) and route each home only to its
 * few nearest branches, packed into many-to-many requests of up to 3,400 routes.
 */
export class OrsProvider implements FieldProvider {
  readonly name = 'ors';
  private listeners = new Set<(keys: string[]) => void>();
  private fields = new Map<string, FieldData>();
  private loads = new Map<string, Promise<void>>();
  private snaps = new Map<number, 0 | 1>();
  private snapsLoad: Promise<void>;
  private bad = new Map<string, Set<number>>();
  private failed = new Map<string, string>();
  /** Ids queued or in flight, per cache key (and 'snap'), so a re-plan never asks twice. */
  private pending = new Map<string, Set<number>>();
  /** For "any branch" specs: each window point's candidate branches. */
  private cands = new Map<string, { ids: Float64Array; list: number[][] }>();
  private needs: { window: GridWindow; ids: Float64Array; specs: Map<string, { spec: FieldSpec; weight: number }> } | null = null;
  /** The promising part of the window (1 per point), where "any branch" fields get road times; none = everywhere. */
  private focus: Uint8Array | undefined;
  private needSig = '';
  private declinedSig = '';
  private confirmedSig = '';
  private planTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private scheduler: Scheduler<OrsTask>;
  private sched: SchedulerStatus = { queued: 0, running: 0, done: 0, failed: 0, waiting: null };
  private confirm: JobStatus['confirm'] | undefined;
  private disposed = false;

  constructor(private o: OrsOptions) {
    this.scheduler = new Scheduler<OrsTask>(
      {
        run: (t, signal) => (t.kind === 'snap' ? this.runSnap(t, signal) : this.runMatrix(t, signal)),
        split: (t, kind) => this.split(t, kind),
        fail: (t) => this.giveUp(t),
        status: (s) => {
          this.sched = s;
          this.report();
        },
      },
      { matrix: 38, snap: 90 },
      3,
      o.now,
    );
    this.snapsLoad = this.loadSnaps();
  }

  private get now(): number {
    return (this.o.now ?? Date.now)();
  }

  // ---------- FieldProvider ----------

  subscribe(listener: (keys: string[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(keys: string[]) {
    for (const l of this.listeners) l(keys);
  }

  get(spec: FieldSpec, w: GridWindow, ids: Float64Array): DenseField {
    if (spec.targets.length > 1) return this.getSet(spec, w, ids);
    const field = this.fields.get(cacheKey(spec));
    const fallback = estimateField(spec, ids);
    const mask = this.mask(w, ids);
    const d = densify(w, ids, field, fallback, mask);
    if (field && field.size > 0) {
      fillIsolatedGaps(d.values, w.nx, w.ny, mask ?? undefined);
      if (d.provisional === 0) despike(d.values, w.nx, w.ny);
    }
    return { values: d.values, provisional: d.provisional, estimate: !field || field.size === 0 };
  }

  /** The nearest branch at each point: the minimum over its candidate branches, once all of them are known. */
  private getSet(spec: FieldSpec, w: GridWindow, ids: Float64Array): DenseField {
    const keys = keysOf(spec);
    const fields = keys.map((k) => this.fields.get(k));
    const cands = this.candidates(spec, ids);
    const mask = this.mask(w, ids);
    const known = new FieldData();
    let incomplete = 0;
    const focus = this.focus?.length === ids.length ? this.focus : undefined;
    for (let k = 0; k < ids.length; k++) {
      if (mask?.[k]) continue;
      let best = Infinity;
      let complete = true;
      for (const i of cands[k]) {
        const v = fields[i]?.get(ids[k]);
        if (v === undefined) {
          complete = false;
          break;
        }
        if (v < best) best = v; // NaN (no route to that branch) never wins
      }
      if (complete) known.values.set(ids[k], best === Infinity ? Number.NaN : best);
      else if (!focus || focus[k]) incomplete++; // outside the focus the estimate stands: not waiting for anything
    }
    const d = densify(w, ids, known, estimateField(spec, ids), mask);
    if (known.size > 0) {
      fillIsolatedGaps(d.values, w.nx, w.ny, mask ?? undefined);
      if (d.provisional === 0) despike(d.values, w.nx, w.ny);
    }
    return { values: d.values, provisional: Math.min(d.provisional, incomplete), estimate: known.size === 0 };
  }

  private candidates(spec: FieldSpec, ids: Float64Array): number[][] {
    const key = `${spec.mode}|${spec.dir}|${spec.targets.map(coordKey).join(';')}`;
    const hit = this.cands.get(key);
    if (hit && hit.ids === ids) return hit.list;
    const index = new TargetIndex(spec.targets);
    const list = Array.from(ids, (id) => {
      const [x, y] = idToMercator(id);
      return index.candidates(x, y);
    });
    this.cands.set(key, { ids, list });
    return list;
  }

  /** Which branch is quickest from a point: from road times at the nearest calculated point, else the estimate. */
  nearest(spec: FieldSpec, p: LonLat): number {
    if (spec.targets.length === 1) return 0;
    const n = this.needs;
    if (n) {
      const [c, r] = lonLatToElement(n.window, p);
      const cc = Math.round(c);
      const rr = Math.round(r);
      if (cc >= 0 && rr >= 0 && cc < n.window.nx && rr < n.window.ny) {
        const id = n.ids[rr * n.window.nx + cc];
        const keys = keysOf(spec);
        let best = -1;
        let bestMin = Infinity;
        for (const i of new TargetIndex(spec.targets).candidatesAt(p)) {
          const v = this.fields.get(keys[i])?.get(id);
          if (v === undefined) return estimateNearest(spec, p);
          if (v < bestMin) {
            bestMin = v;
            best = i;
          }
        }
        if (best >= 0) return best;
      }
    }
    return estimateNearest(spec, p);
  }

  mask(_w: GridWindow, ids: Float64Array): Uint8Array | null {
    if (this.snaps.size === 0) return null;
    const m = new Uint8Array(ids.length);
    for (let k = 0; k < ids.length; k++) m[k] = this.snaps.get(ids[k]) === 1 ? 1 : 0;
    return m;
  }

  failures(): Map<string, string> {
    return this.failed;
  }

  need(window: GridWindow, ids: Float64Array, specs: Map<string, { spec: FieldSpec; weight: number }>, focus?: Uint8Array): void {
    this.needs = { window, ids, specs };
    this.focus = focus && focus.length === ids.length ? focus : undefined;
    const sig = `${windowKey(window)}|${[...specs.keys()].sort().join(',')}`;
    if (sig !== this.needSig) {
      // Something real changed: plan once edits settle (the timer restarts with each change).
      this.needSig = sig;
      for (const { spec } of specs.values()) void this.loadField(spec);
      this.schedulePlan();
    } else if (!this.planTimer) {
      // Same needs (a weight changed, a redraw): plan if nothing is scheduled, without postponing a pending plan.
      this.schedulePlan();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.scheduler.drop(() => true);
    if (this.planTimer) clearTimeout(this.planTimer);
  }

  /** A slot within the per-minute limit for a one-off request (exact times). */
  acquire(): Promise<void> {
    return this.scheduler.acquire('matrix');
  }

  get keyValue(): string | null {
    return this.o.key();
  }

  // ---------- Confirmation, retry ----------

  /** The user agreed to a big batch. */
  confirmBatch(): void {
    this.confirmedSig = this.needSig;
    this.declinedSig = '';
    this.confirm = undefined;
    this.scheduler.hold(false);
    this.report();
  }

  declineBatch(): void {
    this.declinedSig = this.needSig;
    this.confirm = undefined;
    this.dropAll();
    this.scheduler.hold(false);
    this.report();
  }

  /** Fetch again now: after a new key, a decline, or failures. */
  retry(): void {
    this.declinedSig = '';
    this.failed.clear();
    this.scheduler.resume();
    this.schedulePlan(0);
  }

  // ---------- Planning ----------

  private schedulePlan(delay = this.o.planDelay ?? PLAN_DELAY_MS) {
    if (this.planTimer) clearTimeout(this.planTimer);
    this.planTimer = setTimeout(() => {
      this.planTimer = null;
      void this.plan();
    }, delay);
  }

  private pend(key: string): Set<number> {
    let s = this.pending.get(key);
    if (!s) this.pending.set(key, (s = new Set()));
    return s;
  }

  private dropAll() {
    for (const t of this.scheduler.drop(() => true)) this.release(t);
  }

  private release(t: OrsTask) {
    const keys = t.kind === 'snap' ? ['snap'] : (t.optionKeys ?? [cacheKey(t.spec)]);
    for (const k of keys) {
      const set = this.pending.get(k);
      if (set) for (const id of t.ids) set.delete(id);
    }
  }

  private taskId(t: MatrixTask, ids: number[], depth: number): string {
    return t.options ? `mm|${t.specKey}|${ids[0]}|${ids.length}|${depth}` : `m|${cacheKey(t.spec)}|${ids[0]}|${ids.length}|${depth}`;
  }

  /** Works out what's missing and queues it. Idempotent: anything cached or already queued is skipped. */
  async plan(): Promise<void> {
    if (this.disposed || !this.needs || !this.o.key()) return;
    const { window, ids, specs } = this.needs;
    await this.snapsLoad;
    await Promise.all([...specs.values()].map(({ spec }) => this.loadField(spec)));
    if (this.disposed || this.needs.ids !== ids) return;

    // Drop queued work this view no longer needs (a moved place, a changed set of branches, a changed area).
    const wanted = new Set([...specs.values()].filter(({ spec }) => spec.targets.length === 1).map(({ spec }) => cacheKey(spec)));
    const inWindow = new Set(ids);
    const stale = (t: OrsTask) =>
      (t.kind === 'matrix' && (t.options ? !specs.has(t.specKey) : !wanted.has(cacheKey(t.spec)))) || !t.ids.some((id) => inWindow.has(id));
    for (const t of this.scheduler.drop(stale)) this.release(t);
    if (this.declinedSig === this.needSig) return this.report();

    const tasks: OrsTask[] = [];
    // 1. The road check, for points not yet checked.
    const snapPending = this.pend('snap');
    const unchecked = zOrder(Array.from(ids).filter((id) => !this.snaps.has(id) && !snapPending.has(id)));
    for (const c of chunks(unchecked, SNAP_CHUNK)) {
      tasks.push({ id: `snap|${c[0]}|${c.length}`, kind: 'snap', priority: 1e7, ids: c });
      for (const id of c) snapPending.add(id);
    }
    // 2. Matrix requests for checked, road-side points: coarse lattice first, then the rest.
    const max = Math.max(1, this.o.maxChunk?.() ?? 3400);
    const levels: [(id: number) => boolean, number][] = [[(id) => onLevel(id, LEVEL.coarse), 2e6]];
    if (window.level < LEVEL.coarse) levels.push([(id) => !onLevel(id, LEVEL.coarse), 1e6]);
    for (const [specKey, { spec, weight }] of specs) {
      if (this.failed.has(specKey)) continue;
      const bad = this.bad.get(profileOf(spec));
      const usable = (id: number) => this.snaps.get(id) === 0 && !bad?.has(id);
      if (spec.targets.length > 1) {
        this.planSet(spec, specKey, weight, ids, usable, levels, max, tasks);
        continue;
      }
      const ck = cacheKey(spec);
      const f = this.fields.get(ck);
      const pend = this.pend(ck);
      for (const [onIt, base] of levels) {
        const list = zOrder(Array.from(ids).filter((id) => usable(id) && !f?.has(id) && !pend.has(id) && onIt(id)));
        for (const c of chunks(list, max)) {
          tasks.push({ id: `m|${ck}|${c[0]}|${c.length}|0`, kind: 'matrix', priority: base + weight, spec, specKey, ids: c, depth: 0 });
          for (const id of c) pend.add(id);
        }
      }
    }
    if (tasks.length === 0) return this.report();

    // A big batch waits for a yes.
    const requests = tasks.filter((t) => t.kind === 'matrix').length;
    const left = this.o.remaining?.() ?? null;
    if (this.confirmedSig !== this.needSig && (requests > CONFIRM_ABOVE || (left !== null && requests > left / 2))) {
      this.confirm = { requests, minutes: Math.max(requests / 38, (requests * 2.5) / 3 / 60), remaining: left };
      this.scheduler.hold(true);
    }
    this.scheduler.add(tasks);
    this.report();
  }

  /**
   * "Any branch": each point needs its candidate branches. Points are taken in Z-order (neighbours share branches)
   * and packed into tiles while points × branches stays within the route limit.
   */
  private planSet(
    spec: FieldSpec,
    specKey: string,
    weight: number,
    ids: Float64Array,
    usable: (id: number) => boolean,
    levels: [(id: number) => boolean, number][],
    max: number,
    tasks: OrsTask[],
  ) {
    const keys = keysOf(spec);
    const fields = keys.map((k) => this.fields.get(k));
    const pends = keys.map((k) => this.pend(k));
    const cands = this.candidates(spec, ids);
    const byId = new Map<number, number>();
    ids.forEach((id, k) => byId.set(id, k));
    for (const [onIt, base] of levels) {
      const focus = this.focus;
      const order = zOrder(Array.from(ids).filter((id) => usable(id) && onIt(id) && (!focus || focus[byId.get(id)!] === 1)));
      let pts: number[] = [];
      let opts = new Set<number>();
      const emit = () => {
        if (!pts.length) return;
        const list = [...opts];
        tasks.push({
          id: `mm|${specKey}|${pts[0]}|${pts.length}|0`,
          kind: 'matrix',
          priority: base + weight,
          spec,
          specKey,
          ids: pts,
          depth: 0,
          options: list.map((i) => spec.targets[i]),
          optionKeys: list.map((i) => keys[i]),
        });
        for (const i of list) for (const id of pts) pends[i].add(id);
        pts = [];
        opts = new Set();
      };
      for (const id of order) {
        const miss = cands[byId.get(id)!].filter((i) => !fields[i]?.has(id) && !pends[i].has(id));
        if (miss.length === 0) continue;
        const merged = new Set([...opts, ...miss]);
        if (pts.length && ((pts.length + 1) * merged.size > MAX_ROUTES || pts.length + 1 > max)) {
          emit();
          for (const i of miss) opts.add(i);
        } else opts = merged;
        pts.push(id);
      }
      emit();
    }
  }

  // ---------- Running ----------

  private async runSnap(t: SnapTask, signal: AbortSignal): Promise<void> {
    const key = this.o.key();
    if (!key) throw Object.assign(new Error('No key'), { kind: 'auth' });
    const { metres, quota } = await snapDistances(MASK_PROFILE, t.ids.map(idToLonLat), MASK_RADIUS_M, key, signal, this.o.fetchImpl);
    this.o.onQuota?.('snap', quota);
    t.ids.forEach((id, i) => this.snaps.set(id, Number.isFinite(metres[i]) && metres[i] <= MAX_SNAPPED_M ? 0 : 1));
    this.release(t);
    this.saveSnaps();
    this.notify(['*mask']);
    this.schedulePlan(0); // the matrix requests for these points can go now
  }

  private async runMatrix(t: MatrixTask, signal: AbortSignal): Promise<MatrixTask[] | void> {
    const key = this.o.key();
    if (!key) throw Object.assign(new Error('No key'), { kind: 'auth' });
    const profile = profileOf(t.spec);
    if (t.options) return this.runMany(t, profile, key, signal);
    const ck = cacheKey(t.spec);
    const place = t.spec.targets[0];

    if (t.probe) {
      // Is the place reachable at all? Route it to a point we know works.
      const probe = this.probePoint(profile, t.ids);
      const r = await oneToMany(profile, place, [idToLonLat(probe)], t.spec.dir, key, signal, this.o.fetchImpl);
      this.o.onQuota?.('matrix', r.quota);
      if (r.placeUnroutable || !Number.isFinite(r.minutes[0])) return this.failPlace(t, 'unreachable');
      return this.quarters(t);
    }

    const r = await oneToMany(profile, place, t.ids.map(idToLonLat), t.spec.dir, key, signal, this.o.fetchImpl);
    this.o.onQuota?.('matrix', r.quota);
    if (r.placeUnroutable) return this.failPlace(t, 'no-road');
    let finite = 0;
    for (const m of r.minutes) if (Number.isFinite(m)) finite++;
    if (finite === 0) {
      // One point on a separate road network (an island) can null a whole matrix (ORS bug #1785).
      if (t.ids.length === 1) {
        this.markBad(profile, t.ids);
        this.release(t);
        return;
      }
      return t.depth === 0 ? [{ ...t, id: `${t.id}|probe`, probe: true }] : this.quarters(t);
    }
    let maskChanged = false;
    for (let i = 0; i < t.ids.length; i++) {
      if (r.snappedM[i] > MAX_SNAPPED_M && this.snaps.get(t.ids[i]) !== 1) {
        this.snaps.set(t.ids[i], 1);
        maskChanged = true;
      }
    }
    this.field(ck).merge(t.ids, r.minutes, r.km);
    this.release(t);
    this.saveField(ck);
    if (maskChanged) this.saveSnaps();
    this.notify([...this.specKeysReading(new Set([ck])), ...(maskChanged ? ['*mask'] : [])]);
  }

  /** Homes × branches in one request; every answer is kept (each branch's field gains these homes). */
  private async runMany(t: MatrixTask, profile: string, key: string, signal: AbortSignal): Promise<MatrixTask[] | void> {
    const { minutes, quota } = await smallMatrix(profile, t.ids.map(idToLonLat), t.options!, key, signal, this.o.fetchImpl);
    this.o.onQuota?.('matrix', quota);
    let finite = 0;
    for (const row of minutes) for (const v of row) if (Number.isFinite(v)) finite++;
    if (finite === 0) {
      if (t.ids.length === 1) {
        this.markBad(profile, t.ids);
        this.release(t);
        return;
      }
      return this.quarters(t);
    }
    t.optionKeys!.forEach((ck, o) => {
      this.field(ck).merge(
        t.ids,
        t.ids.map((_, p) => minutes[p]?.[o] ?? Number.NaN),
      );
      this.saveField(ck);
    });
    this.release(t);
    this.notify(this.specKeysReading(new Set(t.optionKeys)));
  }

  private quarters(t: MatrixTask): MatrixTask[] {
    const size = t.ids.length <= 8 ? 1 : Math.ceil(t.ids.length / 4);
    return chunks(t.ids, size).map((ids) => ({ ...t, id: this.taskId(t, ids, t.depth + 1), ids, depth: t.depth + 1, probe: false }));
  }

  private split(t: OrsTask, kind: OrsErrorKind): OrsTask[] | null {
    if (t.ids.length <= 1) return null;
    if (t.kind === 'matrix' && kind !== 'too-big' && t.depth >= 3) return null;
    if (kind === 'too-big') this.o.onMaxChunk?.(Math.floor(t.ids.length / 2));
    const half = Math.ceil(t.ids.length / 2);
    return chunks(t.ids, half).map((ids, i) => (t.kind === 'snap' ? { ...t, id: `${t.id}|${i}`, ids } : { ...t, id: this.taskId(t, ids, t.depth + 1), ids, depth: t.depth + 1 }));
  }

  /** Given up after retries: leave the points missing (they'll be tried again on Retry). */
  private giveUp(t: OrsTask): void {
    this.release(t);
    if (t.kind === 'matrix' && t.depth >= 3) {
      this.markBad(profileOf(t.spec), t.ids);
    }
    this.report();
  }

  private failPlace(t: MatrixTask, reason: string): void {
    this.failed.set(t.specKey, reason);
    for (const x of this.scheduler.drop((q) => q.kind === 'matrix' && q.specKey === t.specKey)) this.release(x);
    this.release(t);
    this.notify([t.specKey]);
  }

  private markBad(profile: string, ids: number[]) {
    let s = this.bad.get(profile);
    if (!s) this.bad.set(profile, (s = new Set()));
    for (const id of ids) s.add(id);
    void this.o.kv.snaps.set(`ors|${profile}|bad`, Float64Array.from(s));
  }

  private probePoint(profile: string, avoid: number[]): number {
    const skip = new Set(avoid);
    for (const [ck, f] of this.fields) {
      if (!ck.startsWith(`ors|${profile}|`)) continue;
      for (const [id, m] of f.values) if (Number.isFinite(m) && !skip.has(id)) return id;
    }
    const ids = this.needs?.ids ?? new Float64Array(0);
    const mid = ids[Math.floor(ids.length / 2)];
    if (mid !== undefined && this.snaps.get(mid) === 0 && !skip.has(mid)) return mid;
    for (const id of ids) if (this.snaps.get(id) === 0 && !skip.has(id)) return id;
    return avoid[0];
  }

  // ---------- Cache ----------

  private field(ck: string): FieldData {
    let f = this.fields.get(ck);
    if (!f) this.fields.set(ck, (f = new FieldData()));
    return f;
  }

  private loadField(spec: FieldSpec): Promise<void> {
    return Promise.all(keysOf(spec).map((ck) => this.loadKey(ck))).then(() => {});
  }

  private loadKey(ck: string): Promise<void> {
    let p = this.loads.get(ck);
    if (!p) {
      p = this.o.kv.fields
        .get<FieldRecord>(ck)
        .then((rec) => {
          if (!rec || this.now - rec.at > FIELD_TTL_MS) return;
          const f = FieldData.fromArrays(rec.ids, rec.minutes, rec.km);
          const cur = this.fields.get(ck);
          if (cur) {
            const a = cur.toArrays(); // anything fetched while the cache was loading wins
            f.merge(a.ids, a.minutes, a.km);
          }
          this.fields.set(ck, f);
          const keys = this.specKeysReading(new Set([ck]));
          if (keys.length) this.notify(keys);
        })
        .catch(() => {});
      this.loads.set(ck, p);
    }
    return p;
  }

  /** The needed spec keys that read any of these cached fields. */
  private specKeysReading(cks: Set<string>): string[] {
    return [...(this.needs?.specs.entries() ?? [])].filter(([, v]) => keysOf(v.spec).some((k) => cks.has(k))).map(([k]) => k);
  }

  private saveField(ck: string) {
    clearTimeout(this.saveTimers.get(ck));
    this.saveTimers.set(
      ck,
      setTimeout(() => {
        const f = this.fields.get(ck);
        if (f) void this.o.kv.fields.set(ck, { ...f.toArrays(), at: this.now } satisfies FieldRecord).catch(() => {});
      }, 500),
    );
  }

  private async loadSnaps(): Promise<void> {
    try {
      const rec = await this.o.kv.snaps.get<SnapRecord>(`ors|${MASK_PROFILE}|r${MASK_RADIUS_M}`);
      if (rec && this.now - rec.at <= FIELD_TTL_MS) rec.ids.forEach((id, i) => this.snaps.has(id) || this.snaps.set(id, rec.masked[i] ? 1 : 0));
      for (const profile of ['driving-car', 'cycling-regular', 'foot-walking']) {
        const bad = await this.o.kv.snaps.get<Float64Array>(`ors|${profile}|bad`);
        if (bad) this.bad.set(profile, new Set(bad));
      }
      if (this.snaps.size) this.notify(['*mask']);
    } catch {
      /* no cache */
    }
  }

  private saveSnaps() {
    const k = `ors|${MASK_PROFILE}|r${MASK_RADIUS_M}`;
    clearTimeout(this.saveTimers.get(k));
    this.saveTimers.set(
      k,
      setTimeout(() => {
        const ids = Float64Array.from(this.snaps.keys());
        const masked = Uint8Array.from(this.snaps.values());
        void this.o.kv.snaps.set(k, { ids, masked, at: this.now } satisfies SnapRecord).catch(() => {});
      }, 500),
    );
  }

  // ---------- Status ----------

  /** Forget every cached travel time (Settings › Refresh travel times). */
  async clearCache(): Promise<void> {
    this.dropAll();
    this.fields.clear();
    this.loads.clear();
    this.snaps.clear();
    this.bad.clear();
    this.failed.clear();
    for (const kv of [this.o.kv.fields, this.o.kv.snaps]) for (const k of await kv.keys()) await kv.del(k);
    this.notify([...(this.needs?.specs.keys() ?? []), '*mask']);
    this.schedulePlan(0);
  }

  private report() {
    const s = this.sched;
    const todo = s.queued + s.running;
    let job: JobStatus;
    if (this.confirm && s.waiting?.reason === 'held') job = { state: 'confirm', todo, done: s.done, failed: s.failed, confirm: this.confirm };
    else if (s.waiting?.reason === 'auth') job = { state: 'auth', todo, done: s.done, failed: s.failed, message: 'Your routing key was rejected.' };
    else if (s.waiting?.reason === 'quota') job = { state: 'paused-quota', todo, done: s.done, failed: s.failed, until: s.waiting.until };
    else if (s.waiting?.reason === 'rate') job = { state: 'waiting', todo, done: s.done, failed: s.failed, until: s.waiting.until };
    else if (s.waiting?.reason === 'offline') job = { state: 'offline', todo, done: s.done, failed: s.failed };
    else if (this.declinedSig && this.declinedSig === this.needSig) job = { state: 'declined', todo: 0, done: s.done, failed: s.failed };
    else if (todo > 0) job = { state: 'running', todo, done: s.done, failed: s.failed };
    else if (this.failed.size > 0 || s.failed > 0) job = { state: 'error', todo: 0, done: s.done, failed: s.failed + this.failed.size };
    else job = { state: 'idle', todo: 0, done: s.done, failed: 0 };
    job.failures = Object.fromEntries(this.failed);
    this.o.onStatus?.(job);
  }
}
