import { describe, expect, it } from 'vitest';
import { bandOf, rankBands } from '../../src/compute/bands';
import { fairnessText, rankText } from '../../src/compute/overall';
import { overallValues, rankOf, stats } from '../../src/compute/surface';
import type { LinearForm } from '../../src/domain/formula';
import type { Person } from '../../src/domain/types';

const people: Person[] = [
  { id: 'a', name: 'Sam', colour: '#000' },
  { id: 'b', name: 'Alex', colour: '#fff' },
];
const form = (coef: [string, number][], constant = 0): LinearForm => ({ coef: new Map(coef), constant, specs: new Map() }) as LinearForm;

describe('the Overall view', () => {
  it('ranks by total plus half the gap, and measures unevenness as busiest over least busy', () => {
    const dense = new Map([
      ['x', Float32Array.from([60, 100, 200])],
      ['y', Float32Array.from([60, 50, 0])],
    ]);
    const forms = { combined: form([['x', 1], ['y', 1]]), persons: new Map([['a', form([['x', 1]])], ['b', form([['y', 1]])]]), specs: new Map() };
    const ov = overallValues(forms as never, dense, 3)!;
    expect([...ov.total]).toEqual([120, 150, 200]);
    expect([...ov.score]).toEqual([120, 175, 300]);
    expect(ov.ratio[0]).toBe(1);
    expect(ov.ratio[1]).toBe(2);
    expect(ov.ratio[2]).toBeGreaterThan(1000); // someone with no travel there
    // A person with no trips at all is left out: then there's no one to compare, so no Overall.
    const lone = { ...forms, persons: new Map([['a', form([['x', 1]])], ['b', form([])]]) };
    expect(overallValues(lone as never, dense, 3)).toBeNull();
  });

  it('bands by rank: the best 5%, 10%… 60% of spots', () => {
    const v = Float32Array.from({ length: 100 }, (_, i) => 100 - i);
    const st = stats(v);
    const b = rankBands(st.sorted, 'ylgn');
    expect(b.bands.map((x) => x.label)).toEqual(['Top 5%', 'Top 10%', 'Top 20%', 'Top 30%', 'Top 45%', 'Top 60%']);
    expect(b.bands[0].upper).toBe(5);
    expect(bandOf(b, 5)).toBe(0);
    expect(bandOf(b, 6)).toBe(1);
    expect(bandOf(b, 61)).toBe(-1);
    expect(rankOf(st.sorted, 1)).toBe(0);
    expect(rankOf(st.sorted, 51)).toBe(0.5);
    expect(rankText(st.sorted, 1)).toBe('One of the very best spots');
    expect(rankText(st.sorted, 9)).toBe('Top 8% of the map');
    expect(rankText(st.sorted, 81)).toBe('Slower than 80% of the map');
  });

  it('says who travels more, or that it’s shared evenly', () => {
    expect(fairnessText(new Map([['a', 300], ['b', 290]]), people)).toBe('Shared about evenly');
    expect(fairnessText(new Map([['a', 170], ['b', 384]]), people)).toBe('Alex travels 3 h 34 min more a week');
    expect(fairnessText(new Map([['a', 170], ['b', 0]]), people)).toBe('');
  });
});
