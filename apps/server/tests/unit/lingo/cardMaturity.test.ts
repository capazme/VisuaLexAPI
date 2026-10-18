import { describe, expect, it } from 'vitest';
import { CONSOLIDATED_DAYS, maturity } from '../../../src/lingo/cardMaturity';
import { startOfRomeDay } from '../../../src/lingo/studyDay';

describe('the maturity of a reviewed card', () => {
  const reviewed = new Date('2026-10-19T08:00:00Z'); // 10:00 in Rome on the 19th

  it('is consolidated from a 21-day interval, learning below it', () => {
    expect(CONSOLIDATED_DAYS).toBe(21);
    expect(maturity(reviewed, startOfRomeDay('2026-10-19', 20))).toBe('apprendimento');
    expect(maturity(reviewed, startOfRomeDay('2026-10-19', 21))).toBe('consolidate');
    expect(maturity(reviewed, startOfRomeDay('2026-10-19', 1))).toBe('apprendimento');
  });

  it('counts Rome days: a review at 23:30 in Rome is that day, not the next', () => {
    const lateNight = new Date('2026-10-19T21:30:00Z'); // 23:30 in Rome on the 19th
    expect(maturity(lateNight, startOfRomeDay('2026-10-19', 21))).toBe('consolidate');
  });
});
