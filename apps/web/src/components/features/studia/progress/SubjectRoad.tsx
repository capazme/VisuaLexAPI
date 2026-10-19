import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { Materia, Progressi } from '../../../../types/studia';
import { MATERIA_LABEL } from '../studiaLabels';
import { InstituteStops } from './InstituteStops';
import { totalCards } from './layout';
import { dueBySubject, dueLabel, orderStops, stopStates } from './today';
import { BLOCK_HEADING, CARD_STATES, INK_BG, INK_BORDER, INK_TEXT, MUTED_TEXT, QUIET_BUTTON, SECONDARY_BUTTON, TILE } from './tokens';
import type { PercorsoState } from './usePercorso';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The stagger of the stops' entrance (Gymnasium spec §7): once per mount, nothing after. */
const STAGGER_MS = 40;

export interface SubjectRoadProps {
  materie: Progressi['materie'];
  /** The subject the chips chose: its stop is marked, and opens on its institutes. */
  selected: Materia | undefined;
  /** The read by institute (G5): each subject's «N da ripassare» and its institutes' stops. */
  percorso: PercorsoState;
  onRetryPercorso: () => void;
}

/**
 * The road (Gymnasium spec §5.2): one stop per subject, joined by a line, free — no locks, no order
 * imposed. A stop says where the subject stands (its three states, as a bar and in words, the cards due
 * today, the reviews of the last 30 days), «Ripassa» starts a session narrowed to it, and «Istituti» opens
 * its institutes' stops in place (`InstituteStops`). The cards due come from the read by institute, which
 * answers on its own: while it travels their line holds its place; if it fails the line is left out.
 */
export function SubjectRoad({ materie, selected, percorso, onRetryPercorso }: SubjectRoadProps) {
  const navigate = useNavigate();
  const id = useId();
  const stops = orderStops(materie);
  const due = percorso.data && dueBySubject(percorso.data);
  // The subject the chips chose opens on its institutes; any other opens on request. Never more than asked.
  const [open, setOpen] = useState<ReadonlySet<Materia>>(() => new Set(selected ? [selected] : []));
  const toggle = (materia: Materia) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (!next.delete(materia)) next.add(materia);
      return next;
    });
  return (
    <section aria-labelledby="studia-percorso" className="space-y-3">
      <h3 id="studia-percorso" className={BLOCK_HEADING}>
        Il percorso
      </h3>
      {/* The line that joins the stops, behind their marks: a pseudo-element, so the list holds only its items. */}
      <ol
        aria-labelledby="studia-percorso"
        className="relative space-y-3 before:absolute before:bottom-6 before:left-[15px] before:top-6 before:w-0.5 before:rounded-full before:bg-primary-900/15 dark:before:bg-primary-300/25"
      >
        {stops.map((stop, index) => {
          const total = totalCards(stop);
          const label = MATERIA_LABEL[stop.materia];
          const chosen = selected === stop.materia;
          const started = stop.apprendimento + stop.consolidate > 0;
          const expanded = open.has(stop.materia);
          const panel = `${id}-${stop.materia}`;
          const institutes = percorso.data?.filter((tappa) => tappa.materia === stop.materia).length;
          const dovute = due?.get(stop.materia) ?? 0;
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
                      {due ? (
                        <p className={cn('text-sm tabular-nums', dovute > 0 ? cn('font-semibold', INK_TEXT) : MUTED_TEXT)}>{dueLabel(dovute)}</p>
                      ) : (
                        percorso.status === 'loading' && <span aria-hidden className="h-5 w-28 rounded bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800/60" />
                      )}
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
                    className={SECONDARY_BUTTON}
                  >
                    Ripassa
                  </button>
                )}
                {total > 0 && (
                  <>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={panel}
                      onClick={() => toggle(stop.materia)}
                      className={cn(QUIET_BUTTON, 'inline-flex items-center gap-1 md:col-span-2')}
                    >
                      <ChevronDown size={16} aria-hidden className={cn('shrink-0 transition-transform motion-reduce:transition-none', expanded && 'rotate-180')} />
                      Istituti
                      <span className="sr-only"> di {label}</span>
                      {institutes !== undefined && <span className="tabular-nums"> ({institutes})</span>}
                    </button>
                    {expanded && (
                      <div id={panel} className="md:col-span-2">
                        <InstituteStops materia={stop.materia} percorso={percorso} onRetry={onRetryPercorso} />
                      </div>
                    )}
                  </>
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
export function SubjectRoadSkeleton() {
  return (
    <div aria-hidden className="space-y-3">
      <div className="h-6 w-32 rounded bg-slate-100 dark:bg-slate-800/60" />
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="ml-11 h-40 rounded-2xl bg-slate-100 motion-safe:animate-pulse md:h-[92px] dark:bg-slate-800/60" />
      ))}
    </div>
  );
}

/**
 * The road when the first read failed: its heading and what is missing, not empty blocks. No alert: the missions
 * above say it once, with «Riprova», which reads the road again too.
 */
export function SubjectRoadUnread() {
  return (
    <section aria-labelledby="studia-percorso" className="space-y-3">
      <h3 id="studia-percorso" className={BLOCK_HEADING}>
        Il percorso
      </h3>
      <p className={cn('text-sm', MUTED_TEXT)}>Non riesco a leggere il tuo percorso: le materie tornano appena riesco a leggerle.</p>
    </section>
  );
}
