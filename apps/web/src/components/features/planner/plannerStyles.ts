import { FIELD_TEXT } from '../../../constants/interactions';
import { FOCUS_RING } from '../studia/progress/tokens';
import type { CountdownTone, DayTone } from './taskDates';
import type { TaskPriority } from '../../../types/tasks';

/**
 * The planner's classes, in Gymnasium's «Inchiostro» tokens (`studia/progress/tokens.ts`): every control 44 px at
 * every width, no text under 11 px (`plannerStyle.test.ts` reads the files), light and dark.
 */

/**
 * A field; in the dark theme the browser's own parts (a date's calendar, a time's clock, a list) are drawn dark. Its
 * text is `FIELD_TEXT`, 16 px at least below `md` whatever the text size: `text-base` is 14 px with «piccolo», and
 * Safari on an iPhone zooms into it.
 */
export const FIELD =
  `min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 ${FIELD_TEXT} text-slate-900 placeholder:text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400 dark:disabled:bg-slate-800 dark:[color-scheme:dark] ${FOCUS_RING}`;

export const FIELD_LABEL = 'text-sm font-medium text-slate-800 dark:text-slate-200';

export const FIELD_HINT = 'text-xs text-slate-600 dark:text-slate-400';

/** An icon-only control: 44 px square at every width. */
export const ICON_BUTTON = `inline-grid min-h-[44px] min-w-[44px] place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-50 ${FOCUS_RING}`;

/**
 * The tick's ring by priority, in colour and in line, so the colour is never the only sign: «Urgente» thick and
 * tinted, «Alta» tinted, «Media» dashed in ink, «Normale» thin. Red and amber for the two urgent ones, ink for
 * «Media»: not a red-orange-blue scale with the last unmarked, which is another app's look.
 */
export const PRIORITY_TICK: Record<TaskPriority, string> = {
  1: 'border-[3px] border-red-600 bg-red-50 dark:border-red-400 dark:bg-red-950/50',
  2: 'border-2 border-amber-600 bg-amber-50 dark:border-amber-400 dark:bg-amber-950/50',
  3: 'border-2 border-dashed border-primary-800 bg-white dark:border-primary-300 dark:bg-slate-900',
  4: 'border-[1.5px] border-slate-500 bg-white dark:border-slate-400 dark:bg-slate-900',
};

/** A priority's flag in its menu and on the sheet: filled in the tick's colour, «Normale» an empty outline. */
export const PRIORITY_FLAG: Record<TaskPriority, string> = {
  1: 'fill-current text-red-600 dark:text-red-400',
  2: 'fill-current text-amber-600 dark:text-amber-400',
  3: 'fill-current text-primary-800 dark:text-primary-300',
  4: 'text-slate-500 dark:text-slate-400',
};

export const PRIORITY_TEXT: Record<TaskPriority, string> = {
  1: 'text-red-700 dark:text-red-300',
  2: 'text-amber-800 dark:text-amber-300',
  3: 'text-slate-700 dark:text-slate-300',
  4: 'text-slate-600 dark:text-slate-400',
};

/** The deadline's chip: the one thing on the line drawn with a border, so it is seen first. */
export const DEADLINE_TONE: Record<CountdownTone, string> = {
  overdue: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200',
  today: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200',
  soon: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  later: 'border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200',
};

/** A quiet piece of a task's line: a day, a repetition, a label, the dossier. */
export const META = 'inline-flex min-w-0 items-center gap-1 text-xs text-slate-600 dark:text-slate-400';

/** A planned day's colour on a row (`dayTone`); the words say the same (`rowDay`). */
export const DAY_TONE: Record<DayTone, string> = {
  late: 'font-medium text-red-700 dark:text-red-300',
  today: 'text-emerald-700 dark:text-emerald-300',
  tomorrow: 'text-amber-800 dark:text-amber-300',
  week: 'text-primary-700 dark:text-primary-300',
  later: 'text-slate-600 dark:text-slate-400',
};
