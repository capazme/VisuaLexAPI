import { addDays } from '../lingo/studyDay';

/**
 * The Italian national public holidays, for the planner's «every working day» (answer 4 on the
 * task model). Days are 'YYYY-MM-DD' civil days, as in `lingo/studyDay.ts`.
 *
 * The fixed dates of l. 27 maggio 1949, n. 260, as amended, plus Easter Sunday and Easter Monday,
 * computed. 4 October (San Francesco) is a holiday again from 2026 (l. 8 ottobre 2025, n. 151).
 * Not here: a city's patron saint (Rome's 29 June, Milan's 7 December), which is local.
 *
 * This is not a court calendar: it knows nothing of the summer suspension of procedural time limits
 * or of the extension to the next working day (art. 155 c.p.c.). Procedural deadlines are wave 2.
 */

const FIXED: readonly string[] = [
  '01-01', // Capodanno
  '01-06', // Epifania
  '04-25', // Liberazione
  '05-01', // Festa del lavoro
  '06-02', // Festa della Repubblica
  '08-15', // Assunzione
  '11-01', // Ognissanti
  '12-08', // Immacolata
  '12-25', // Natale
  '12-26', // Santo Stefano
];

/** San Francesco d'Assisi, a national holiday from this year on (l. 151/2025). */
const SAN_FRANCESCO_FROM = 2026;

/** Easter Sunday of a Gregorian year, as 'YYYY-MM-DD' (the anonymous Gregorian algorithm, Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  if (!Number.isInteger(year) || year < 1583 || year > 9999) throw new RangeError('a Gregorian year, 1583 to 9999');
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Whether a day is a national public holiday in Italy. */
export function isItalianHoliday(day: string): boolean {
  // addDays validates the day (shape and calendar) before anything is read from it.
  addDays(day, 0);
  const year = Number(day.slice(0, 4));
  const monthDay = day.slice(5);
  if (FIXED.includes(monthDay)) return true;
  if (monthDay === '10-04' && year >= SAN_FRANCESCO_FROM) return true;
  const easter = easterSunday(year);
  return day === easter || day === addDays(easter, 1);
}

/** Monday to Friday, and not a national holiday. */
export function isWorkingDay(day: string): boolean {
  const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !isItalianHoliday(day);
}

/** The first working day after `day`. */
export function nextWorkingDay(day: string): string {
  let next = addDays(day, 1);
  // At most a long weekend next to a holiday or two: the loop is short.
  while (!isWorkingDay(next)) next = addDays(next, 1);
  return next;
}
