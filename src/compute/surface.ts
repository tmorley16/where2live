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

/** How much of the gap between people the balanced view adds to the total. */
export const BALANCE = 0.5;

/** Balanced: the total plus half of what everyone else would need to match the busiest (for two people, half the gap). */
export function balancedValue(total: number, persons: Iterable<number>): number {
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  for (const v of persons) {
    max = Math.max(max, v);
    sum += v;
    count++;
  }
  return count < 2 ? total : total + BALANCE * (count * max - sum);
}

/** The values the map shows for a view: the household total, balanced, one person, or the busier person (fairest). */
export function viewValues(forms: Forms, view: View, dense: Map<string, Float32Array>, n: number): Float32Array {
  if (view.kind === 'person') {
    const f = forms.persons.get(view.id);
    if (f) return evaluateForm(f, dense, n);
  }
  const people = forms.persons.size;
  if (view.kind === 'person' || view.kind === 'combined' || (view.kind === 'balanced' && people < 2)) return evaluateForm(forms.combined, dense, n);
  // The busier person at each point, and (for balanced) everyone's sum.
  let max: Float32Array | null = null;
  const sum = new Float32Array(n);
  for (const f of forms.persons.values()) {
    const v = evaluateForm(f, dense, n);
    for (let i = 0; i < n; i++) sum[i] += v[i];
    if (!max) max = v;
    else for (let i = 0; i < n; i++) max[i] = Math.max(max[i], v[i]);
  }
  if (!max) return new Float32Array(n).fill(Number.NaN);
  if (view.kind === 'fairest') return max;
  const out = evaluateForm(forms.combined, dense, n);
  for (let i = 0; i < n; i++) out[i] += BALANCE * (people * max[i] - sum[i]);
  return out;
}

/** The Overall view's surfaces: the household total, the balanced score it ranks by, and how uneven the travel is. */
export interface Overall {
  total: Float32Array;
  score: Float32Array;
  /** The busiest person's weekly travel over the least busy one's (1 = even). People with no trips are left out. */
  ratio: Float32Array;
}

/** Null with fewer than two people who travel. */
export function overallValues(forms: Forms, dense: Map<string, Float32Array>, n: number): Overall | null {
  const persons = [...forms.persons.values()].filter((f) => f.coef.size > 0 || f.constant !== 0).map((f) => evaluateForm(f, dense, n));
  if (persons.length < 2) return null;
  const total = evaluateForm(forms.combined, dense, n);
  const score = new Float32Array(n);
  const ratio = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let max = -Infinity;
    let min = Infinity;
    let sum = 0;
    for (const v of persons) {
      max = Math.max(max, v[i]);
      min = Math.min(min, v[i]);
      sum += v[i];
    }
    score[i] = total[i] + BALANCE * (persons.length * max - sum);
    ratio[i] = min > 0 ? max / min : max > 0 ? 1e6 : 1;
  }
  return { total, score, ratio };
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
  /** Every valid value, ascending (for ranking a spot against the map). */
  sorted: Float32Array;
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
  if (valid === 0) return { min: Number.NaN, max: Number.NaN, p90: Number.NaN, p40: Number.NaN, argmin: -1, valid, sorted: new Float32Array(0) };
  const sorted = new Float32Array(valid);
  let k = 0;
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) sorted[k++] = values[i];
  sorted.sort();
  return { min, max, p90: sorted[Math.floor(0.9 * (valid - 1))], p40: sorted[Math.floor(0.4 * (valid - 1))], argmin, valid, sorted };
}

/** The share of the map (0–1) that does better than this value. */
export function rankOf(sorted: Float32Array, v: number): number {
  if (!sorted.length || !Number.isFinite(v)) return Number.NaN;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}
