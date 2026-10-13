import type { ConteggiStati, GiornoAttivita } from '../../../../types/studia';

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

export interface CalendarCell {
  giorno: string;
  /** What the server said of the day; null when nothing happened. */
  day: GiornoAttivita | null;
  column: number;
  row: number;
}

export interface CalendarGrid {
  cells: CalendarCell[];
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
  return { cells, columns: Math.ceil(cells.length / 7), months, max };
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

export function totalCards(stati: ConteggiStati): number {
  return stati.nuove + stati.apprendimento + stati.consolidate;
}
