import type { Forms, LinearForm } from '../domain/formula';
import type { View } from '../domain/types';

/** Evaluate a form over every point of a window. NaN wherever a field it reads is unknown. */
export function evaluateForm(form: LinearForm, dense: Map<string, Float32Array>, n: number): Float32Array {
  const out = new Float32Array(n).fill(form.constant);
  for (const [k, c] of form.coef) {
    const d = dense.get(k);
    if (!d) return out.fill(Number.NaN);
    for (let i = 0; i < n; i++) out[i] += c * d[i];
  }
  return out;
}

/** The values the map shows for a view: the household total, one person, or the busier person (fairest). */
export function viewValues(forms: Forms, view: View, dense: Map<string, Float32Array>, n: number): Float32Array {
  if (view.kind === 'person') {
    const f = forms.persons.get(view.id);
    if (f) return evaluateForm(f, dense, n);
  }
  if (view.kind !== 'fairest') return evaluateForm(forms.combined, dense, n);
  let out: Float32Array | null = null;
  for (const f of forms.persons.values()) {
    const v = evaluateForm(f, dense, n);
    if (!out) out = v;
    else for (let i = 0; i < n; i++) out[i] = Math.max(out[i], v[i]);
  }
  return out ?? new Float32Array(n).fill(Number.NaN);
}

export interface Stats {
  min: number;
  max: number;
  p90: number;
  /** 40th percentile: the better 40% of the map is at or below it. */
  p40: number;
  /** Element index of the best point, −1 if none. */
  argmin: number;
  valid: number;
}

export function applyMask(values: Float32Array, mask: Uint8Array | null): void {
  if (!mask) return;
  for (let i = 0; i < values.length; i++) if (mask[i]) values[i] = Number.NaN;
}

export function stats(values: Float32Array): Stats {
  let min = Infinity;
  let max = -Infinity;
  let argmin = -1;
  let valid = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    valid++;
    if (v < min) {
      min = v;
      argmin = i;
    }
    if (v > max) max = v;
  }
  if (valid === 0) return { min: Number.NaN, max: Number.NaN, p90: Number.NaN, p40: Number.NaN, argmin: -1, valid };
  const sorted = new Float32Array(valid);
  let k = 0;
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) sorted[k++] = values[i];
  sorted.sort();
  return { min, max, p90: sorted[Math.floor(0.9 * (valid - 1))], p40: sorted[Math.floor(0.4 * (valid - 1))], argmin, valid };
}
