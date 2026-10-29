import { describe, expect, it } from 'vitest';
import { easterSunday, isItalianHoliday, isWorkingDay, nextWorkingDay } from '../../../src/tasks/italianHolidays';

describe('easterSunday', () => {
  it.each([
    [2000, '2000-04-23'],
    [2019, '2019-04-21'],
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    // The latest and the earliest possible dates, and a year it falls on 25 April.
    [1943, '1943-04-25'],
    [2285, '2285-03-22'],
    [2038, '2038-04-25'],
  ])('%i: %s', (year, expected) => {
    expect(easterSunday(year)).toBe(expected);
  });

  it('refuses a year outside the Gregorian calendar', () => {
    expect(() => easterSunday(1500)).toThrow(RangeError);
    expect(() => easterSunday(2026.5)).toThrow(RangeError);
  });
});

describe('isItalianHoliday', () => {
  it.each(['2026-01-01', '2026-01-06', '2026-04-25', '2026-05-01', '2026-06-02', '2026-08-15', '2026-11-01', '2026-12-08', '2026-12-25', '2026-12-26'])(
    'the fixed date %s',
    (day) => {
      expect(isItalianHoliday(day)).toBe(true);
    },
  );

  it('Easter Sunday and Easter Monday, computed', () => {
    expect(isItalianHoliday('2026-04-05')).toBe(true);
    expect(isItalianHoliday('2026-04-06')).toBe(true);
    expect(isItalianHoliday('2026-04-07')).toBe(false);
    expect(isItalianHoliday('2027-03-29')).toBe(true);
  });

  it('4 October from 2026 on (l. 151/2025), not before', () => {
    expect(isItalianHoliday('2025-10-04')).toBe(false);
    expect(isItalianHoliday('2026-10-04')).toBe(true);
    expect(isItalianHoliday('2027-10-04')).toBe(true);
  });

  it('no local patron saint, and an ordinary day is not a holiday', () => {
    expect(isItalianHoliday('2026-06-29')).toBe(false);
    expect(isItalianHoliday('2026-12-07')).toBe(false);
    expect(isItalianHoliday('2026-10-20')).toBe(false);
  });

  it('refuses a day the calendar does not have', () => {
    expect(() => isItalianHoliday('2026-02-30')).toThrow(RangeError);
    expect(() => isItalianHoliday('26-10-20')).toThrow(RangeError);
  });
});

describe('working days', () => {
  it('Saturday, Sunday and the holidays are not working days', () => {
    expect(isWorkingDay('2026-10-24')).toBe(false);
    expect(isWorkingDay('2026-10-25')).toBe(false);
    expect(isWorkingDay('2026-06-02')).toBe(false);
    expect(isWorkingDay('2026-10-20')).toBe(true);
  });

  it.each([
    ['2026-10-20', '2026-10-21', 'a Tuesday'],
    ['2026-10-23', '2026-10-26', 'a Friday: the weekend skipped'],
    ['2026-04-03', '2026-04-07', 'the Friday before Easter: Easter Monday skipped'],
    ['2026-12-24', '2026-12-28', 'Christmas Eve: Christmas, Santo Stefano and the Sunday skipped'],
    ['2026-06-01', '2026-06-03', 'the day before the Festa della Repubblica'],
    ['2027-10-01', '2027-10-05', 'the Friday before San Francesco on a Monday'],
    ['2025-08-14', '2025-08-18', 'the day before Ferragosto on a Friday'],
  ])('after %s comes %s (%s)', (day, expected) => {
    expect(nextWorkingDay(day)).toBe(expected);
  });
});
