import { describe, expect, it } from 'vitest';
import { formatInterval } from './formatInterval';

describe('formatInterval', () => {
  it.each([
    [1, 'domani'],
    [2, '2 giorni'],
    [3, '3 giorni'],
    [21, '21 giorni'],
    [29, '29 giorni'],
    [30, '1 mese'],
    [44, '1 mese'],
    [45, '2 mesi'],
    [90, '3 mesi'],
    [364, '12 mesi'],
    [365, '1 anno'],
    [370, '1 anno'],
    [548, '1,5 anni'],
    [730, '2 anni'],
    [3285, '9 anni'],
    [3650, '10 anni'],
    [4380, '12 anni'],
  ])('writes %i days as «%s»', (days, text) => {
    expect(formatInterval(days)).toBe(text);
  });

  it('says «oggi» for nothing or less (defensive: FSRS never schedules in the past)', () => {
    expect(formatInterval(0)).toBe('oggi');
    expect(formatInterval(-3)).toBe('oggi');
  });
});
