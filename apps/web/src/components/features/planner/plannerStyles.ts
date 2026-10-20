import { FOCUS_RING } from '../studia/progress/tokens';
import type { CountdownTone } from './taskDates';
import type { TaskPriority } from '../../../types/tasks';

/**
 * The planner's classes, in Gymnasium's «Inchiostro» tokens (`studia/progress/tokens.ts`): every control 44 px at
 * every width, no text under 11 px (`plannerStyle.test.ts` reads the files), light and dark.
 */

export const FIELD =
  `min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 placeholder:text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 md:text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400 dark:disabled:bg-slate-800 ${FOCUS_RING}`;

export const FIELD_LABEL = 'text-sm font-medium text-slate-800 dark:text-slate-200';

export const FIELD_HINT = 'text-xs text-slate-600 dark:text-slate-400';

/** An icon-only control: 44 px square at every width. */
export const ICON_BUTTON = `inline-grid min-h-[44px] min-w-[44px] place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-50 ${FOCUS_RING}`;

/** The leading stripe of a task with a priority above the default (the colour markers' convention): never the only sign. */
export const PRIORITY_STRIPE: Record<TaskPriority, string | null> = {
  1: 'bg-red-600 dark:bg-red-400',
  2: 'bg-amber-500 dark:bg-amber-400',
  3: 'bg-primary-500 dark:bg-primary-400',
  4: null,
};

export const PRIORITY_TEXT: Record<TaskPriority, string> = {
  1: 'text-red-700 dark:text-red-300',
  2: 'text-amber-800 dark:text-amber-300',
  3: 'text-primary-700 dark:text-primary-300',
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
