import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { Materia } from '../../../../types/studia';
import { MATERIA_LABEL } from '../studiaLabels';
import { dueLabel, instituteSessionPath, orderInstitutes, stopStates } from './today';
import { CARD_STATES, FOCUS_RING, INK_BG, INK_BORDER, INK_TEXT, MUTED_TEXT, QUIET_BUTTON } from './tokens';
import type { PercorsoState } from './usePercorso';

/** The stagger of the stops' entrance (Gymnasium spec §7), as the subjects': once per mount. */
const STAGGER_MS = 40;
/** The institutes shown before «Mostra tutti»: a subject may hold hundreds. */
export const INSTITUTES_SHOWN = 8;

export interface InstituteStopsProps {
  materia: Materia;
  percorso: PercorsoState;
  onRetry: () => void;
}

/**
 * The institutes of a subject on the road (Gymnasium spec §5.2, G5): one stop each, joined by a thinner line,
 * free — no locks. A stop names its institute as the card does (the label is the content's, never rewritten:
 * root rule 23), says «N da ripassare», and its three states as a bar and in words; a tap starts the session
 * narrowed to that institute. Ordered by the cards due, then by name. The read is the road's own (`usePercorso`),
 * so a failure here leaves the subject's «Ripassa» and the missions' «Inizia» as they are.
 */
export function InstituteStops({ materia, percorso, onRetry }: InstituteStopsProps) {
  const navigate = useNavigate();
  const id = useId();
  const [all, setAll] = useState(false);
  const label = MATERIA_LABEL[materia];

  if (percorso.data === null) {
    if (percorso.status === 'error') {
      return (
        <div className="grid gap-1">
          <p className={cn('text-sm', MUTED_TEXT)}>Non riesco a leggere gli istituti di questa materia.</p>
          <button type="button" onClick={onRetry} className={QUIET_BUTTON}>
            Riprova
          </button>
        </div>
      );
    }
    return (
      <div className="grid gap-2">
        <p className="sr-only">Carico gli istituti…</p>
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} aria-hidden className="ml-6 h-[76px] rounded-xl bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800/60" />
        ))}
      </div>
    );
  }

  const stops = orderInstitutes(percorso.data, materia);
  if (stops.length === 0) {
    return <p className={cn('text-sm', MUTED_TEXT)}>Nessun istituto da mostrare in questa materia, per ora.</p>;
  }
  const shown = all ? stops : stops.slice(0, INSTITUTES_SHOWN);

  return (
    <div className={cn('grid gap-1 transition-opacity', percorso.status === 'loading' && 'opacity-60')} aria-busy={percorso.status === 'loading'}>
      {percorso.status === 'error' && (
        <div className="grid gap-1">
          <p className={cn('text-sm', MUTED_TEXT)}>Non riesco ad aggiornare gli istituti: restano quelli letti prima.</p>
          <button type="button" onClick={onRetry} className={QUIET_BUTTON}>
            Riprova
          </button>
        </div>
      )}
      <ol
        aria-label={`Istituti di ${label}`}
        className={cn(
          'relative grid gap-1',
          // The line that joins the stops, as the subjects' but thinner; a single stop has nothing to join.
          stops.length > 1 && 'before:absolute before:bottom-5 before:left-[7px] before:top-5 before:w-px before:bg-primary-900/15 dark:before:bg-primary-300/25',
        )}
      >
        {shown.map((stop, index) => {
          const total = stop.nuove + stop.apprendimento + stop.consolidate;
          const started = stop.apprendimento + stop.consolidate > 0;
          const states = `${id}-${index}`;
          // Only the first screenful enters, so a long subject neither waits seconds for its last stop nor replays on «Mostra tutti».
          const enters = index < INSTITUTES_SHOWN;
          return (
            <li
              key={stop.istituto}
              className={cn('relative grid grid-cols-[16px_minmax(0,1fr)] gap-2', enters && 'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2')}
              style={enters ? { animationDelay: `${index * STAGGER_MS}ms` } : undefined}
            >
              <span
                aria-hidden
                className={cn('relative mt-4 h-2.5 w-2.5 justify-self-center rounded-full border-2 bg-white dark:bg-slate-900', INK_BORDER, started && INK_BG)}
              />
              <button
                type="button"
                aria-label={`Ripassa ${stop.istituto}: ${dueLabel(stop.dovute).toLowerCase()}`}
                aria-describedby={states}
                onClick={() => navigate(instituteSessionPath(materia, stop.istituto))}
                className={cn(
                  'grid min-h-[44px] w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 rounded-xl px-2 py-2 text-left transition-[background-color,scale] hover:bg-primary-50 active:scale-[0.99] dark:hover:bg-primary-900/30',
                  FOCUS_RING,
                )}
              >
                <span className="min-w-0 text-sm font-medium text-slate-900 [overflow-wrap:anywhere] dark:text-slate-50">{stop.istituto}</span>
                <ChevronRight size={16} aria-hidden className={cn('mt-0.5 shrink-0', MUTED_TEXT)} />
                {total > 0 && (
                  <span aria-hidden className="col-span-2 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    {CARD_STATES.filter((state) => stop[state.key] > 0).map((state) => (
                      <span key={state.key} className={cn('min-w-1 basis-0', state.swatch)} style={{ flexGrow: stop[state.key] }} />
                    ))}
                  </span>
                )}
                {/* The name keeps the whole width (390 px): the cards due and the states go under the bar, wrapping. */}
                <span className="col-span-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 tabular-nums">
                  <span className={cn('text-sm', stop.dovute > 0 ? cn('font-semibold', INK_TEXT) : MUTED_TEXT)}>
                    {dueLabel(stop.dovute)}
                  </span>
                  <span id={states} className={cn('text-xs', MUTED_TEXT)}>
                    {stopStates(stop)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {stops.length > INSTITUTES_SHOWN && (
        <button type="button" aria-expanded={all} onClick={() => setAll((open) => !open)} className={cn(QUIET_BUTTON, 'ml-6')}>
          {all ? `Mostra solo i primi ${INSTITUTES_SHOWN}` : `Mostra tutti gli istituti (${stops.length})`}
        </button>
      )}
    </div>
  );
}
