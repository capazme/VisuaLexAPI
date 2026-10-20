import { describe, expect, it } from 'vitest';
import { dayOfMonth, landsOnDay, nextOccurrence, RECURRENCE_RULES as R } from '../../../src/tasks/recurrence';

describe('nextOccurrence from the planned date («ogni»)', () => {
  it('every day: the day after the planned date, or after today when done late', () => {
    expect(nextOccurrence(R.daily, 'pianificata', '2026-10-20', '2026-10-20')).toBe('2026-10-21');
    expect(nextOccurrence(R.daily, 'pianificata', '2026-10-15', '2026-10-20')).toBe('2026-10-21');
    expect(nextOccurrence(R.daily, 'pianificata', '2026-10-25', '2026-10-20')).toBe('2026-10-26');
  });

  it('every week: the planned weekday, the first one after today', () => {
    // Planned on Monday 19 October.
    expect(nextOccurrence(R.weekly, 'pianificata', '2026-10-19', '2026-10-19')).toBe('2026-10-26');
    expect(nextOccurrence(R.weekly, 'pianificata', '2026-10-19', '2026-10-21')).toBe('2026-10-26');
    expect(nextOccurrence(R.weekly, 'pianificata', '2026-10-19', '2026-10-17')).toBe('2026-10-26');
    expect(nextOccurrence(R.weekly, 'pianificata', '2026-10-19', '2026-10-26')).toBe('2026-11-02');
  });

  it('every month: the same day, or the month’s last day, counted from the planned date', () => {
    expect(nextOccurrence(R.monthly, 'pianificata', '2026-10-20', '2026-10-20')).toBe('2026-11-20');
    expect(nextOccurrence(R.monthly, 'pianificata', '2026-01-31', '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrence(R.monthly, 'pianificata', '2028-01-31', '2028-01-31')).toBe('2028-02-29');
    // Done in March: February is skipped, and the 31st is kept.
    expect(nextOccurrence(R.monthly, 'pianificata', '2026-01-31', '2026-03-05')).toBe('2026-03-31');
    expect(nextOccurrence(R.monthly, 'pianificata', '2026-12-15', '2026-12-15')).toBe('2027-01-15');
  });

  it('every year: 29 February becomes 28 in a common year and comes back in a leap one', () => {
    expect(nextOccurrence(R.yearly, 'pianificata', '2028-02-29', '2028-02-29')).toBe('2029-02-28');
    expect(nextOccurrence(R.yearly, 'pianificata', '2028-02-29', '2032-01-01')).toBe('2032-02-29');
    expect(nextOccurrence(R.yearly, 'pianificata', '2026-10-20', '2026-10-20')).toBe('2027-10-20');
  });

  /** Ticks a task on each planned date in turn, as a user who never falls behind does. */
  function ticks(rule: typeof R.monthly | typeof R.yearly, first: string, count: number): string[] {
    const recurrenceDay = dayOfMonth(first);
    const dates: string[] = [];
    let planned = first;
    for (let i = 0; i < count; i += 1) {
      planned = nextOccurrence(rule, 'pianificata', planned, planned, recurrenceDay);
      dates.push(planned);
    }
    return dates;
  }

  it('every month: the 31st is shortened only in a month without it, never for good', () => {
    expect(ticks(R.monthly, '2027-01-31', 6)).toEqual(['2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31', '2027-06-30', '2027-07-31']);
    expect(ticks(R.monthly, '2027-01-30', 3)).toEqual(['2027-02-28', '2027-03-30', '2027-04-30']);
    expect(ticks(R.monthly, '2028-01-29', 2)).toEqual(['2028-02-29', '2028-03-29']);
    // Done late, from a shortened date: the day kept, not the shortened one.
    expect(nextOccurrence(R.monthly, 'pianificata', '2027-02-28', '2027-03-10', 31)).toBe('2027-03-31');
    expect(nextOccurrence(R.monthly, 'pianificata', '2027-04-30', '2027-06-01', 31)).toBe('2027-06-30');
  });

  it('every year: 29 February goes back to the 29th in each leap year, tick after tick', () => {
    expect(ticks(R.yearly, '2028-02-29', 5)).toEqual(['2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29', '2033-02-28']);
  });

  it('every working day: skips weekends and the Italian holidays', () => {
    expect(nextOccurrence(R.workingDays, 'pianificata', '2026-04-03', '2026-04-03')).toBe('2026-04-07');
    expect(nextOccurrence(R.workingDays, 'pianificata', '2026-12-24', '2026-12-20')).toBe('2026-12-28');
    expect(nextOccurrence(R.workingDays, 'pianificata', '2026-10-01', '2026-10-23')).toBe('2026-10-26');
  });
});

describe('nextOccurrence from the completion («ogni!»)', () => {
  it('counts from today, whatever the planned date', () => {
    expect(nextOccurrence(R.daily, 'completamento', '2026-10-01', '2026-10-20')).toBe('2026-10-21');
    expect(nextOccurrence(R.weekly, 'completamento', '2026-10-01', '2026-10-20')).toBe('2026-10-27');
    expect(nextOccurrence(R.monthly, 'completamento', '2026-10-01', '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrence(R.yearly, 'completamento', '2026-10-01', '2028-02-29')).toBe('2029-02-28');
    expect(nextOccurrence(R.workingDays, 'completamento', '2026-10-01', '2026-12-24')).toBe('2026-12-28');
  });
});

describe('landsOnDay: where a kept day falls in a month', () => {
  it('on the day itself, or on the last day of a shorter month', () => {
    expect(landsOnDay('2027-03-31', 31)).toBe(true);
    expect(landsOnDay('2027-02-28', 31)).toBe(true);
    expect(landsOnDay('2027-04-30', 31)).toBe(true);
    expect(landsOnDay('2027-02-28', 29)).toBe(true);
    expect(landsOnDay('2028-02-29', 29)).toBe(true);
    expect(landsOnDay('2028-02-28', 29)).toBe(false);
    expect(landsOnDay('2028-02-28', 31)).toBe(false);
    expect(landsOnDay('2027-03-30', 31)).toBe(false);
    expect(landsOnDay('2027-03-15', 15)).toBe(true);
    expect(landsOnDay('2027-03-16', 15)).toBe(false);
  });
});
