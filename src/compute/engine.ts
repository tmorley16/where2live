import { createStore } from 'zustand/vanilla';
import { specKey, type FieldSpec } from '../domain/fields';
import { buildForms } from '../domain/formula';
import type { LonLat } from '../domain/types';
import { areaFor, type Area } from '../grid/area';
import { elementMercator, windowFor, windowIds, windowKey, type GridWindow } from '../grid/lattice';
import { fromMercator } from '../grid/mercator';
import { estimateNearest } from '../routing/estimate';
import { EstimateProvider, type FieldProvider } from '../routing/provider';
import { scenarioStore } from '../state/scenarioStore';
import { uiStore } from '../state/uiStore';
import { makeBands, type Bands } from './bands';
import { breakdownAt, type Breakdown } from './breakdown';
import { sampleAt } from './sample';
import { applyMask, stats, viewValues, type Stats } from './surface';

/** One computed surface, ready to draw. */
export interface Frame {
  version: number;
  window: GridWindow;
  values: Float32Array;
  stats: Stats;
  bands: Bands;
  area: Area;
  best: LonLat | null;
  /** Every field is a straight-line estimate. */
  estimate: boolean;
  /** Points still provisional (interpolated or estimated) while real times load. */
  provisional: number;
}

export interface Result {
  frame: Frame | null;
  area: Area | null;
  /** Why nothing is drawn. */
  empty: 'no-scenario' | 'no-trips' | null;
}

export const resultStore = createStore<Result>(() => ({ frame: null, area: null, empty: 'no-scenario' }));

const raf: (cb: () => void) => void = globalThis.requestAnimationFrame ? (cb) => globalThis.requestAnimationFrame(cb) : (cb) => setTimeout(cb, 0);

/**
 * Turns the scenario into a surface. Fields (the slow part) are kept for the current window and only fetched
 * when the places, modes or area change; weights (the fast part) are re-applied on every edit, at most once
 * per animation frame.
 */
export class Engine {
  private provider: FieldProvider;
  private unsubscribe: () => void = () => {};
  private area: Area | null = null;
  private areaKey = '';
  private window: GridWindow | null = null;
  private ids: Float64Array = new Float64Array(0);
  private dense = new Map<string, Float32Array>();
  private info = new Map<string, { provisional: number; estimate: boolean }>();
  private masks = new Map<string, { key: string; mask: Uint8Array }>();
  private frozen: { bands: Bands; palette: string; mode: string; step: number | 'auto' } | null = null;
  private scheduled = false;
  private version = 0;

  constructor(provider: FieldProvider = new EstimateProvider()) {
    this.provider = provider;
    this.listen(provider);
    scenarioStore.subscribe(() => this.schedule());
    uiStore.subscribe((s, p) => {
      if (s.dragging !== p.dragging) this.schedule();
    });
    this.schedule();
  }

  get providerName(): string {
    return this.provider.name;
  }

  get currentProvider(): FieldProvider {
    return this.provider;
  }

  setProvider(p: FieldProvider): void {
    this.unsubscribe();
    this.provider.dispose?.();
    this.provider = p;
    this.dense.clear();
    this.info.clear();
    this.listen(p);
    this.schedule();
  }

  private listen(p: FieldProvider) {
    this.unsubscribe = p.subscribe((keys) => {
      for (const k of keys) {
        this.dense.delete(k);
        this.info.delete(k);
      }
      this.schedule();
    });
  }

  /** The current window and its key, for masks computed outside the engine. */
  get currentWindow(): { window: GridWindow; key: string } | null {
    return this.window ? { window: this.window, key: windowKey(this.window) } : null;
  }

  /** A mask (1 = no homes here) from some source, for the window with this key. */
  setMask(source: string, key: string, mask: Uint8Array | null): void {
    const cur = this.masks.get(source);
    if (!mask && !cur) return; // nothing changes: don't recompute (and redraw, and loop)
    if (mask && cur && cur.key === key && cur.mask === mask) return;
    if (mask) this.masks.set(source, { key, mask });
    else this.masks.delete(source);
    this.schedule();
  }

  hasMask(source: string, key: string): boolean {
    return this.masks.get(source)?.key === key;
  }

