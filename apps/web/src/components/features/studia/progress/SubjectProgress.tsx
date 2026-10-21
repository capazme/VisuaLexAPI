import { cn } from '../../../../lib/utils';
import type { Materia, Progressi } from '../../../../types/studia';
import { MATERIA_LABEL } from '../studiaLabels';
import { formatCount, percent, totalCards } from './layout';
import { orderStops, stopStates } from './today';
import { CARD_STATES, FOCUS_RING, INK_BORDER, MUTED_TEXT, subjectHue } from './tokens';

export interface SubjectProgressProps {
  materie: Progressi['materie'];
  selected: Materia | undefined;
  /** Sets the subject; the selected one again clears it. */
  onSelect: (materia: Materia | undefined) => void;
}

const reviews = (n: number) => (n === 0 ? 'Nessun ripasso negli ultimi 30 giorni' : `${formatCount(n)} ${n === 1 ? 'ripasso' : 'ripassi'} negli ultimi 30 giorni`);

/**
 * Progress by subject (Studia progress spec §4.3; Gymnasium spec §5.3): always the five subjects, in the order of
 * «Oggi»'s road (`orderStops`: the cards still open first, then by name), each a button that narrows the page to it
 * (pressed again, it clears). A subject shows its share consolidated, its three states as a bar and in words, and the
 * reviews of the last 30 days. No «N da ripassare» here: the progress read does not carry it by subject (the road has
 * it from the read by institute, and it is not counted twice).
 */
export function SubjectProgress({ materie, selected, onSelect }: SubjectProgressProps) {
  return (
    // Two columns from `lg` (G6): the page is the frame's full width.
    <ul className="grid gap-2 lg:grid-cols-2">
      {orderStops(materie).map((row) => {
        const total = totalCards(row);
        const on = selected === row.materia;
        return (
          <li key={row.materia}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(on ? undefined : row.materia)}
              className={cn(
                'grid min-h-[44px] w-full gap-2 rounded-xl text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60',
                FOCUS_RING,
                // The chosen one's border is twice as thick and its padding a pixel less, so nothing moves.
                on ? cn('border-2 bg-slate-50 p-[11px] dark:bg-slate-800/60', INK_BORDER) : 'border border-slate-200 p-3 dark:border-slate-800',
              )}
            >
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-50">
                  <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: subjectHue(row.materia) }} />
                  {MATERIA_LABEL[row.materia]}
                </span>
                <span className={cn('text-xs tabular-nums', MUTED_TEXT)}>
                  {total === 0 ? 'Nessuna scheda' : `${formatCount(row.consolidate)} di ${formatCount(total)} consolidate · ${percent(row.consolidate, total)}%`}
                </span>
              </span>
              {/* The words under it say the same: the bar is their picture. */}
              <span aria-hidden className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                {CARD_STATES.filter((state) => row[state.key] > 0).map((state) => (
                  <span key={state.key} className={cn('min-w-1 basis-0', state.swatch)} style={{ flexGrow: row[state.key] }} />
                ))}
              </span>
              {total > 0 && <span className="text-sm tabular-nums text-slate-700 dark:text-slate-200">{stopStates(row)}</span>}
              <span className={cn('text-xs tabular-nums', MUTED_TEXT)}>{reviews(row.ripassi30)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
