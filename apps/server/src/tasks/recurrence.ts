import { addDays, daysBetween } from '../lingo/studyDay';
import { nextWorkingDay } from './italianHolidays';

/**
 * Simple repetition (the planner's row 10, answer 4): a task stores an RRULE (RFC 5545) of this
 * closed subset, and the server computes the next planned date when the task is ticked. Nothing
 * else is accepted: no interval, no end, no «the nth weekday» (wave 2).
 *
 * - every day; every week (the planned date's weekday); every month (its day of the month);
 *   every year (its day and month);
 * - every working day, written as the weekly-days rule but read by the server as Monday to Friday
 *   minus the Italian national holidays (`italianHolidays.ts`), which an RRULE cannot say.
 *
 * A month or a year without the day (the 31st, 29 February) takes its last day; the next step then
 * counts from that day (31 January, 28 February, 28 March).
 */
export const RECURRENCE_RULES = {
  daily: 'FREQ=DAILY',
  workingDays: 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR',
  weekly: 'FREQ=WEEKLY',
  monthly: 'FREQ=MONTHLY',
  yearly: 'FREQ=YEARLY',
} as const;

export type RecurrenceRule = (typeof RECURRENCE_RULES)[keyof typeof RECURRENCE_RULES];
export const RECURRENCE_RULE_VALUES = Object.values(RECURRENCE_RULES) as [RecurrenceRule, ...RecurrenceRule[]];

export type RecurrenceFrom = 'pianificata' | 'completamento';

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `day` moved by whole months, on the same day of the month or the month's last day. */
function addMonths(day: string, months: number): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  const targetDate = Math.min(date, daysInMonth(targetYear, targetMonth));
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(targetDate).padStart(2, '0')}`;
}

/** The first occurrence of the rule strictly after `day`. */
function step(rule: RecurrenceRule, day: string): string {
  switch (rule) {
    case RECURRENCE_RULES.daily:
      return addDays(day, 1);
    case RECURRENCE_RULES.workingDays:
      return nextWorkingDay(day);
    case RECURRENCE_RULES.weekly:
      return addDays(day, 7);
    case RECURRENCE_RULES.monthly:
      return addMonths(day, 1);
    case RECURRENCE_RULES.yearly:
      return addMonths(day, 12);
  }
}

/**
 * The next planned date of a repeating task ticked on `today` (a Rome day).
 *
 * - from the completion («ogni!»): the first occurrence after today, counted from today;
 * - from the planned date («ogni»): the rule's occurrences from the planned date, the first one
 *   after today. A task done late does not come back in the past, and one done early moves one
 *   step: planned Monday weekly, done on Wednesday or on the Saturday before, comes back on Monday
 *   next. Months and years count from the planned date itself, so the 31st keeps its 31st across
 *   the short months skipped on the way.
 */
export function nextOccurrence(rule: RecurrenceRule, from: RecurrenceFrom, plannedDay: string, today: string): string {
  if (from === 'completamento') return step(rule, today);
  const late = daysBetween(plannedDay, today);
  switch (rule) {
    case RECURRENCE_RULES.daily:
      return late >= 0 ? addDays(today, 1) : addDays(plannedDay, 1);
    case RECURRENCE_RULES.workingDays:
      return nextWorkingDay(late >= 0 ? today : plannedDay);
    case RECURRENCE_RULES.weekly:
      return addDays(plannedDay, 7 * (late >= 0 ? Math.floor(late / 7) + 1 : 1));
    case RECURRENCE_RULES.monthly:
    case RECURRENCE_RULES.yearly: {
      const months = rule === RECURRENCE_RULES.monthly ? 1 : 12;
      for (let n = 1; ; n += 1) {
        const next = addMonths(plannedDay, n * months);
        if (daysBetween(today, next) > 0) return next;
      }
    }
  }
}
