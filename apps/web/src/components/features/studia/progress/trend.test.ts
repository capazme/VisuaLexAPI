import { describe, expect, it } from 'vitest';
import type { GiornoAttivita } from '../../../../types/studia';
import { addDays } from './layout';
import { CURVE_SAMPLES, curvePaths, resampleMonotone, trendScale, trendSeries } from './trend';

const day = (giorno: string, ripassi: number, over: Partial<GiornoAttivita> = {}): GiornoAttivita => ({ giorno, ripassi, nuove: 0, sbagliate: 0, valido: ripassi >= 10, riposo: false, ...over });
// Wednesday 21 October 2026.
const TODAY = '2026-10-21';

describe('trendSeries (G7)', () => {
  it('draws 30 days by day, ending today, with the days that are not in the read at zero', () => {
    const s = trendSeries([day(TODAY, 12), day(addDays(TODAY, -2), 4)], TODAY, '30g', 10);
    expect(s.points).toHaveLength(30);
    expect(s.points[29]).toMatchObject({ giorno: TODAY, ripassi: 12 });
    expect(s.points[27]).toMatchObject({ ripassi: 4 });
    expect(s.points[28].ripassi).toBe(0);
    expect(s.total).toBe(16);
    expect(s.goal).toBe(10);
    expect(s.byWeek).toBe(false);
  });

  it('compares with the period before of the same length, and says nothing when that one had no reviews', () => {
    const now = [day(TODAY, 12), day(addDays(TODAY, -1), 12)];
    expect(trendSeries([...now, day(addDays(TODAY, -8), 20)], TODAY, '7g', 10).change).toBe(20);
    expect(trendSeries([...now, day(addDays(TODAY, -8), 30)], TODAY, '7g', 10).change).toBe(-20);
    expect(trendSeries(now, TODAY, '7g', 10).change).toBeNull();
    // A day out of both periods counts for neither.
    expect(trendSeries([...now, day(addDays(TODAY, -14), 50)], TODAY, '7g', 10).change).toBeNull();
  });

  it('draws six months by week, Monday to Sunday, this week up to today, with seven days\' goal', () => {
    const monday = '2026-10-19';
    const s = trendSeries([day(TODAY, 5), day(monday, 3), day(addDays(monday, -1), 7)], TODAY, '6m', 10);
    expect(s.points).toHaveLength(26);
    expect(s.points[25]).toMatchObject({ giorno: monday, fino: TODAY, ripassi: 8 });
    expect(s.points[24]).toMatchObject({ giorno: addDays(monday, -7), ripassi: 7 });
    expect(s.goal).toBe(70);
    expect(s.change).toBeNull();
    expect(s.byWeek).toBe(true);
  });

  it('marks the days not done after the first day studied, never before it, at their place along the period', () => {
    const s = trendSeries([day(addDays(TODAY, -3), 12), day(addDays(TODAY, -1), 2, { valido: false }), day(TODAY, 0, { valido: false })], TODAY, '7g', 10);
    // Days −6…−4 come before the first day: nothing missed. −2 is missed, −1 did not count; today is still open.
    expect(s.missed).toEqual([4 / 6, 5 / 6]);
    expect(s.points.map((p) => p.stato)).toEqual(['vuoto', 'vuoto', 'vuoto', 'fatto', 'saltato', 'saltato', 'oggi']);
  });

  it('a rest keeps the streak and is not a missed day', () => {
    const s = trendSeries([day(addDays(TODAY, -2), 12), day(addDays(TODAY, -1), 0, { riposo: true, valido: false })], TODAY, '7g', 10);
    expect(s.points[5].stato).toBe('riposo');
    expect(s.missed).toEqual([]);
  });
});

describe('trendScale', () => {
  it('has four round ticks that cover the highest point and the goal', () => {
    expect(trendScale([3, 8], 10)).toEqual([0, 5, 10, 15]);
    expect(trendScale([42], 10)).toEqual([0, 20, 40, 60]);
    expect(trendScale([1990], 70)).toEqual([0, 1000, 2000, 3000]);
    expect(trendScale([0, 0], 0)).toEqual([0, 1, 2, 3]);
    for (const top of [7, 13, 667, 2001, 99]) {
      const ticks = trendScale([top], 10);
      expect(ticks[3]).toBeGreaterThanOrEqual(top);
      expect(ticks.every(Number.isInteger)).toBe(true);
    }
  });
});

describe('resampleMonotone', () => {
  it('invents no peak and never goes under zero between two days', () => {
    const values = [0, 12, 0, 0, 30, 2];
    const samples = resampleMonotone(values);
    expect(samples).toHaveLength(CURVE_SAMPLES);
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...samples)).toBeLessThanOrEqual(30);
    // The flat stretch between two days at zero stays at zero.
    const third = samples.slice(Math.ceil((2 / 5) * (CURVE_SAMPLES - 1)), Math.floor((3 / 5) * (CURVE_SAMPLES - 1)) + 1);
    expect(third.every((v) => v === 0)).toBe(true);
  });

  it('passes through every day', () => {
    const values = [3, 9, 4, 4, 10, 1, 7];
    const samples = resampleMonotone(values, 61);
    values.forEach((v, i) => expect(samples[i * 10]).toBeCloseTo(v, 6));
  });
});

describe('curvePaths', () => {
  it('draws the same number of points for any period, so a curve bends into another', () => {
    const week = curvePaths([1, 2, 3, 4, 5, 6, 7], 300, 100, 10);
    const month = curvePaths(Array.from({ length: 30 }, (_, i) => i % 7), 300, 100, 10);
    const count = (d: string) => d.split(/[ML]/).filter(Boolean).length;
    expect(count(week.line)).toBe(count(month.line));
    expect(count(week.line)).toBe(CURVE_SAMPLES);
    expect(week.area.endsWith('Z')).toBe(true);
  });
});
