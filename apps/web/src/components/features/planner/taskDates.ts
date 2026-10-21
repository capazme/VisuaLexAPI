import { addDaysToIsoDate } from '../../../utils/dateUtils';
import { RECURRENCE_RULES, type RecurrenceFrom, type RecurrenceRule, type Task, type TaskPriority } from '../../../types/tasks';

/**
 * The planner's words for days, deadlines, priorities and repetitions, pure. Every day is a Rome civil day
 * ('YYYY-MM-DD') and «today» is the one the server answered with its view (`TaskViewAnswer.today`): the browser's
 * own zone is never read. Days are walked in UTC, where a civil day has no clock change.
 */

const DAY_MS = 86_400_000;

function utc(day: string): number {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
}

/** Whole days from `from` to `to`: positive when `to` comes later. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

const longFormat = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const longYearFormat = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortFormat = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const shortYearFormat = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** «martedì 20 ottobre» (with the year when it is not today's). */
export function longDay(day: string, today: string): string {
  const format = day.slice(0, 4) === today.slice(0, 4) ? longFormat : longYearFormat;
  return format.format(new Date(utc(day)));
}

/** A day on a task's line: «Oggi», «Domani», «Ieri», else «ven 23 ott» (or «23 ott 2027» in another year). */
export function shortDay(day: string, today: string): string {
  const offset = daysBetween(today, day);
  if (offset === 0) return 'Oggi';
  if (offset === 1) return 'Domani';
  if (offset === -1) return 'Ieri';
  const format = day.slice(0, 4) === today.slice(0, 4) ? shortFormat : shortYearFormat;
  return format.format(new Date(utc(day))).replace(/\./g, '');
}

/** A heading of «Prossimi giorni»: «Oggi · martedì 20 ottobre», «Domani · …», else «Giovedì 22 ottobre». */
export function dayHeading(day: string, today: string): string {
  const offset = daysBetween(today, day);
  const long = longDay(day, today);
  if (offset === 0) return `Oggi · ${long}`;
  if (offset === 1) return `Domani · ${long}`;
  return capitalise(long);
}

const blockFormat = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const weekdayName = new Intl.DateTimeFormat('it-IT', { weekday: 'long', timeZone: 'UTC' });
const weekdayShort = new Intl.DateTimeFormat('it-IT', { weekday: 'short', timeZone: 'UTC' });
const monthYearFormat = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** A day's block in «Prossimi giorni»: «21 ott · Oggi · mercoledì», «22 ott · Domani · giovedì», «23 ott · venerdì». */
export function blockHeading(day: string, today: string): string {
  const offset = daysBetween(today, day);
  const date = blockFormat.format(new Date(utc(day))).replace(/\./g, '');
  const name = weekdayName.format(new Date(utc(day)));
  if (offset === 0) return `${date} · Oggi · ${name}`;
  if (offset === 1) return `${date} · Domani · ${name}`;
  return `${date} · ${name}`;
}

/** The Monday of a day's week (the Italian week starts on Monday). */
export function weekStart(day: string): string {
  const weekday = new Date(utc(day)).getUTCDay();
  return addDaysToIsoDate(day, -((weekday + 6) % 7));
}

/** A day in the week's strip: «lun» and «19». */
export function stripDay(day: string): { weekday: string; date: number } {
  return { weekday: weekdayShort.format(new Date(utc(day))).replace(/\./g, ''), date: Number(day.slice(8, 10)) };
}

/** «ottobre 2026». */
export function monthLabel(day: string): string {
  return monthYearFormat.format(new Date(utc(day)));
}

export type DayTone = 'late' | 'today' | 'tomorrow' | 'week' | 'later';

/** How a planned day reads on a row: late, today, tomorrow, later this week, or further. */
export function dayTone(day: string, today: string): DayTone {
  const offset = daysBetween(today, day);
  if (offset < 0) return 'late';
  if (offset === 0) return 'today';
  if (offset === 1) return 'tomorrow';
  return offset <= 6 ? 'week' : 'later';
}

/**
 * A planned day on a row: «Oggi», «Domani», the weekday for the rest of the week («venerdì»), else as `shortDay`;
 * a past one says how late it is in words («Ieri · in ritardo di 1 giorno»), never by its colour alone.
 */
