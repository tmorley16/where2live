import type { FieldSpec } from '../domain/fields';
import type { LonLat } from '../domain/types';
import type { GridWindow } from '../grid/lattice';
import { estimateField, estimateNearest } from './estimate';

/** A field laid out over the current window, in minutes. */
export interface DenseField {
  values: Float32Array;
  /** Points filled provisionally (interpolated from the coarse pass, or estimated) while real times load. */
  provisional: number;
  /** Every value is a straight-line estimate. */
  estimate: boolean;
}

/**
 * Where travel-time fields come from. The estimate provider answers at once; the ORS provider answers with
 * what it has (estimates for the rest) and notifies when more arrives.
 */
export interface FieldProvider {
  readonly name: string;
  get(spec: FieldSpec, window: GridWindow, ids: Float64Array): DenseField;
  /** Called with the spec keys whose data changed ('*mask' when only the mask did). */
  subscribe(listener: (specKeys: string[]) => void): () => void;
  /**
   * What the map needs now: the window and every field, with its weight (for fetching the biggest first). `focus`
   * (1 per window point) limits "any branch" fields to the promising part of the map.
   */
  need?(window: GridWindow, ids: Float64Array, specs: Map<string, { spec: FieldSpec; weight: number }>, focus?: Uint8Array): void;
  /** Points where no one can live (no road nearby), 1 = masked. */
  mask?(window: GridWindow, ids: Float64Array): Uint8Array | null;
  /** Places the router can't reach, by spec key, with a reason. */
  failures?(): Map<string, string>;
  /** For an "any branch" field: the index of the target quickest from a point. */
  nearest?(spec: FieldSpec, p: LonLat): number;
  dispose?(): void;
}

export class EstimateProvider implements FieldProvider {
  readonly name = 'estimate';
  get(spec: FieldSpec, _w: GridWindow, ids: Float64Array): DenseField {
    return { values: estimateField(spec, ids), provisional: 0, estimate: true };
  }
  nearest(spec: FieldSpec, p: LonLat): number {
    return estimateNearest(spec, p);
  }
  subscribe(): () => void {
    return () => {};
  }
}