  private combinedMask(): Uint8Array | null {
    if (!this.window) return null;
    const key = windowKey(this.window);
    const live = [...this.masks.values()].filter((m) => m.key === key).map((m) => m.mask);
    const routed = this.provider.mask?.(this.window, this.ids);
    if (routed) live.push(routed);
    if (live.length === 0) return null;
    if (live.length === 1) return live[0];
    const out = new Uint8Array(live[0].length);
    for (const m of live) for (let i = 0; i < out.length; i++) out[i] |= m[i];
    return out;
  }

  schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    raf(() => {
      this.scheduled = false;
      this.run();
    });
  }

  run(): void {
    const s = scenarioStore.getState().scenario;
    if (!s) {
      resultStore.setState({ frame: null, area: null, empty: 'no-scenario' });
      return;
    }
    const dragging = uiStore.getState().dragging;
    const forms = buildForms(s);
    // The area stays put while a slider is dragged, so a drag never sets off new routing.
    if (!dragging || !this.area) {
      const area = areaFor(s);
      const key = `${area.level}|${area.box.join(',')}`;
      if (key !== this.areaKey) {
        this.areaKey = key;
        this.window = windowFor(area.box, area.level);
        this.ids = windowIds(this.window);
        this.dense.clear();
        this.info.clear();
      }
      this.area = area;
    }
    if (forms.specs.size === 0 || !this.window) {
      resultStore.setState({ frame: null, area: this.area, empty: 'no-trips' });
      return;
    }
    const w = this.window;
    for (const k of [...this.dense.keys()]) {
      if (!forms.specs.has(k)) {
        this.dense.delete(k);
        this.info.delete(k);
      }
    }
    // Tell the provider what's needed, biggest weekly weight first. Not while dragging: a drag never fetches.
    if (!dragging && this.provider.need) {
      const needs = new Map<string, { spec: FieldSpec; weight: number }>();
      for (const [k, spec] of forms.specs) needs.set(k, { spec, weight: Math.abs(forms.combined.coef.get(k) ?? 0) });
      this.provider.need(w, this.ids, needs);
    }
    let estimate = true;
    let provisional = 0;
    for (const [k, spec] of forms.specs) {
      if (!this.dense.has(k)) {
        const d = this.provider.get(spec, w, this.ids);
        this.dense.set(k, d.values);
        this.info.set(k, { provisional: d.provisional, estimate: d.estimate });
      }
      const inf = this.info.get(k)!;
      estimate &&= inf.estimate;
      provisional += inf.provisional;
    }
    const values = viewValues(forms, s.settings.view, this.dense, w.nx * w.ny);
    applyMask(values, this.combinedMask());
    const st = stats(values);
    const { mode, step } = s.settings.bands;
    const palette = s.settings.display.palette;
    // While dragging, keep the band edges so colours keep their meaning, unless the values drift well outside them.
    const f = this.frozen;
    const slack = f ? f.bands.step || 30 : 0;
    const keep = dragging && f && f.palette === palette && f.mode === mode && f.step === step && st.min >= f.bands.base - slack && st.p90 <= f.bands.top + slack;
    const bands = keep ? f!.bands : makeBands(st.min, st.p90, mode, step, palette);
    this.frozen = dragging ? { bands, palette, mode, step } : null;
    const best = st.argmin >= 0 ? fromMercator(elementMercator(w, st.argmin % w.nx, Math.floor(st.argmin / w.nx))) : null;
    resultStore.setState({
      frame: { version: ++this.version, window: w, values, stats: st, bands, area: this.area!, best, estimate, provisional },
      area: this.area,
      empty: null,
    });
  }

  /** For an "any branch" field: the target quickest from a point. */
  nearestOf(spec: FieldSpec, p: LonLat): number {
    return this.provider.nearest?.(spec, p) ?? estimateNearest(spec, p);
  }

  /** Trip-by-trip minutes at a point, from the current fields. */
  breakdownAt(p: LonLat): Breakdown | null {
    const s = scenarioStore.getState().scenario;
    const w = this.window;
    if (!s || !w) return null;
    let ok = true;
    const bd = breakdownAt(
      s,
      (spec) => {
        const d = this.dense.get(specKey(spec));
        const smp = d ? sampleAt(d, w, p) : null;
        if (!smp) ok = false;
        return smp ? smp.value : Number.NaN;
      },
      (spec) => this.provider.nearest?.(spec, p) ?? estimateNearest(spec, p),
    );
    return ok ? bd : null;
  }
}

export const engine = new Engine();
