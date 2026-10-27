import { createStore } from 'zustand/vanilla';
import type { Breakdown } from '../compute/breakdown';
import type { BBox, Id, LonLat } from '../domain/types';

export interface Hover {
  lonlat: LonLat;
  /** Pixel position inside the map. */
  x: number;
  y: number;
  value: number;
  lo: number;
  hi: number;
  breakdown: Breakdown | null;
}

export type Tab = 'places' | 'shortlist' | 'settings';

interface UI {
  tab: Tab;
  /** A slider is being dragged: band edges and the area stay put until it's released. */
  dragging: boolean;
  hover: Hover | null;
  /** The place waiting for a click on the map to set its location. */
  picking: Id | null;
  /** Bumped to ask the map to fit the search area. */
  fitRequest: number;
  /** What the map currently shows, for "search this view". */
  viewBBox: BBox | null;
  keyDialog: boolean;
  /** A spot clicked on the map, shown trip by trip in the panel. */
  probe: LonLat | null;
  /** Ask the map to fly to a point. */
  flyTo: { at: LonLat; n: number } | null;
}

export const uiStore = createStore<UI>(() => ({ tab: 'places', dragging: false, hover: null, picking: null, fitRequest: 0, viewBBox: null, keyDialog: false, probe: null, flyTo: null }));

export function flyTo(at: LonLat): void {
  uiStore.setState((s) => ({ flyTo: { at, n: (s.flyTo?.n ?? 0) + 1 } }));
}

export function requestFit(): void {
  uiStore.setState((s) => ({ fitRequest: s.fitRequest + 1 }));
}

/** Mark a slider drag from pointer down to pointer up (anywhere). */
export function startDrag(): void {
  if (uiStore.getState().dragging) return;
  uiStore.setState({ dragging: true });
  const end = () => {
    uiStore.setState({ dragging: false });
    globalThis.removeEventListener('pointerup', end);
    globalThis.removeEventListener('pointercancel', end);
  };
  globalThis.addEventListener('pointerup', end);
  globalThis.addEventListener('pointercancel', end);
}