export function rowDay(day: string, today: string): string {
  const offset = daysBetween(today, day);
  if (offset < 0) return `${shortDay(day, today)} · in ritardo di ${-offset} ${offset === -1 ? 'giorno' : 'giorni'}`;
  if (offset >= 2 && offset <= 6) return weekdayName.format(new Date(utc(day)));
  return shortDay(day, today);
}

export type CountdownTone = 'overdue' | 'today' | 'soon' | 'later';

/**
 * The deadline's count, the user's own date counted from today: «scaduto da 2 giorni», «scade oggi», «manca 1
 * giorno», «mancano 3 giorni». Nothing here computes a deadline: it counts the days to the one written.
 */
export function countdown(dueDate: string, today: string): { text: string; tone: CountdownTone } {
  const left = daysBetween(today, dueDate);
  if (left < 0) return { text: `scaduto da ${-left} ${-left === 1 ? 'giorno' : 'giorni'}`, tone: 'overdue' };
  if (left === 0) return { text: 'scade oggi', tone: 'today' };
  if (left === 1) return { text: 'manca 1 giorno', tone: 'soon' };
  return { text: `mancano ${left} giorni`, tone: left <= 3 ? 'soon' : 'later' };
}


/**
 * «Oggi» in three groups, each in the server's order: «Termini scaduti» (the deadline is past: always here, whatever
 * the planned date), then «In ritardo» (planned before today, the deadline not past or absent), then today's.
 */
export function splitToday<T extends Pick<Task, 'plannedDate' | 'dueDate'>>(
  tasks: T[],
  today: string,
): { missedDeadline: T[]; late: T[]; today: T[] } {
  const groups = { missedDeadline: [] as T[], late: [] as T[], today: [] as T[] };
  for (const task of tasks) {
    if (task.dueDate !== null && task.dueDate < today) groups.missedDeadline.push(task);
    else if (task.plannedDate !== null && task.plannedDate < today) groups.late.push(task);
    else groups.today.push(task);
  }
  return groups;
}

/** The seven days of «Prossimi giorni», today included. */
export const UPCOMING_DAYS = 7;

/**
 * «Prossimi giorni», day by day: a task sits under its planned date when that falls in the seven days, else under
 * its deadline, so it shows once. Days with nothing are left out; the order inside a day is the server's.
 */
export function groupUpcoming<T extends Pick<Task, 'plannedDate' | 'dueDate'>>(tasks: T[], today: string): { day: string; tasks: T[] }[] {
  const last = addDaysToIsoDate(today, UPCOMING_DAYS - 1);
  const inRange = (day: string | null): day is string => day !== null && day >= today && day <= last;
  const byDay = new Map<string, T[]>();
  for (const task of tasks) {
    const day = inRange(task.plannedDate) ? task.plannedDate : inRange(task.dueDate) ? task.dueDate : null;
    if (day === null) continue;
    const list = byDay.get(day) ?? [];
    list.push(task);
    byDay.set(day, list);
  }
  return [...byDay.keys()].sort().map((day) => ({ day, tasks: byDay.get(day)! }));
}

/** The four priorities in words: the colour is never the only sign. */
export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  1: 'Urgente',
  2: 'Alta',
  3: 'Media',
  4: 'Normale',
};

export const RECURRENCE_LABEL: Record<RecurrenceRule, string> = {
  [RECURRENCE_RULES.daily]: 'Ogni giorno',
  [RECURRENCE_RULES.workingDays]: 'Ogni giorno lavorativo',
  [RECURRENCE_RULES.weekly]: 'Ogni settimana',
  [RECURRENCE_RULES.monthly]: 'Ogni mese',
  [RECURRENCE_RULES.yearly]: 'Ogni anno',
};

export const RECURRENCE_FROM_LABEL: Record<RecurrenceFrom, string> = {
  pianificata: 'dalla data pianificata',
  completamento: 'dal giorno in cui lo completi',
};

/** «Si ripete ogni settimana», for a task's line. */
export function recurrenceLine(rule: RecurrenceRule): string {
  return `Si ripete ${RECURRENCE_LABEL[rule].toLowerCase()}`;
}

/** The count beside «Oggi» in the bar, in words for its name. */
export function todayCountLabel(count: number): string {
  return count === 1 ? '1 compito per oggi o scaduto' : `${count} compiti per oggi o scaduti`;
}
