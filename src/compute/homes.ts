import { buildForms } from '../domain/formula';
import type { Id, LonLat, Scenario, View } from '../domain/types';
import { estimateMinutes, estimateNearest } from '../routing/estimate';
import type { ExactTimes } from '../routing/exact';
import { breakdownAt, type Breakdown } from './breakdown';
import type { Engine } from './engine';

export interface HomeResult {
  breakdown: Breakdown;
  /** The value for the current view (household, balanced, one person, or the busier person). */
  value: number;
  /** From exact routing for this address (not read off the grid, not an estimate). */
  exact: boolean;
  /** Straight-line estimate (no key, or outside the area). */
  estimate: boolean;
}

export function viewValue(bd: Breakdown, view: View): number {
  if (view.kind === 'person') return bd.persons.get(view.id) ?? Number.NaN;
  if (view.kind === 'fairest') return bd.fairest;
  if (view.kind === 'balanced') return bd.balanced;
  return bd.combined;
}

/**
 * The weekly travel from one specific home. Exact times when we have them; otherwise read off the map's grid;
 * otherwise (outside the area) an estimate.
 */
export function homeResult(s: Scenario, home: LonLat, exact: ExactTimes, engine: Engine, preferExact: boolean): HomeResult | null {
  if (preferExact && exact.isExact()) {
    let complete = true;
    const bd = breakdownAt(
      s,
      (spec) => {
        const v = exact.get(home, spec);
        if (v === undefined) complete = false;
        return v ?? Number.NaN;
      },
      (spec) => engine.nearestOf(spec, home),
    );
    if (complete) return { breakdown: bd, value: viewValue(bd, s.settings.view), exact: true, estimate: false };
  }
  const grid = engine.breakdownAt(home);
  if (grid) return { breakdown: grid, value: viewValue(grid, s.settings.view), exact: false, estimate: engine.providerName === 'estimate' };
  const bd = breakdownAt(
    s,
    (spec) => Math.min(...spec.targets.map((t) => estimateMinutes(spec.mode, home, t))),
    (spec) => estimateNearest(spec, home),
  );
  return { breakdown: bd, value: viewValue(bd, s.settings.view), exact: false, estimate: true };
}

export function letter(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`;
}

/** Every field the scenario needs, for fetching exact times. */
export function scenarioSpecs(s: Scenario) {
  return [...buildForms(s).specs.values()];
}

export type CandidateRow = { id: Id; letter: string; result: HomeResult | null };
