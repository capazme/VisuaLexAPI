import { useNavigate } from 'react-router-dom';
import { HIDDEN_SCROLLBAR } from '../../../../constants/interactions';
import { cn } from '../../../../lib/utils';
import type { Materia, Progressi } from '../../../../types/studia';
import { MATERIA_LABEL } from '../studiaLabels';
import { InstituteStops } from './InstituteStops';
import { formatCount, totalCards } from './layout';
import { dueBySubject, orderStops, stopStates } from './today';
import { BLOCK_HEADING, FOCUS_RING, INK_BORDER, INK_TEXT, MUTED_TEXT, SECONDARY_BUTTON, TILE, subjectHue } from './tokens';
import type { PercorsoState } from './usePercorso';

/** The stagger of the rows' entrance (Gymnasium spec §7): once per mount, nothing after. */
const STAGGER_MS = 40;

export interface SubjectListProps {
  /** The whole day's subjects; null before the first read, or when it could not be read. */
  materie: Progressi['materie'] | null;
  /** The first read is travelling: the list holds its places. */
  loading: boolean;
  /** A new read is travelling with the last answer on screen: the list is dimmed. */
  reloading: boolean;
  selected: Materia | undefined;
  onSelect: (materia: Materia | undefined) => void;
  /** The read by institute (G5): each subject's cards due today and the chosen one's institutes. */
  percorso: PercorsoState;
  onRetryPercorso: () => void;
}

/** A row's choice: 44 px, an ink edge as well as a tint when pressed, so it is not told by colour alone. */
const CHOICE = cn(
  'flex min-h-[44px] w-full min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition-colors',
  FOCUS_RING,
);
const PRESSED = cn('border-2 bg-primary-50 font-semibold text-slate-900 dark:bg-primary-900/30 dark:text-white', INK_BORDER);
const IDLE = 'border-slate-200 text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800';

/**
 * One scrolling row of cards on a phone (G8: not three lines of chips), its bar not drawn; from `md` a list, one row a
 * subject.
 */
// Padded by the focus ring's 4 px all round, and the same taken back by the margins, so the scroller never cuts it.
const LIST = cn('-m-1 flex snap-x gap-2 overflow-x-auto p-1 md:m-0 md:grid md:gap-1.5 md:overflow-visible md:p-0', HIDDEN_SCROLLBAR);
const ITEM = 'w-60 shrink-0 snap-start md:w-auto';

/**
 * «Le tue materie» (G8), in «Oggi»'s right column under the statistics, in the place of «Cosa ripassi» (the chips) and
 * «Il percorso» (the road), which said almost the same thing twice: the subject filter and the road in one list. On top
 * «Tutte le materie», then one row a subject in the road's order (`orderStops`) — its hue's dot, its name, «3 oggi»
 * (the cards due today, from the read by institute), a small bar of its consolidated share, and «Ripassa», a session
 * narrowed to it. A row pressed narrows the day block and its session, as the chips did, remembered for the area; the
 * chosen subject's institutes follow the list (`InstituteStops`, G5), each a session narrowed to it. The cards due
 * come from the read by institute, which answers on its own: while it travels their place is held, and a failed read
 * leaves them out.
 */
