import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GiornoAttivita } from '../../../../types/studia';
import { addDays, calendarGrid, currentWeek, formatDayLong, heatLevel, niceMax, percent, weekday } from './layout';

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

  it('draws 26 weeks ending on a Sunday: whole columns, Monday on top', () => {
    const grid = calendarGrid([], '2026-10-25', 26);
    expect(grid.columns).toBe(26);
    expect(grid.cells).toHaveLength(26 * 7);
    expect(grid.cells[0]).toMatchObject({ giorno: '2026-04-27', column: 0, row: 0 });
    expect(grid.cells.at(-1)).toMatchObject({ giorno: '2026-10-25', column: 25, row: 6 });
  });

  it('ends the last column on today, a Wednesday', () => {
    const grid = calendarGrid([], '2026-10-21', 12);
    expect(grid.columns).toBe(12);
    expect(grid.cells).toHaveLength(11 * 7 + 3);
    expect(grid.cells[0].giorno).toBe('2026-08-03');
    expect(grid.cells.at(-1)).toMatchObject({ giorno: '2026-10-21', column: 11, row: 2 });
  });

  it('puts the days the server sent in their cells, and finds the busiest', () => {
    const grid = calendarGrid([day('2026-10-20', 12), day('2026-10-14', 40)], '2026-10-21', 12);
    expect(grid.cells.find((c) => c.giorno === '2026-10-20')?.day?.ripassi).toBe(12);
    expect(grid.cells.find((c) => c.giorno === '2026-10-19')?.day).toBeNull();
    expect(grid.max).toBe(40);
  });

  it('labels a month over the first column that starts in it', () => {
    const grid = calendarGrid([], '2026-10-21', 12);
    expect(grid.months).toEqual([
      { column: 0, label: 'ago' },
      { column: 5, label: 'set' },
      { column: 9, label: 'ott' },
    ]);
  });

  it('draws the same grid whatever the browser’s zone', () => {
    const reference = calendarGrid([day('2026-10-25', 3)], '2026-10-26', 26);
    for (const zone of ['America/Los_Angeles', 'Pacific/Kiritimati', 'Europe/Rome']) {
      vi.stubEnv('TZ', zone);
      expect(calendarGrid([day('2026-10-25', 3)], '2026-10-26', 26)).toEqual(reference);
      expect(formatDayLong('2026-10-25')).toBe('domenica 25 ottobre');
    }
  });

  it('grades the heat by the busiest day', () => {
    expect(heatLevel(0, 40)).toBe(0);
    expect(heatLevel(1, 40)).toBe(1);
    expect(heatLevel(10, 40)).toBe(1);
    expect(heatLevel(11, 40)).toBe(2);
    expect(heatLevel(40, 40)).toBe(4);
    expect(heatLevel(3, 0)).toBe(0);
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
