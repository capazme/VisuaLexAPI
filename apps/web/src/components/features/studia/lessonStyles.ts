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
