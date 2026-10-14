import { describe, expect, it } from 'vitest';
import { computeStreak } from '../../../src/lingo/streak';
import { addDays } from '../../../src/lingo/studyDay';

// The study streak (Studia progress spec D7, D8): N reviews or the queue finished make a day count; one
// missed day in any seven is a rest that keeps the run; today, still open, never breaks it.

const TODAY = '2026-10-13';

/** The days `from`…`to` days before today, both included (0 is today). */
function span(from: number, to: number): string[] {
  const days = [];
  for (let back = from; back >= to; back--) days.push(addDays(TODAY, -back));
  return days;
}

const states = (days: { stato: string }[]) => days.map((d) => d.stato);

describe('the study streak', () => {
  it('is zero with no history, and the week is empty up to today', () => {
    const streak = computeStreak([], TODAY, false);
    expect(streak.attuale).toBe(0);
    expect(streak.record).toBe(0);
    expect(streak.ultimiGiorni.map((d) => d.giorno)).toEqual(span(6, 0));
    expect(states(streak.ultimiGiorni)).toEqual(['saltato', 'saltato', 'saltato', 'saltato', 'saltato', 'saltato', 'oggi']);
    expect(streak.riposi.size).toBe(0);
  });

  it('counts the days in a row up to yesterday while today is open, and today once it counts', () => {
    expect(computeStreak(span(5, 1), TODAY, false).attuale).toBe(5);
    const done = computeStreak(span(5, 1), TODAY, true);
    expect(done.attuale).toBe(6);
    expect(done.record).toBe(6);
    expect(states(done.ultimiGiorni)).toEqual(['saltato', 'fatto', 'fatto', 'fatto', 'fatto', 'fatto', 'fatto']);
  });

  it('takes today from the caller, not from the stored days', () => {
    // A stored today that counted, recomputed as not counting (the goal was raised), is open.
    expect(computeStreak([...span(2, 1), TODAY], TODAY, false).attuale).toBe(2);
  });

  it('keeps the run over one missed day, which adds nothing', () => {
    const days = [...span(6, 4), ...span(2, 1)]; // day 3 missed
    const streak = computeStreak(days, TODAY, false);
    expect(streak.attuale).toBe(5);
    expect(states(streak.ultimiGiorni)).toEqual(['fatto', 'fatto', 'fatto', 'riposo', 'fatto', 'fatto', 'oggi']);
    expect([...streak.riposi]).toEqual([addDays(TODAY, -3)]);
  });

  it('keeps it over yesterday missed while today is open', () => {
    const streak = computeStreak(span(4, 2), TODAY, false);
    expect(streak.attuale).toBe(3);
    expect(streak.ultimiGiorni[5].stato).toBe('riposo');
  });

  it('breaks on two missed days in a row', () => {
    const streak = computeStreak([...span(9, 4), ...span(1, 1)], TODAY, false); // days 3 and 2 missed
    expect(streak.attuale).toBe(1);
    expect(streak.record).toBe(6);
    expect(states(streak.ultimiGiorni)).toEqual(['fatto', 'fatto', 'fatto', 'riposo', 'saltato', 'fatto', 'oggi']);
  });

  it('allows a rest seven days after the last one, and breaks on one six days after', () => {
    // Rests on days 14 and 7 (seven apart): the run holds.
    const seven = computeStreak([...span(20, 15), ...span(13, 8), ...span(6, 1)], TODAY, false);
    expect(seven.attuale).toBe(18);
    expect([...seven.riposi]).toEqual([addDays(TODAY, -14), addDays(TODAY, -7)]);
    // Rests due on days 13 and 7 (six apart): the second breaks the run.
    const six = computeStreak([...span(20, 14), ...span(12, 8), ...span(6, 1)], TODAY, false);
    expect(six.attuale).toBe(6);
    expect(six.record).toBe(12);
    expect([...six.riposi]).toEqual([addDays(TODAY, -13)]);
  });

  it('forgets the last rest when the run breaks', () => {
    // A rest on day 12, a break on days 10–9, a new run from day 8 with a rest on day 5: allowed, the old rest is gone.
    const streak = computeStreak([...span(14, 13), ...span(11, 11), ...span(8, 6), ...span(4, 1)], TODAY, false);
    expect(streak.attuale).toBe(7);
    expect([...streak.riposi]).toEqual([addDays(TODAY, -12), addDays(TODAY, -5)]);
  });

  it('keeps the record of an older run longer than the current one', () => {
    const streak = computeStreak([...span(40, 21), ...span(3, 1)], TODAY, true);
    expect(streak.attuale).toBe(4);
    expect(streak.record).toBe(20);
  });

  it('has no rest before the first counted day', () => {
    const streak = computeStreak(span(2, 1), TODAY, false);
    expect(states(streak.ultimiGiorni).slice(0, 4)).toEqual(['saltato', 'saltato', 'saltato', 'saltato']);
    expect(streak.riposi.size).toBe(0);
  });

  it('walks calendar days across a year and a clock change', () => {
    const newYear = computeStreak(['2026-12-30', '2026-12-31', '2027-01-01'], '2027-01-02', true);
    expect(newYear.attuale).toBe(4);
    const autumn = computeStreak(['2026-10-24', '2026-10-25', '2026-10-26'], '2026-10-27', false);
    expect(autumn.attuale).toBe(3);
    expect(autumn.ultimiGiorni.map((d) => d.giorno)).toEqual(['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
  });

  it('ignores a stored day after today (a clock set back)', () => {
    expect(computeStreak([...span(2, 1), addDays(TODAY, 1)], TODAY, false).attuale).toBe(2);
  });
});
