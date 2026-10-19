import type { ConteggiStati, GiornoAttivita, StatoGiorno } from '../../../../types/studia';

/**
 * The layout of the progress dashboard's charts, pure (Studia progress spec §4, §6). Days are the
 * server's Rome days, 'YYYY-MM-DD'; they are walked as calendar days in UTC and never read through the
 * browser's zone, so a reader in Los Angeles sees the same grid as one in Rome.
 */

const MS_PER_DAY = 86_400_000;

/** 'YYYY-MM-DD' at UTC midnight: a calendar day with no zone. */
export function dayDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function addDays(day: string, plusDays: number): string {
  return new Date(dayDate(day).getTime() + plusDays * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Monday 0 … Sunday 6. */
export function weekday(day: string): number {
  return (dayDate(day).getUTCDay() + 6) % 7;
}

const longDay = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const shortDay = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
const shortMonth = new Intl.DateTimeFormat('it-IT', { month: 'short', timeZone: 'UTC' });
const dayMonth = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** «martedì 7 ottobre». */
export function formatDayLong(day: string): string {
  return longDay.format(dayDate(day));
}

/** «mar 7». */
export function formatDayShort(day: string): string {
  return shortDay.format(dayDate(day));
}

/** «13 ottobre 2026». */
export function formatDate(day: string): string {
  return dayMonth.format(dayDate(day));
}

/**
 * A box of the current week: what the streak says of a past day or today; `futuro` for a day still to come;
 * `vuoto` for a past day before someone's first day of study, which is not a missed one.
 */
export interface WeekDay {
  giorno: string;
  /** «L», «M», «M», «G», «V», «S», «D». */
  lettera: string;
  stato: StatoGiorno | 'futuro' | 'vuoto';
}

const WEEK_LETTERS = ['L', 'M', 'M', 'G', 'V', 'S', 'D'] as const;

/**
 * The current week, Monday to Sunday (Gymnasium spec §5.1), from the server's today and its last seven days
 * (`serie.ultimiGiorni`, which reach back to this week's Monday). A day still to come is `futuro`; a past day before
 * `firstDay` — the first day the calendar holds, none for someone who never studied — is `vuoto`: a week that began
 * before them shows nothing missed.
 */
export function currentWeek(today: string, ultimiGiorni: { giorno: string; stato: StatoGiorno }[], firstDay: string | undefined): WeekDay[] {
  const monday = addDays(today, -weekday(today));
  return WEEK_LETTERS.map((lettera, index) => {
    const giorno = addDays(monday, index);
    if (giorno > today) return { giorno, lettera, stato: 'futuro' };
    const known = ultimiGiorni.find((d) => d.giorno === giorno)?.stato;
    if (giorno === today) return { giorno, lettera, stato: known ?? 'oggi' };
    if (firstDay === undefined || giorno < firstDay) return { giorno, lettera, stato: 'vuoto' };
    return { giorno, lettera, stato: known ?? 'saltato' };
  });
}

export interface CalendarCell {
  giorno: string;
  /** What the server said of the day; null when nothing happened. */
  day: GiornoAttivita | null;
  column: number;
  row: number;
}

export interface CalendarGrid {
  cells: CalendarCell[];
  /** The rest of this week after today, drawn as days to come: never chosen, never counted. */
  future: CalendarCell[];
  columns: number;
  /** A month's short name over the first column that starts in it. */
  months: { column: number; label: string }[];
  /** The most reviews in a day of the grid (0 when none). */
  max: number;
}

/**
 * The activity calendar: `weeks` columns, Monday on top, the last column ending today. The first
 * column starts on the Monday `weeks - 1` weeks before this week's, as the server's calendar does.
 */
export function calendarGrid(days: GiornoAttivita[], today: string, weeks: number): CalendarGrid {
  const byDay = new Map(days.map((d) => [d.giorno, d]));
  const start = addDays(today, -weekday(today) - (weeks - 1) * 7);
  const cells: CalendarCell[] = [];
  const months: CalendarGrid['months'] = [];
  let max = 0;
  let index = 0;
  for (let giorno = start; giorno <= today; giorno = addDays(giorno, 1), index += 1) {
    const column = Math.floor(index / 7);
    const day = byDay.get(giorno) ?? null;
    if (day) max = Math.max(max, day.ripassi);
    cells.push({ giorno, day, column, row: index % 7 });
    if (index % 7 === 0) {
      const label = shortMonth.format(dayDate(giorno));
      if (months.length === 0 || months[months.length - 1].label !== label) months.push({ column, label });
    }
  }
  // The first column's label is dropped when the next one starts a month: the two would overlap.
  if (months.length > 1 && months[1].column === 1) months.shift();
  const last = cells[cells.length - 1];
  const future: CalendarCell[] = [];
  for (let row = last.row + 1; row < 7; row += 1) future.push({ giorno: addDays(today, row - last.row), day: null, column: last.column, row });
  return { cells, future, columns: Math.ceil(cells.length / 7), months, max };
}

/**
 * A day of the calendar as the legend names it (Gymnasium spec §5.3): `fatto` the day counted, `riposo` a rest that
 * kept the streak, `saltato` a past day that did not count, `oggi` still open, `futuro` to come, and `vuoto` a day
 * before `firstDay` — the first day the calendar holds, none for someone who never studied —, which is not a missed
 * one. The flags are the whole day's even on a subject's calendar (the server's), so the states are too.
 */
export type CalendarDayState = StatoGiorno | 'futuro' | 'vuoto';

export function calendarDayState(cell: CalendarCell, today: string, firstDay: string | undefined): CalendarDayState {
  if (cell.giorno > today) return 'futuro';
  if (cell.day?.valido) return 'fatto';
  if (cell.day?.riposo) return 'riposo';
  if (cell.giorno === today) return 'oggi';
  if (firstDay === undefined || cell.giorno < firstDay) return 'vuoto';
  return 'saltato';
}

const counted = new Intl.NumberFormat('it-IT');

/** A count as an Italian reader writes it: «12.345» (four digits stay whole, «9999», as Italian usage has it). */
export function formatCount(n: number): string {
  return counted.format(n);
}

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

/**
 * What the line under the calendar says of a day, read aloud as it is (Gymnasium spec §5.3): «lunedì 12 ottobre: 14
 * ripassi, obiettivo raggiunto». A past day after `firstDay` that did not count says so; a day before it never does.
 * `narrowed`: the counts are one subject's, so a day with none of its reviews says «nessun ripasso in questa materia».
 */
export function describeDay(cell: CalendarCell, today: string, firstDay?: string, narrowed = false): string {
  const name = cell.giorno === today ? `Oggi, ${formatDayLong(cell.giorno)}` : formatDayLong(cell.giorno);
  const day = cell.day;
  const missed = calendarDayState(cell, today, firstDay) === 'saltato';
  if (!day || (day.ripassi === 0 && !day.valido)) {
    if (day?.riposo) return `${name}: giorno di riposo, la serie regge`;
    const nothing = narrowed ? 'nessun ripasso in questa materia' : 'nessun ripasso';
    return missed ? `${name}: ${nothing}, giorno saltato` : `${name}: ${nothing}`;
  }
  // A day with nothing to do that counted: the queue was empty when the user looked — or, on a subject's calendar, the
  // day counted with other subjects (`narrowed`).
  const none = narrowed ? 'nessun ripasso in questa materia' : 'niente da ripassare';
  const parts = [day.ripassi === 0 ? none : plural(day.ripassi, 'ripasso', 'ripassi')];
  if (day.nuove > 0) parts.push(plural(day.nuove, 'nuova', 'nuove'));
  if (day.sbagliate > 0) parts.push(plural(day.sbagliate, 'sbagliata', 'sbagliate'));
  if (day.valido) parts.push('obiettivo raggiunto');
  else if (missed) parts.push('obiettivo non raggiunto');
  if (day.riposo) parts.push('giorno di riposo, la serie regge');
  return `${name}: ${parts.join(', ')}`;
}

/** 0 for no review, else 1–4 by the share of the busiest day. */
export function heatLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((4 * count) / max))) as 1 | 2 | 3 | 4;
}

