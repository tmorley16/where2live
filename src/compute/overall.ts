import type { Id, Person, View } from '../domain/types';
import { fmtDuration } from './format';
import { rankOf } from './surface';

/** The Overall view (ranks spots by short and fairly shared travel) applies with two or more people. */
export function isOverall(view: View | undefined, people: Person[]): boolean {
  return view?.kind === 'balanced' && people.length > 1;
}

/** How evenly a home shares the travel: "Shared about evenly", "Alex travels 3 h 34 min more a week". */
export function fairnessText(persons: Map<Id, number>, people: Person[]): string {
  const rows = people.map((p) => ({ name: p.name, v: persons.get(p.id) ?? 0 })).filter((r) => r.v > 0);
  if (rows.length < 2) return '';
  rows.sort((a, b) => b.v - a.v);
  const most = rows[0];
  const least = rows[rows.length - 1];
  const gap = most.v - least.v;
  const sum = rows.reduce((a, r) => a + r.v, 0);
  if (gap <= Math.max(15, 0.1 * sum)) return 'Shared about evenly';
  return rows.length === 2 ? `${most.name} travels ${fmtDuration(gap)} more a week` : `${most.name} travels ${fmtDuration(gap)} more a week than ${least.name}`;
}

/** Where a spot's balanced score sits on the map: "Top 4% of the map", "Slower than 70% of the map". */
export function rankText(sorted: Float32Array, score: number): string {
  const p = rankOf(sorted, score);
  if (!Number.isFinite(p)) return '';
  if (p < 0.01) return 'One of the very best spots';
  if (p <= 0.5) return `Top ${Math.ceil(p * 100)}% of the map`;
  return `Slower than ${Math.round(p * 100)}% of the map`;
}

/** "1½×", "2×", "3×". */
export function fmtTimes(x: number): string {
  return `${x === 1.5 ? '1½' : String(x)}×`;
}
