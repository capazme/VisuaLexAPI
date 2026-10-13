import { afterAll, describe, it, expect, vi } from 'vitest';

type StudyDay = typeof import('../../../src/lingo/studyDay');

// The module is imported afresh under each server clock zone: the day it computes must not depend on it.
async function loadUnderZone(zone: string): Promise<StudyDay> {
  process.env.TZ = zone;
  vi.resetModules();
  return import('../../../src/lingo/studyDay');
}

const originalZone = process.env.TZ;

afterAll(() => {
  if (originalZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalZone;
});

describe.each(['UTC', 'America/New_York', 'Europe/Rome', 'Pacific/Auckland'])(
  'the study day, with the server clock in %s',
  (zone) => {
    describe('romeDay', () => {
      it('is a different day before and after 00:00 in Rome (CEST, UTC+2)', async () => {
        const { romeDay } = await loadUnderZone(zone);
        expect(romeDay(new Date('2026-10-07T21:59:00Z'))).toBe('2026-10-07');
        expect(romeDay(new Date('2026-10-07T22:01:00Z'))).toBe('2026-10-08');
      });

      it('is a different day before and after 00:00 in Rome (CET, UTC+1)', async () => {
        const { romeDay } = await loadUnderZone(zone);
        expect(romeDay(new Date('2026-12-07T22:59:00Z'))).toBe('2026-12-07');
        expect(romeDay(new Date('2026-12-07T23:01:00Z'))).toBe('2026-12-08');
      });

      it('follows the night the clocks go back (25 October 2026)', async () => {
        const { romeDay } = await loadUnderZone(zone);
        expect(romeDay(new Date('2026-10-24T21:59:00Z'))).toBe('2026-10-24');
        expect(romeDay(new Date('2026-10-24T22:00:00Z'))).toBe('2026-10-25');
        expect(romeDay(new Date('2026-10-25T22:59:00Z'))).toBe('2026-10-25');
        expect(romeDay(new Date('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
      });

      it('follows the night the clocks go forward (29 March 2026)', async () => {
        const { romeDay } = await loadUnderZone(zone);
        expect(romeDay(new Date('2026-03-28T22:59:00Z'))).toBe('2026-03-28');
        expect(romeDay(new Date('2026-03-28T23:00:00Z'))).toBe('2026-03-29');
        expect(romeDay(new Date('2026-03-29T21:59:00Z'))).toBe('2026-03-29');
        expect(romeDay(new Date('2026-03-29T22:00:00Z'))).toBe('2026-03-30');
      });

      it('refuses an invalid date', async () => {
        const { romeDay } = await loadUnderZone(zone);
        expect(() => romeDay(new Date('nope'))).toThrow(RangeError);
      });
    });

    describe('daysBetween', () => {
      it('counts whole calendar days, across the clock changes', async () => {
        const { daysBetween } = await loadUnderZone(zone);
        expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
        expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
      });

      it('is 0 for the same day, negative backwards, and right across month and year ends', async () => {
        const { daysBetween } = await loadUnderZone(zone);
        expect(daysBetween('2026-10-07', '2026-10-07')).toBe(0);
        expect(daysBetween('2026-10-08', '2026-10-07')).toBe(-1);
        expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
        expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
      });

      it('refuses what is not a real day', async () => {
        const { daysBetween } = await loadUnderZone(zone);
        expect(() => daysBetween('2026-10-7', '2026-10-08')).toThrow(RangeError);
        expect(() => daysBetween('2026-10-07', '2026-02-30')).toThrow(RangeError);
        expect(() => daysBetween('2026-13-01', '2026-10-08')).toThrow(RangeError);
        expect(() => daysBetween('20261007xx', '2026-10-08')).toThrow(RangeError);
        expect(() => daysBetween('', '2026-10-08')).toThrow(RangeError);
        expect(() => daysBetween('2026/10/07', '2026-10-08')).toThrow(RangeError);
      });
    });

    describe('startOfRomeDay', () => {
      it('is 00:00 Rome, in summer and in winter', async () => {
        const { startOfRomeDay } = await loadUnderZone(zone);
        expect(startOfRomeDay('2026-10-07').toISOString()).toBe('2026-10-06T22:00:00.000Z');
        expect(startOfRomeDay('2026-12-07').toISOString()).toBe('2026-12-06T23:00:00.000Z');
      });

      it('keeps «tomorrow» the next calendar day when the clocks go back (25 October 2026)', async () => {
        const { startOfRomeDay } = await loadUnderZone(zone);
        expect(startOfRomeDay('2026-10-24', 1).toISOString()).toBe('2026-10-24T22:00:00.000Z');
        expect(startOfRomeDay('2026-10-25', 1).toISOString()).toBe('2026-10-25T23:00:00.000Z');
        expect(startOfRomeDay('2026-10-25').toISOString()).toBe('2026-10-24T22:00:00.000Z');
      });

      it('keeps «tomorrow» the next calendar day when the clocks go forward (29 March 2026)', async () => {
        const { startOfRomeDay } = await loadUnderZone(zone);
        expect(startOfRomeDay('2026-03-28', 1).toISOString()).toBe('2026-03-28T23:00:00.000Z');
        expect(startOfRomeDay('2026-03-29', 1).toISOString()).toBe('2026-03-29T22:00:00.000Z');
      });

      it('rolls over a month and a year', async () => {
        const { startOfRomeDay } = await loadUnderZone(zone);
        expect(startOfRomeDay('2026-12-31', 1).toISOString()).toBe('2026-12-31T23:00:00.000Z');
        expect(startOfRomeDay('2026-10-07', 30).toISOString()).toBe('2026-11-05T23:00:00.000Z');
      });

      it('lands on the Rome day it was asked for, across a whole year', async () => {
        const { romeDay, startOfRomeDay, daysBetween } = await loadUnderZone(zone);
        for (let plus = 0; plus < 400; plus++) {
          const at = startOfRomeDay('2026-01-01', plus);
          expect(daysBetween('2026-01-01', romeDay(at))).toBe(plus);
          // The instant before is still the previous day: it is exactly midnight.
          expect(daysBetween('2026-01-01', romeDay(new Date(at.getTime() - 1)))).toBe(plus - 1);
        }
      });

      it('refuses a day that is not real and a fractional offset', async () => {
        const { startOfRomeDay } = await loadUnderZone(zone);
        expect(() => startOfRomeDay('2026-02-30')).toThrow(RangeError);
        expect(() => startOfRomeDay('2026-10-07', 1.5)).toThrow(RangeError);
        expect(() => startOfRomeDay('tomorrow')).toThrow(RangeError);
      });
    });
  }
);
