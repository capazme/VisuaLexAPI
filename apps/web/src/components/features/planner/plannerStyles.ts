import { cn } from '../../../lib/utils';
import { buttonClassName } from '../../ui/buttonStyles';
import type { CountdownTone, DayTone } from './taskDates';
import type { TaskPriority } from '../../../types/tasks';

/**
 * The planner's own classes, in Gymnasium's «Inchiostro» tokens (`studia/progress/tokens.ts`), light and dark. Buttons
 * and fields are the common ones (LC110: `Button`, `IconButton`, `Input`, `Select`, `Textarea`), 44 px on a phone and
 * 36 from md; a row's icons stay 44 px at every width (`size="lg"`). No text under 11 px (`plannerStyle.test.ts`).
 */

/** A row's icon-only trigger for `MenuButton` («⋯»), which draws its own button: `IconButton size="lg"`'s look. */
export const MENU_TRIGGER = cn(buttonClassName('quiet', 'lg'), 'min-w-11 px-0');

/**
 * A field's trigger that opens a list, the sheet's dossier and priority (`DossierPicker`, `MenuButton`): a quiet
 * `Button` as wide as its column, its words at the left.
 */
export const FIELD_TRIGGER = cn(buttonClassName('quiet'), 'w-full justify-start px-2 text-left font-normal text-ink-900 dark:text-ink-50');

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
