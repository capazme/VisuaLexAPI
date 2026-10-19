import { cn } from '../../../lib/utils';
import { FOCUS_RING, INK_BG, ON_INK } from './progress/tokens';

/** The lesson's one primary action: an ink key, 48 px, that presses into its edge (as «Inizia» on Oggi). */
export const LESSON_PRIMARY = cn(
  'flex min-h-[48px] w-full items-center justify-center gap-3 rounded-xl px-6 text-base font-semibold',
  'shadow-[0_4px_0_var(--color-primary-950)] transition-[translate,box-shadow] active:translate-y-[3px] active:shadow-[0_1px_0_var(--color-primary-950)] motion-reduce:transition-none',
  'dark:shadow-[0_4px_0_var(--color-primary-500)] dark:active:shadow-[0_1px_0_var(--color-primary-500)]',
  INK_BG,
  ON_INK,
  FOCUS_RING,
);

/** A second action beside it: an outline of the same height. */
export const LESSON_SECONDARY = cn(
  'flex min-h-[48px] w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-6 text-base font-semibold text-slate-800',
  'transition-[background-color,scale] active:scale-[0.97] motion-reduce:transition-none hover:bg-slate-100',
  'dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800',
  FOCUS_RING,
);