export function SubjectList({ materie, loading, reloading, selected, onSelect, percorso, onRetryPercorso }: SubjectListProps) {
  const navigate = useNavigate();
  const due = percorso.data && dueBySubject(percorso.data);

  if (!materie) {
    return (
      <section aria-labelledby="studia-materie" aria-busy={loading} className="space-y-3">
        <h2 id="studia-materie" className={BLOCK_HEADING}>
          Le tue materie
        </h2>
        {loading ? (
          <div aria-hidden className={LIST}>
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className={cn(ITEM, 'h-[92px] rounded-xl bg-slate-100 motion-safe:animate-pulse md:h-11 dark:bg-slate-800/60')} />
            ))}
          </div>
        ) : (
          // No alert: the day block says it once, with «Riprova», which reads the subjects again too.
          <p className={cn('max-w-prose text-sm', MUTED_TEXT)}>Non riesco a leggere le tue materie: tornano appena riesco a leggerle.</p>
        )}
      </section>
    );
  }

  const stops = orderStops(materie);
  const chosen = selected ? stops.find((stop) => stop.materia === selected) : undefined;
  return (
    <section aria-labelledby="studia-materie" className={cn('space-y-3 transition-opacity', reloading && 'opacity-60')} aria-busy={reloading}>
      <h2 id="studia-materie" className={BLOCK_HEADING}>
        Le tue materie
      </h2>
      <div role="group" aria-label="Materia">
        <ul className={LIST}>
          <li className={cn(ITEM, 'w-auto')}>
            <button type="button" aria-pressed={selected === undefined} onClick={() => onSelect(undefined)} className={cn(CHOICE, 'h-full whitespace-nowrap', selected === undefined ? PRESSED : IDLE)}>
              Tutte le materie
            </button>
          </li>
          {stops.map((stop, index) => {
            const label = MATERIA_LABEL[stop.materia];
            const total = totalCards(stop);
            const on = selected === stop.materia;
            const dovute = due?.get(stop.materia) ?? 0;
            const consolidated = total > 0 ? stop.consolidate / total : 0;
            return (
              <li
                key={stop.materia}
                // `backwards` fill (the utility's): each row waits unseen for its turn, then rests where it is.
                // From `md` a row: the choice takes what «Ripassa» leaves, all of it for a subject with no card, so every row
                // ends where «Tutte le materie» does (a grid's empty column kept its 8 px gap).
                className={cn(ITEM, 'grid gap-1.5 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 md:flex md:items-center md:gap-2')}
                style={{ animationDelay: `${(index + 1) * STAGGER_MS}ms` }}
              >
                <button type="button" aria-pressed={on} onClick={() => onSelect(stop.materia)} className={cn(CHOICE, on ? PRESSED : IDLE, 'flex-wrap md:min-w-0 md:flex-1 md:flex-nowrap')}>
                  <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: subjectHue(stop.materia) }} />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {total === 0 ? (
                    <span className={cn('shrink-0 text-xs font-normal', MUTED_TEXT)}>Nessuna scheda</span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-2.5">
                      {due ? (
                        <span className={cn('text-sm tabular-nums', dovute > 0 ? cn('font-semibold', INK_TEXT) : cn('font-normal', MUTED_TEXT))}>
                          <span aria-hidden>{`${formatCount(dovute)} oggi`}</span>
                          <span className="sr-only">{`, ${formatCount(dovute)} da ripassare oggi`}</span>
                        </span>
                      ) : (
                        percorso.status === 'loading' && <span aria-hidden className="h-4 w-12 rounded bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800/60" />
                      )}
                      {/* Its consolidated share: the words are the screen reader's, the bar the eye's. */}
                      <span aria-hidden className="block h-1.5 w-12 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <span className="block h-full rounded-full bg-emerald-600 dark:bg-emerald-500" style={{ width: `${consolidated * 100}%` }} />
                      </span>
                      <span className="sr-only">{`: ${stopStates(stop)}`}</span>
                    </span>
                  )}
                </button>
                {total > 0 && (
                  <button
                    type="button"
                    aria-label={`Ripassa ${label}`}
                    onClick={() => navigate(`/studia/ripasso/sessione?materia=${stop.materia}`)}
                    className={cn(SECONDARY_BUTTON, 'shrink-0 px-3')}
                  >
                    Ripassa
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {chosen && totalCards(chosen) > 0 && (
        <section aria-labelledby="studia-istituti" className={cn(TILE, 'space-y-2 p-3')}>
          <h3 id="studia-istituti" className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {`Gli istituti di ${MATERIA_LABEL[chosen.materia]}`}
          </h3>
          <InstituteStops materia={chosen.materia} percorso={percorso} onRetry={onRetryPercorso} />
        </section>
      )}
    </section>
  );
}
