import { cn } from '../../../lib/utils';
import type { Voto } from '../../../types/studia';
import { formatInterval } from './formatInterval';

const GRADES: Array<{ rating: Voto; label: string }> = [
  { rating: 1, label: 'Di nuovo' },
  { rating: 2, label: 'Difficile' },
  { rating: 3, label: 'Bene' },
  { rating: 4, label: 'Facile' },
];

export interface GradeBarProps {
  revealed: boolean;
  /** The days FSRS would schedule for each grade. */
  anteprima: Record<`${Voto}`, number>;
  onReveal: () => void;
  onGrade: (rating: Voto) => void;
  /** A grade is on its way. */
  disabled?: boolean;
  /** The last grade did not reach the server. */
  saveError?: boolean;
}

const BUTTON =
  'flex min-h-[44px] flex-1 flex-col items-center justify-center rounded-lg border px-2 py-1.5 transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
const NEUTRAL = 'border-slate-300 bg-white text-slate-900 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800';
const WARNING = 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200 dark:hover:bg-amber-900/30';

/**
 * What the user does next: «Mostra risposta», then the four grades. Pinned at the bottom of the
 * screen on a phone (44 px targets), in the flow from `md` up. On each grade the interval is the
 * large text, because it is what the user decides on, and the grade the small one; only «Di nuovo»
 * has a tone of its own.
 */
export function GradeBar({ revealed, anteprima, onReveal, onGrade, disabled, saveError }: GradeBarProps) {
  return (
    <div
      // Over the feedback button (z-40) and under the menu drawer (z-50): no band in `Z_INDEX` sits between.
      className="fixed inset-x-0 bottom-0 z-[45] border-t border-slate-200 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:static md:z-auto md:mt-8 md:max-w-[60ch] md:border-0 md:bg-transparent md:p-0 dark:border-slate-800 dark:bg-slate-900 md:dark:bg-transparent"
    >
      {saveError && (
        <p role="alert" className="mb-2 text-sm text-red-600 dark:text-red-400">
          Non registrato: riprova
        </p>
      )}
      {revealed ? (
        <div role="group" aria-label="Come è andata?" className="flex gap-2">
          {GRADES.map(({ rating, label }) => (
            <button
              key={rating}
              type="button"
              disabled={disabled}
              aria-keyshortcuts={String(rating)}
              onClick={() => onGrade(rating)}
              className={cn(BUTTON, rating === 1 ? WARNING : NEUTRAL)}
            >
              <span className="text-base font-semibold">{formatInterval(anteprima[`${rating}`])}</span>
              <span className="text-xs">{label}</span>
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={onReveal}
          aria-keyshortcuts="Space"
          className="flex min-h-[44px] w-full items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-4 text-base font-medium text-slate-900 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          Mostra risposta
          <kbd className="hidden rounded border border-slate-300 px-1.5 text-xs font-normal text-slate-500 md:inline dark:border-slate-600 dark:text-slate-400">Spazio</kbd>
        </button>
      )}
    </div>
  );
}
