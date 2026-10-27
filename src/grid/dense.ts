import { LEVEL, elementMercator, idAt, spacing, type GridWindow } from './lattice';

/** A field's known values by point id, in minutes (and route km). NaN = that point can't be routed for this field. */
export class FieldData {
  readonly values = new Map<number, number>();
  readonly km = new Map<number, number>();

  get size(): number {
    return this.values.size;
  }

  get(id: number): number | undefined {
    return this.values.get(id);
  }

  has(id: number): boolean {
    return this.values.has(id);
  }

  merge(ids: ArrayLike<number>, minutes: ArrayLike<number>, km?: ArrayLike<number>): void {
    for (let k = 0; k < ids.length; k++) {
      this.values.set(ids[k], minutes[k]);
      if (km) this.km.set(ids[k], km[k]);
    }
  }

  toArrays(): { ids: Float64Array; minutes: Float32Array; km: Float32Array } {
    const ids = new Float64Array(this.values.size);
    const minutes = new Float32Array(this.values.size);
    const km = new Float32Array(this.values.size);
    let k = 0;
    for (const [id, m] of this.values) {
      ids[k] = id;
      km[k] = this.km.get(id) ?? Number.NaN;
      minutes[k++] = m;
    }
    return { ids, minutes, km };
  }

  static fromArrays(ids: ArrayLike<number>, minutes: ArrayLike<number>, km?: ArrayLike<number>): FieldData {
    const f = new FieldData();
    f.merge(ids, minutes, km);
    return f;
  }
}

export interface Dense {
  values: Float32Array;
  /** Elements filled by interpolating coarse points or by the estimate, not yet fetched. */
  provisional: number;
  /** Elements with no value at all. */
  missing: number;
}

/**
 * Lays a field out over a window. Points not fetched yet are interpolated from the coarse lattice when the
 * four surrounding coarse points are known, otherwise taken from `fallback` (an estimate), and counted
 * as provisional.
 */
export function densify(w: GridWindow, ids: Float64Array, field: FieldData | undefined, fallback?: Float32Array, mask?: Uint8Array | null): Dense {
  const n = w.nx * w.ny;
  const values = new Float32Array(n);
  let provisional = 0;
  let missing = 0;
  const g = spacing(LEVEL.coarse);
  for (let k = 0; k < n; k++) {
    if (mask?.[k]) {
      values[k] = Number.NaN; // no homes here: never fetched, never provisional
      continue;
    }
    const known = field?.get(ids[k]);
    if (known !== undefined) {
      values[k] = known;
      continue;
    }
    let v = Number.NaN;
    if (field && field.size > 0 && w.level < LEVEL.coarse) {
      const [x, y] = elementMercator(w, k % w.nx, Math.floor(k / w.nx));
      const ic = Math.floor(x / g);
      const jc = Math.floor(y / g);
      const fx = x / g - ic;
      const fy = y / g - jc;
      // Bilinear over the corners that carry weight (a point on a coarse line needs only two).
      let sum = 0;
      let ok = true;
      for (const [di, dj, wt] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
        if (wt === 0) continue;
        const cv = field.get(idAt(LEVEL.coarse, ic + di, jc + dj));
        if (cv === undefined || !Number.isFinite(cv)) {
          ok = false;
          break;
        }
        sum += cv * wt;
      }
      if (ok) v = sum;
    }
    if (Number.isNaN(v) && fallback) v = fallback[k];
    if (Number.isNaN(v)) missing++;
    else provisional++;
    values[k] = v;
  }
  return { values, provisional, missing };
}
