import type { Frequency, FreqUnit } from './types';

export const WEEKS_PER_YEAR = 365.25 / 7;

const PER_WEEK: Record<FreqUnit, number> = {
  week: 1,
  fortnight: 0.5,
  month: 12 / WEEKS_PER_YEAR,
  year: 1 / WEEKS_PER_YEAR,
};

export function tripsPerWeek(f: Frequency): number {
  const n = Number.isFinite(f.count) ? Math.max(0, f.count) : 0;
  return n * PER_WEEK[f.per];
}

const UNIT_WORD: Record<FreqUnit, string> = { week: 'week', fortnight: 'fortnight', month: 'month', year: 'year' };

export function describeFrequency(f: Frequency): string {
  const n = Math.round(f.count * 100) / 100;
  return `${n} × a ${UNIT_WORD[f.per]}`;
}
