import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import type { Voto } from '../../../types/studia';
import { formatInterval } from './formatInterval';
import { LESSON_PRIMARY } from './lessonStyles';
import { FOCUS_RING, MUTED_TEXT } from './progress/tokens';

const GRADES: Array<{ rating: Voto; label: string }> = [
  { rating: 1, label: 'Di nuovo' },
  { rating: 2, label: 'Difficile' },
  { rating: 3, label: 'Bene' },
  { rating: 4, label: 'Facile' },
];

/**
 * The bar at the foot of the lesson, on every width (Gymnasium spec §5.4): a line for what the bar has to say
 * (an error, the note after a grade, the practice pass) over the action, kept at its height so the buttons never
 * move, and the phone's safe edge under it. In the lesson's frame it sits in the flow, under the scrolling card; it
 * keeps the `pinnedBar` band so nothing the card raises paints over it.
 */
export function LessonBar({ status, children }: { status?: ReactNode; children: ReactNode }) {
  return (
    <div
      data-testid="lesson-bar"
      className={cn(
        Z_INDEX.pinnedBar,
        'relative shrink-0 border-t border-slate-200 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1 dark:border-slate-800 dark:bg-slate-900',
      )}
    >
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex min-h-8 items-center justify-center text-center text-sm">{status}</div>
        {children}
      </div>
    </div>
  );
}

export interface GradeBarProps {
  revealed: boolean;
  /** The days FSRS would schedule for each grade. */
  anteprima: Record<`${Voto}`, number>;
  onReveal: () => void;
  onGrade: (rating: Voto) => void;
  /** A pass for practice: the card was graded once already, and this grade is not sent. */
  practice?: boolean;
  /** A grade is on its way. */
  disabled?: boolean;
  /** The last grade did not reach the server. */
  saveError?: boolean;
  /** The note after the last grade («Torna tra 3 giorni»), for its second on screen; `noteKey` restarts it. */
  note?: string | null;
  noteKey?: number | null;
}

const GRADE =
  'flex min-h-[56px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-2 text-center leading-tight transition-[background-color,border-color,scale] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none disabled:opacity-60';
const NEUTRAL = 'border-slate-300 bg-white text-slate-900 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800';
const WARNING = 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200 dark:hover:bg-amber-900/30';

/**
 * What the user does next, in the lesson's bar: «Mostra risposta» (space), then the four grades (1–4). On each
 * grade the interval is the large text, because it is what the user decides on, and the grade the small one; only
 * «Di nuovo» has a tone of its own. The note after a grade sits on the bar's line, gives way to the practice line
 * once the next answer is shown, and is said once, politely, to a screen reader; it takes no focus.
 */
export function GradeBar({ revealed, anteprima, onReveal, onGrade, practice, disabled, saveError, note, noteKey }: GradeBarProps) {
  let status: ReactNode = null;
  if (saveError) {
    status = (
      <p role="alert" className="text-red-700 dark:text-red-400">
        Non registrato: riprova
      </p>
    );
  } else if (revealed && practice) {
    status = <p className={MUTED_TEXT}>Ripasso di pratica: non registrato</p>;
  } else if (note) {
    status = (
      <p key={noteKey ?? undefined} aria-hidden data-testid="grade-note" className="font-medium text-slate-700 motion-safe:animate-vlx-note dark:text-slate-200">
        {note}
      </p>
    );
  }

  return (
    <LessonBar
      status={
        <>
          {status}
          <span className="sr-only" aria-live="polite">
            {note ?? ''}
          </span>
        </>
      }
    >
      {revealed ? (
        <div role="group" aria-label="Come è andata?" className="flex gap-2">
          {GRADES.map(({ rating, label }) => (
            <button
              key={rating}
              type="button"
              disabled={disabled}
              aria-keyshortcuts={String(rating)}
              onClick={() => onGrade(rating)}
              className={cn(GRADE, FOCUS_RING, rating === 1 ? WARNING : NEUTRAL)}
            >
              {practice ? (
                <span className="text-base font-semibold">{label}</span>
              ) : (
                <>
                  <span className="text-base font-semibold">{formatInterval(anteprima[`${rating}`])}</span>
                  <span className="text-xs">{label}</span>
                </>
              )}
            </button>
          ))}
        </div>
      ) : (
        <button type="button" onClick={onReveal} aria-keyshortcuts="Space" className={LESSON_PRIMARY}>
          Mostra risposta
          <kbd className="hidden rounded border border-current/40 px-1.5 text-xs font-normal opacity-80 md:inline">Spazio</kbd>
        </button>
      )}
    </LessonBar>
  );
}
