import { cn } from '../../../lib/utils';
import { FOCUS_RING, INK_BG, ON_INK } from './progress/tokens';

/** The lesson's one primary action: a flat ink button, 44 px, as every primary action of the app (LC39: no raised key). */
export const LESSON_PRIMARY = cn(
  'flex min-h-[44px] w-full items-center justify-center gap-3 rounded-xl px-6 text-base font-semibold',
  'transition-[background-color,scale] hover:bg-primary-800 active:scale-[0.98] motion-reduce:transition-none dark:hover:bg-primary-200',
  INK_BG,
  ON_INK,
  // Disabled in the dark (LC19): the grey slab of every filled action, not the light key faded.
  'dark:disabled:bg-slate-700 dark:disabled:text-slate-400 dark:disabled:opacity-100',
  FOCUS_RING,
);
