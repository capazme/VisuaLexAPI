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

/** Planned or due before today: the top of «Oggi». */
export function isOverdue(task: Pick<Task, 'plannedDate' | 'dueDate'>, today: string): boolean {
  return (task.plannedDate !== null && task.plannedDate < today) || (task.dueDate !== null && task.dueDate < today);
}

/** «Oggi»: the overdue tasks first, then today's, each in the server's order. */
export function splitToday<T extends Pick<Task, 'plannedDate' | 'dueDate'>>(tasks: T[], today: string): { overdue: T[]; today: T[] } {
  const overdue: T[] = [];
  const rest: T[] = [];
  for (const task of tasks) (isOverdue(task, today) ? overdue : rest).push(task);
  return { overdue, today: rest };
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
