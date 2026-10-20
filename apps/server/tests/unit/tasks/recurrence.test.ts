import { describe, expect, it } from 'vitest';
import { nextOccurrence, RECURRENCE_RULES as R } from '../../../src/tasks/recurrence';

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
