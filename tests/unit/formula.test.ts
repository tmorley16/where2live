import { describe, expect, it } from 'vitest';
import { specKey, legSpec } from '../../src/domain/fields';
import { tripsPerWeek, WEEKS_PER_YEAR } from '../../src/domain/frequency';
import { buildForms, evaluateAt } from '../../src/domain/formula';
import { defaultSettings } from '../../src/domain/presets';
import type { LonLat, ModeId, Place, Scenario, Trip } from '../../src/domain/types';

describe('frequency', () => {
  it('converts to trips per week', () => {
    expect(tripsPerWeek({ count: 5, per: 'week' })).toBe(5);
    expect(tripsPerWeek({ count: 1, per: 'fortnight' })).toBe(0.5);
    expect(tripsPerWeek({ count: 2, per: 'month' })).toBeCloseTo(24 / WEEKS_PER_YEAR, 10);
    expect(tripsPerWeek({ count: 52, per: 'year' })).toBeCloseTo(52 / WEEKS_PER_YEAR, 10);
    expect(tripsPerWeek({ count: -3, per: 'week' })).toBe(0);
    expect(tripsPerWeek({ count: Number.NaN, per: 'week' })).toBe(0);
  });
});

/** The plan's worked example: two people, five trips, known leg times at one home point. */
function example(): { s: Scenario; minutes: Map<string, number> } {
  const at = (n: number): LonLat => [151 + n / 100, -33.8];
  const place = (id: string, n: number): Place => ({ id, name: id, category: 'other', location: at(n) });
  const places = [place('workA', 1), place('workB', 2), place('church', 3), place('gym', 4), place('friends', 5)];
  const trip = (id: string, placeId: string, travellers: string[], mode: ModeId, count: number, per: 'week' | 'month', band: 'peak' | 'weekend' | 'offpeak'): Trip => ({
    id, placeIds: [placeId], travellers, together: travellers.length > 1, mode, frequency: { count, per }, legs: 'return',
    out: { band }, back: { band }, overheadMin: 0, enabled: true,
  });
  const s: Scenario = {
    schema: 1, name: 'test', region: { country: 'AU', centre: [151, -33.8] },
    people: [{ id: 'tom', name: 'Tom', colour: '#000' }, { id: 'partner', name: 'Partner', colour: '#111' }],
    places,
    trips: [
      trip('t1', 'workA', ['tom'], 'car', 5, 'week', 'peak'),
      trip('t2', 'workB', ['partner'], 'car', 4, 'week', 'peak'),
      trip('t3', 'church', ['tom', 'partner'], 'car', 1, 'week', 'weekend'),
      trip('t4', 'gym', ['tom'], 'bike', 3, 'week', 'offpeak'),
      trip('t5', 'friends', ['tom', 'partner'], 'car', 2, 'month', 'weekend'),
    ],
    candidates: [], settings: defaultSettings(),
  };
  const legs: [string, ModeId, number, number][] = [['workA', 'car', 20, 22], ['workB', 'car', 15, 15], ['church', 'car', 12, 12], ['gym', 'bike', 8, 9], ['friends', 'car', 25, 27]];
  const minutes = new Map<string, number>();
  for (const [id, mode, there, back] of legs) {
    const loc = places.find((p) => p.id === id)!.location!;
    minutes.set(specKey(legSpec(mode, 'out', loc, s.settings)), there);
    minutes.set(specKey(legSpec(mode, 'back', loc, s.settings)), back);
  }
  return { s, minutes };
}

describe('weekly total formula', () => {
  it('matches the worked example (per-person counting)', () => {
    const { s, minutes } = example();
    const f = buildForms(s);
    const get = (k: string) => minutes.get(k) ?? Number.NaN;
    expect(evaluateAt(f.combined, get)).toBeCloseTo(608.83, 1);
    expect(evaluateAt(f.persons.get('tom')!, get)).toBeCloseTo(392.92, 1);
    expect(evaluateAt(f.persons.get('partner')!, get)).toBeCloseTo(215.92, 1);
  });

  it('counts shared trips once under household counting', () => {
    const { s, minutes } = example();
    s.settings.accounting = 'household';
    const f = buildForms(s);
    expect(evaluateAt(f.combined, (k) => minutes.get(k) ?? Number.NaN)).toBeCloseTo(560.92, 1);
    // A person's own travel doesn't depend on the counting.
    expect(evaluateAt(f.persons.get('tom')!, (k) => minutes.get(k) ?? Number.NaN)).toBeCloseTo(392.92, 1);
  });

  it('applies overheads per leg, one-way legs and per-leg multiplier overrides', () => {
    const { s, minutes } = example();
    s.trips = [s.trips[0]];
    s.trips[0].overheadMin = 5; // 5 trips × 2 legs × 5 min = 50
    s.trips[0].back = { band: 'peak', multiplier: 1 }; // back leg 22 × 1 instead of × 1.4
    const f = buildForms(s);
    const get = (k: string) => minutes.get(k) ?? Number.NaN;
    expect(evaluateAt(f.combined, get)).toBeCloseTo(5 * (20 * 1.4 + 22) + 50, 6);
    s.trips[0].legs = 'there-only';
    expect(evaluateAt(buildForms(s).combined, get)).toBeCloseTo(5 * 20 * 1.4 + 25, 6);
  });

  it('leaves out disabled trips, trips with no travellers and unplaced places', () => {
    const { s, minutes } = example();
    s.trips[0].enabled = false;
    s.trips[1].travellers = ['someone-deleted'];
    s.places[2].location = null; // church
    const f = buildForms(s);
    const get = (k: string) => minutes.get(k) ?? Number.NaN;
    expect(evaluateAt(f.combined, get)).toBeCloseTo(51 + 2 * (24 / WEEKS_PER_YEAR) * 52, 6);
  });

  it('uses the outbound field for the leg back when symmetric', () => {
    const { s } = example();
    s.settings.symmetric.car = true;
    const keys = [...buildForms(s).specs.keys()];
    expect(keys.some((k) => k.startsWith('car|from'))).toBe(false);
    expect(keys.some((k) => k.startsWith('bike|from'))).toBe(true);
  });
});
