import { useNavigate } from 'react-router-dom';
import { cn } from '../../../../lib/utils';
import type { Materia, Progressi } from '../../../../types/studia';
import { MATERIA_LABEL } from '../studiaLabels';
import { totalCards } from './layout';
import { orderStops, stopStates } from './today';
import { CARD_STATES, FOCUS_RING, INK_BG, INK_BORDER, MUTED_TEXT, PANEL_HEADING, TILE } from './tokens';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The stagger of the stops' entrance (Gymnasium spec §7): once per mount, nothing after. */
const STAGGER_MS = 40;

export interface SubjectRoadProps {
  materie: Progressi['materie'];
  /** The subject the chips chose: its stop is marked. */
  selected: Materia | undefined;
}

/**
 * The road (Gymnasium spec §5.2): one stop per subject, joined by a line, free — no locks, no order
 * imposed. A stop says where the subject stands (its three states, as a bar and in words, and the
 * reviews of the last 30 days) and «Ripassa» starts a session narrowed to it.
 */
export function SubjectRoad({ materie, selected }: SubjectRoadProps) {
  const navigate = useNavigate();
  const stops = orderStops(materie);
  return (
    <section aria-labelledby="studia-percorso" className="space-y-3">
      <h3 id="studia-percorso" className={PANEL_HEADING}>
        Il percorso
      </h3>
      <ol aria-labelledby="studia-percorso" className="relative space-y-3">
        {/* The line that joins the stops, behind their marks. */}
        <span aria-hidden className="absolute bottom-6 left-[15px] top-6 w-0.5 rounded-full bg-primary-900/15 dark:bg-primary-300/25" />
        {stops.map((stop, index) => {
          const total = totalCards(stop);
          const label = MATERIA_LABEL[stop.materia];
          const chosen = selected === stop.materia;
          const started = stop.apprendimento + stop.consolidate > 0;
          return (
            <li
              key={stop.materia}
              // `backwards` fill (the utility's): each stop waits unseen for its turn, then rests where it is.
              className="relative grid grid-cols-[32px_minmax(0,1fr)] gap-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2"
              style={{ animationDelay: `${index * STAGGER_MS}ms` }}
            >
              {/* The stop's mark on the line: filled once the subject is started. No number: no order is imposed. */}
              <span
                aria-hidden
                className={cn('relative mt-5 h-4 w-4 justify-self-center rounded-full border-2 bg-white dark:bg-slate-900', INK_BORDER, started && INK_BG)}
              />
              <div className={cn(TILE, 'grid gap-2 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-x-4', chosen && cn('border-2', INK_BORDER))}>
                <div className="grid min-w-0 gap-1.5">
                  <p className="text-base font-semibold text-slate-900 dark:text-slate-50">
                    {label}
                    {chosen && <span className={cn('ml-2 text-xs font-normal', MUTED_TEXT)}>materia scelta</span>}
                  </p>
                  {total === 0 ? (
                    <p className={cn('text-sm', MUTED_TEXT)}>Nessuna scheda, per ora.</p>
                  ) : (
                    <>
                      <span aria-hidden className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        {CARD_STATES.filter((state) => stop[state.key] > 0).map((state) => (
                          <span key={state.key} className={cn('min-w-1 basis-0', state.swatch)} style={{ flexGrow: stop[state.key] }} />
                        ))}
                      </span>
                      <p className="text-sm tabular-nums text-slate-700 dark:text-slate-200">{stopStates(stop)}</p>
                    </>
                  )}
                  <p className={cn('text-xs tabular-nums', MUTED_TEXT)}>
                    {stop.ripassi30 === 0 ? 'Nessun ripasso negli ultimi 30 giorni' : `${count(stop.ripassi30, 'ripasso', 'ripassi')} negli ultimi 30 giorni`}
                  </p>
                </div>
                {total > 0 && (
                  <button
                    type="button"
                    aria-label={`Ripassa ${label}`}
                    onClick={() => navigate(`/studia/ripasso/sessione?materia=${stop.materia}`)}
                    className={cn(
                      'min-h-[44px] rounded-xl border px-4 text-sm font-semibold transition-[background-color,scale] active:scale-[0.97]',
                      INK_BORDER,
                      'text-primary-900 hover:bg-primary-50 dark:text-primary-200 dark:hover:bg-primary-900/30',
                      FOCUS_RING,
                    )}
                  >
                    Ripassa
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The road's place at its final size while the first read travels. */
export function SubjectRoadSkeleton({ pulsing }: { pulsing: boolean }) {
  return (
    <div aria-hidden className="space-y-3">
      <div className="h-6 w-32 rounded bg-slate-100 dark:bg-slate-800/60" />
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className={cn('ml-11 h-[104px] rounded-2xl bg-slate-100 md:h-[92px] dark:bg-slate-800/60', pulsing && 'motion-safe:animate-pulse')} />
      ))}
    </div>
  );
}
