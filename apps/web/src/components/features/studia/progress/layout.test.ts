import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GiornoAttivita } from '../../../../types/studia';
import { addDays, calendarDayState, currentWeek, formatCount, niceMax, percent, recentReviews, scaleLines, shareLabel, shares, weekday } from './layout';

const day = (giorno: string, ripassi: number): GiornoAttivita => ({ giorno, ripassi, nuove: 0, sbagliate: 0, valido: ripassi >= 10, riposo: false });

describe('the progress layout', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('walks calendar days and weekdays', () => {
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-10-19', -175)).toBe('2026-04-27');
    expect(weekday('2026-10-19')).toBe(0); // a Monday
    expect(weekday('2026-10-25')).toBe(6);
  });

  it('names a calendar day’s state: a day before the first one studied is not missed', () => {
    const at = (giorno: string, d: GiornoAttivita | null = null) => ({ giorno, day: d, column: 0, row: 0 });
    const today = '2026-10-21';
    expect(calendarDayState(at('2026-10-22'), today, '2026-10-01')).toBe('futuro');
    expect(calendarDayState(at('2026-10-20', day('2026-10-20', 12)), today, '2026-10-01')).toBe('fatto');
    expect(calendarDayState(at('2026-10-20', { ...day('2026-10-20', 0), riposo: true }), today, '2026-10-01')).toBe('riposo');
    expect(calendarDayState(at(today), today, '2026-10-01')).toBe('oggi');
    expect(calendarDayState(at(today, day(today, 12)), today, '2026-10-01')).toBe('fatto');
    expect(calendarDayState(at('2026-10-20', day('2026-10-20', 3)), today, '2026-10-01')).toBe('saltato');
    expect(calendarDayState(at('2026-10-02'), today, '2026-10-01')).toBe('saltato');
    expect(calendarDayState(at('2026-09-30'), today, '2026-10-01')).toBe('vuoto');
    expect(calendarDayState(at('2026-10-20'), today, undefined)).toBe('vuoto');
  });

  it('writes counts the Italian way, sums the reviews of 30 days, and puts the scale’s lines on whole numbers', () => {
    expect([formatCount(9999), formatCount(12345)]).toEqual(['9999', '12.345']);
    expect(recentReviews([{ ripassi30: 310 }, { ripassi30: 0 }, { ripassi30: 2 }])).toBe(312);
    expect(scaleLines(5)).toEqual([3, 5]);
    expect(scaleLines(30)).toEqual([15, 30]);
    expect(scaleLines(10000)).toEqual([5000, 10000]);
  });

  it('rounds a scale up', () => {
    expect(niceMax([])).toBe(5);
    expect(niceMax([3, 4])).toBe(5);
    expect(niceMax([7])).toBe(10);
    expect(niceMax([23])).toBe(25);
    expect(niceMax([140])).toBe(140);
    expect(niceMax([141])).toBe(150);
    expect(niceMax([260])).toBe(300);
  });

  it('writes a share as a whole percentage', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(0, 0)).toBe(0);
  });

  it('rounds shares by the largest remainder, so they add up to 100', () => {
    expect(shares([1, 1, 1])).toEqual([34, 33, 33]);
    expect(shares([1, 2, 1])).toEqual([25, 50, 25]);
    // 16.67, 16.67, 66.67 → 16, 16, 66 (98): the two points left go to the largest fractions, first on a tie.
    expect(shares([1, 1, 4])).toEqual([17, 17, 66]);
    expect(shares([12345, 1, 9999])).toEqual([55, 0, 45]);
    expect(shares([0, 0, 0])).toEqual([0, 0, 0]);
    for (const parts of [[3, 3, 3], [7, 11, 13], [1, 998, 1], [5, 0, 0]]) expect(shares(parts).reduce((a, b) => a + b, 0)).toBe(100);
    expect([shareLabel(0, 1), shareLabel(0, 0), shareLabel(45, 9999)]).toEqual(['<1%', '0%', '45%']);
  });

  describe('the current week (Gymnasium spec §5.1)', () => {
    const last7 = (today: string, states: string[]) =>
      states.map((stato, i) => ({ giorno: addDays(today, i - 6), stato: stato as 'fatto' | 'riposo' | 'saltato' | 'oggi' }));

    it('runs Monday to Sunday with the seven letters; past days from the streak, today, the rest to come', () => {
      // Thursday 22 October 2026.
      const week = currentWeek('2026-10-22', last7('2026-10-22', ['fatto', 'fatto', 'fatto', 'fatto', 'riposo', 'saltato', 'oggi']), '2026-04-27');
      expect(week.map((d) => d.lettera).join('')).toBe('LMMGVSD');
      expect(week.map((d) => d.giorno)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
      expect(week.map((d) => d.stato)).toEqual(['fatto', 'riposo', 'saltato', 'oggi', 'futuro', 'futuro', 'futuro']);
    });

    it('starts on today when today is Monday, and holds a Sunday whole', () => {
      expect(currentWeek('2026-10-19', last7('2026-10-19', ['fatto', 'fatto', 'fatto', 'fatto', 'fatto', 'fatto', 'fatto']), '2026-10-01').map((d) => d.stato)).toEqual([
        'fatto', 'futuro', 'futuro', 'futuro', 'futuro', 'futuro', 'futuro',
      ]);
      expect(currentWeek('2026-10-25', last7('2026-10-25', ['fatto', 'riposo', 'fatto', 'saltato', 'fatto', 'fatto', 'oggi']), '2026-10-01').map((d) => d.stato)).toEqual([
        'fatto', 'riposo', 'fatto', 'saltato', 'fatto', 'fatto', 'oggi',
      ]);
    });

    it('shows nothing missed before someone’s first day of study, or to someone who never studied', () => {
      const missed = last7('2026-10-22', ['saltato', 'saltato', 'saltato', 'saltato', 'saltato', 'saltato', 'oggi']);
      expect(currentWeek('2026-10-22', missed, undefined).map((d) => d.stato)).toEqual(['vuoto', 'vuoto', 'vuoto', 'oggi', 'futuro', 'futuro', 'futuro']);
      // Began on Tuesday: Monday was before them, Wednesday was missed.
      expect(currentWeek('2026-10-22', missed, '2026-10-20').map((d) => d.stato)).toEqual(['vuoto', 'saltato', 'saltato', 'oggi', 'futuro', 'futuro', 'futuro']);
    });
  });
});
