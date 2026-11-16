import { describe, expect, it } from 'vitest';
import { addMonths, computeDeadline, easterSunday, formatLong, holidayName, type DeadlineKind } from './computeDeadline';

const run = (kind: DeadlineKind, start: string, excludedFromSuspension = false) => computeDeadline({ kind, start, excludedFromSuspension });

describe('easter and holidays', () => {
  it('computes Easter', () => {
    expect(easterSunday(2025)).toBe('2025-04-20');
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
  });
  it('knows the national holidays and not the abolished ones', () => {
    expect(holidayName('2027-03-29')).not.toBeNull(); // Easter Monday
    expect(holidayName('2026-12-26')).not.toBeNull();
    expect(holidayName('2026-06-02')).not.toBeNull();
    expect(holidayName('2027-10-04')).not.toBeNull();
    expect(holidayName('2025-10-04')).toBeNull(); // before L. 151/2025
    for (const day of ['2026-03-19', '2026-06-29', '2026-11-04']) expect(holidayName(day)).toBeNull();
  });
});

describe('addMonths', () => {
  it('falls on the last day of a shorter month', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });
});

describe('computeDeadline', () => {
  it('appello: the mockup case, 15 December 2026', () => {
    const r = run('appello', '2026-12-15');
    expect(r.deadline).toBe('2027-01-14');
    expect(formatLong(r.deadline)).toBe('giovedì 14 gennaio 2027');
    expect(r.article).toBe('art. 325 c.p.c.');
    expect(r.basis).toBe('30 giorni dalla notifica del 15 dicembre 2026');
  });
  it('cassazione: 60 days, a Saturday slides to Monday', () => {
    expect(run('cassazione', '2026-12-15').deadline).toBe('2027-02-15'); // 13 Feb is a Saturday
  });
  it('a Sunday deadline slides to Monday', () => {
    expect(run('appello', '2026-12-18').deadline).toBe('2027-01-18'); // 17 Jan is a Sunday
  });
  it('Easter Monday, 26 December and 2 June are holidays', () => {
    expect(run('appello', '2027-02-27').deadline).toBe('2027-03-30');
    expect(run('appello', '2026-11-26').deadline).toBe('2026-12-28'); // Sat 26 Dec, Sun 27
    expect(run('appello', '2026-05-03').deadline).toBe('2026-06-03');
  });
  it('a notification in July crosses August', () => {
    expect(run('appello', '2026-07-15').deadline).toBe('2026-09-14');
  });
  it('without the suspension August is counted', () => {
    expect(run('appello', '2026-07-15', true).deadline).toBe('2026-08-14');
  });
  it('a notification inside August starts on 1 September', () => {
    expect(run('appello', '2026-08-10').deadline).toBe('2026-09-30');
    expect(run('appello', '2026-08-31').deadline).toBe('2026-09-30');
    expect(run('appello', '2026-08-10').steps[0]).toMatch(/sospensione feriale/);
  });
  it('termine lungo: six months, calendar then suspension', () => {
    expect(run('lungo', '2026-01-31').deadline).toBe('2026-07-31'); // no August in the decorso
    expect(run('lungo', '2026-03-10').deadline).toBe('2026-10-12'); // 10 Sep + 31 = Sun 11 Oct
    expect(run('lungo', '2026-03-10', true).deadline).toBe('2026-09-10');
  });
  it('termine lungo: month-end and a start inside August', () => {
    expect(run('lungo', '2026-08-31').deadline).toBe('2027-03-01'); // 28 Feb 2027 is a Sunday
    expect(run('lungo', '2026-08-31').article).toBe('art. 327 c.p.c.');
  });
  it('explains the calculation and ends on the deadline', () => {
    const steps = run('appello', '2026-12-15').steps;
    expect(steps.at(-1)).toBe('Scadenza: giovedì 14 gennaio 2027.');
    expect(steps.length).toBeGreaterThanOrEqual(3);
  });

  it('speaks of August only when August days fall in the decorso', () => {
    expect(run('appello', '2026-12-15').steps.join(' ')).not.toMatch(/agosto/);
    expect(run('appello', '2026-07-20').steps.join(' ')).toMatch(/saltando i giorni di agosto/);
  });
});
