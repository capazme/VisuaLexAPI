/**
 * What «today» is for the review of study cards (spec decision 18): the calendar
 * day in Europe/Rome, whatever the server's clock zone. Elapsed days, «only the
 * first grade of the day», the daily goal and «domani» all count in these days.
 * Days travel as 'YYYY-MM-DD' strings; an instant appears only where a column
 * stores one (`LingoStatoRipasso.dueAt`, 00:00 Rome of the due day).
 *
 * Intl only, no dependency. Nothing here reads the server's own zone: every
 * conversion names Europe/Rome, and the day arithmetic runs in UTC.
 */

const ROME = 'Europe/Rome';
const MS_PER_DAY = 86_400_000;

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: ROME,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const offsetFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: ROME,
  timeZoneName: 'longOffset',
});

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

/** Splits a 'YYYY-MM-DD' day into its parts. A fixed-shape check, no pattern matching; refuses a day the calendar does not have. */
function parseDay(day: string): { year: number; month: number; date: number } {
  if (typeof day !== 'string' || day.length !== 10 || day[4] !== '-' || day[7] !== '-') {
    throw new RangeError('a day must be written YYYY-MM-DD');
  }
  for (const index of [0, 1, 2, 3, 5, 6, 8, 9]) {
    if (!isDigit(day[index])) throw new RangeError('a day must be written YYYY-MM-DD');
  }
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  const check = new Date(Date.UTC(year, month - 1, date));
  // Date.UTC maps 0–99 to 1900–1999, and rolls 31 February over to March: both are caught by reading the parts back.
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) {
    throw new RangeError('a day must be a real calendar day');
  }
  return { year, month, date };
}

function utcMidnight(day: string): number {
  const { year, month, date } = parseDay(day);
  return Date.UTC(year, month - 1, date);
}

/** Rome's offset from UTC at an instant, in milliseconds: 3,600,000 in winter, 7,200,000 in summer. */
function romeOffsetMs(at: Date): number {
  const part = offsetFormat.formatToParts(at).find((p) => p.type === 'timeZoneName');
  const text = part?.value ?? '';
  // 'GMT+02:00' (Rome is never plain 'GMT').
  if (text.length !== 9 || !text.startsWith('GMT') || (text[3] !== '+' && text[3] !== '-') || text[6] !== ':') {
    throw new Error(`unexpected offset for ${ROME}: ${text}`);
  }
  const sign = text[3] === '-' ? -1 : 1;
  const hours = Number(text.slice(4, 6));
  const minutes = Number(text.slice(7, 9));
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    throw new Error(`unexpected offset for ${ROME}: ${text}`);
  }
  return sign * (hours * 60 + minutes) * 60_000;
}

/** The calendar day in Europe/Rome as 'YYYY-MM-DD' (spec decision 18). */
export function romeDay(at: Date): string {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) throw new RangeError('romeDay needs a valid date');
  const parts = dayFormat.formatToParts(at);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/** Whole calendar days from one Rome day to another (may be 0, or negative when `toDay` is earlier). */
export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((utcMidnight(toDay) - utcMidnight(fromDay)) / MS_PER_DAY);
}

/** The calendar day `plusDays` after `day` (before it when negative), as 'YYYY-MM-DD': day arithmetic, no clock. */
export function addDays(day: string, plusDays: number): string {
  if (!Number.isInteger(plusDays)) throw new RangeError('plusDays must be a whole number');
  return new Date(utcMidnight(day) + plusDays * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * 00:00 Europe/Rome of the day `plusDays` after `day`, as an instant: what `dueAt` stores.
 *
 * The offset is read at the guess, UTC midnight of the target day. One pass is exact
 * because Rome changes its clocks at 02:00 and 03:00 local (01:00 UTC), never around
 * midnight: the guess and the true instant (the evening before, in UTC) are on the same
 * side of every change. Noon would not do: on a change day it has the other offset.
 */
export function startOfRomeDay(day: string, plusDays = 0): Date {
  if (!Number.isInteger(plusDays)) throw new RangeError('plusDays must be a whole number');
  const { year, month, date } = parseDay(day);
  const guess = new Date(Date.UTC(year, month - 1, date + plusDays));
  return new Date(guess.getTime() - romeOffsetMs(guess));
}