/** A round top for a bar chart's scale, at least 5: 7 → 10, 23 → 25, 140 → 150. */
export function niceMax(values: number[]): number {
  const top = Math.max(0, ...values);
  if (top <= 5) return 5;
  const step = top <= 50 ? 5 : top <= 200 ? 10 : 50;
  return Math.ceil(top / step) * step;
}

/** A whole percentage of `part` in `total` (0 when the total is). */
export function percent(part: number, total: number): number {
  return total > 0 ? Math.round((100 * part) / total) : 0;
}

/**
 * Whole percentages of `parts` that add up to 100 (largest remainder: each share rounded down, the points left over
 * to the largest fractions, the first part on a tie); all 0 when the total is.
 */
export function shares(parts: readonly number[]): number[] {
  const total = parts.reduce((n, part) => n + part, 0);
  if (total <= 0) return parts.map(() => 0);
  const result = parts.map((part) => Math.floor((100 * part) / total));
  let left = 100 - result.reduce((n, share) => n + share, 0);
  // The remainders in whole numbers (of `total`), so a tie is a tie and not a matter of floating point.
  const order = parts.map((part, index) => ({ index, rest: 100 * part - result[index] * total })).sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    result[index] += 1;
    left -= 1;
  }
  return result;
}

/** A share as written: «<1%» for a part above zero that rounds to none, so it never reads as nothing. */
export function shareLabel(share: number, part: number): string {
  return part > 0 && share === 0 ? '<1%' : `${share}%`;
}

export function totalCards(stati: ConteggiStati): number {
  return stati.nuove + stati.apprendimento + stati.consolidate;
}

/** The reviews of the last 30 Rome days, every subject's (`materie[].ripassi30`, which the server counts apart). */
export function recentReviews(materie: readonly { ripassi30: number }[]): number {
  return materie.reduce((n, row) => n + row.ripassi30, 0);
}

/**
 * The value lines of the coming days' chart: a whole number near half the scale, and its top (5 → 3 and 5). Each is
 * drawn at its own value's height, so a label never names a line it does not sit on.
 */
export function scaleLines(top: number): [number, number] {
  return [Math.round(top / 2), top];
}
