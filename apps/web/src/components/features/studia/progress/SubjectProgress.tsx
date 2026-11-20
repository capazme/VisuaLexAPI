import { Illustration } from '../../../ui/Illustration';
import { cn } from '../../../../lib/utils';
import { CARD_GRID_COLUMNS } from '../../../layout/frame';
import type { Materia, Progressi } from '../../../../types/studia';
import { MATERIA_LABEL } from '../studiaLabels';
import { formatCount, percent, totalCards } from './layout';
import { orderStops, stopStates } from './today';
import { CARD_STATES, FOCUS_RING, INK_BORDER, MUTED_TEXT, SUBJECT_ART } from './tokens';

export interface SubjectProgressProps {
  materie: Progressi['materie'];
  selected: Materia | undefined;
  /** Sets the subject; the selected one again clears it. */
  onSelect: (materia: Materia | undefined) => void;
}

/**
 * A subject's card at its least, and its placeholder's height (LC112): the block keeps its height as the answer comes.
 * 166 px, the card with real counts (its header and its states each on two lines at a phone's width): 144 left the
 * placeholders of five cards 110 px short at 390 px (Papiniano).
 */
export const SUBJECT_CARD_HEIGHT = 'min-h-[10.375rem]';

const reviews = (n: number) => (n === 0 ? 'Nessun ripasso negli ultimi 30 giorni' : `${formatCount(n)} ${n === 1 ? 'ripasso' : 'ripassi'} negli ultimi 30 giorni`);

/**
 * Progress by subject (Studia progress spec §4.3; Gymnasium spec §5.3): always the five subjects, in the order of
 * «Oggi»'s road (`orderStops`: the cards still open first, then by name), each a button that narrows the page to it
 * (pressed again, it clears). A subject shows its share consolidated, its three states as a bar and in words, and the
 * reviews of the last 30 days. No «N da ripassare» here: the progress read does not carry it by subject (the road has
 * it from the read by institute, and it is not counted twice). The subjects are a grid of cards of at least 20rem
 * (`CARD_GRID_COLUMNS`, U1 §7), as many a row as the block holds: one on a phone, three at 1366 px with the sidebar,
 * four at 1920, all five at 1920 in full screen.
 */
export function SubjectProgress({ materie, selected, onSelect }: SubjectProgressProps) {
  return (
    <ul className={cn('grid gap-2', CARD_GRID_COLUMNS)}>
      {orderStops(materie).map((row) => {
        const total = totalCards(row);
        const on = selected === row.materia;
        return (
          <li key={row.materia}>
            {/* bare-button: a subject's card, its counts and bar inside, pressed to narrow the page. */}
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(on ? undefined : row.materia)}
              className={cn(
                'grid h-full w-full content-start gap-2 rounded-[8px] text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60',
                SUBJECT_CARD_HEIGHT,
                FOCUS_RING,
                // The chosen one's border is twice as thick and its padding a pixel less, so nothing moves.
                on ? cn('border-2 bg-slate-50 p-[11px] dark:bg-slate-800/60', INK_BORDER) : 'border border-slate-200 p-3 dark:border-slate-800',
              )}
            >
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-50">
                  {/* LC37: the subject's emblem, not a coloured dot. */}
                  <Illustration name={SUBJECT_ART[row.materia]} className="h-8 w-8" />
                  {MATERIA_LABEL[row.materia]}
                </span>
                <span className={cn('text-xs tabular-nums', MUTED_TEXT)}>
                  {total === 0 ? 'Nessuna scheda' : `${formatCount(row.consolidate)} di ${formatCount(total)} consolidate · ${percent(row.consolidate, total)}%`}
                </span>
              </span>
              {/* The words under it say the same: the bar is their picture. */}
              {/* No card: no empty bar, the words say it (LC37). Drawn still: no growth on every visit (LC145). */}
              {total > 0 && (
                <span aria-hidden className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  {CARD_STATES.filter((state) => row[state.key] > 0).map((state) => (
                    <span key={state.key} className={cn('min-w-1 basis-0', state.swatch)} style={{ flexGrow: row[state.key] }} />
                  ))}
                </span>
              )}
              {total > 0 && <span className="text-sm tabular-nums text-slate-700 dark:text-slate-200">{stopStates(row)}</span>}
              <span className={cn('text-xs tabular-nums', MUTED_TEXT)}>{reviews(row.ripassi30)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
