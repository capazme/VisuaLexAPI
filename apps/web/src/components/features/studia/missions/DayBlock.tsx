import { useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { fadeInEntries } from '../../../../features/sections/useEntriesEntrance';
import { prefersReducedMotion } from '../../../../features/sections/sectionTransition';
import { cn } from '../../../../lib/utils';
import type { Materia, Progressi, TappaIstituto } from '../../../../types/studia';
import { estimateLabel } from '../studiaLabels';
import { formatDayLong } from '../progress/layout';
import { nextDayLine, subjectsPhrase, todaySentence, todayState, todaySubjects } from '../progress/today';
import { FOCUS_RING, INK_BG, INK_TEXT, MUTED_TEXT, ON_INK, SECONDARY_BUTTON, TILE } from '../progress/tokens';

export interface DayBlockProps {
  /** The whole day's answer: the date, the goal met, whether there is any card at all. */
  day: Progressi | null;
  /** The day's last read failed (the first, or one after it). */
  dayFailed: boolean;
  /** The answer behind the action: the chosen subject's, else the day's. */
  action: Progressi | null;
  /** That read failed: the block says so with «Riprova» and keeps «Inizia il ripasso». */
  actionFailed: boolean;
  /** The road's read by institute (G5): which subjects today's cards come from. Null until it answers. */
  stops: readonly TappaIstituto[] | null;
  onRetry: () => void;
  /** The subject the action is narrowed to. */
  materia?: Materia;
  subject?: string;
  /** Back to every subject, offered when the one chosen has nothing left today. */
  onAllSubjects: () => void;
  /** «Inizia il ripasso»: usable when the progress cannot be read (the session reads its own cards). */
  onStart: () => void;
  /** Opens the study settings in «I tuoi progressi», at the community's subjects when asked. */
  onOpenSettings: (target?: 'comunita') => void;
  /** The id of the settings' panel, which the block's settings buttons control. */
  settingsPanel?: string;
}

/** The page's one primary button (G8): wide, 48 px, full width on a phone; a key that presses into its ink edge. */
const PRIMARY = cn(
  'min-h-12 w-full rounded-xl px-10 text-base font-semibold md:w-auto md:min-w-64',
  'shadow-[0_4px_0_var(--color-primary-950)] transition-[translate,box-shadow] active:translate-y-[3px] active:shadow-[0_1px_0_var(--color-primary-950)] motion-reduce:transition-none',
  'dark:shadow-[0_4px_0_var(--color-primary-500)] dark:active:shadow-[0_1px_0_var(--color-primary-500)]',
  INK_BG,
  ON_INK,
  FOCUS_RING,
);

/** The block's large line: Newsreader, 30 px on a phone and 36 px from `md`. */
const LARGE = cn('max-w-prose font-serif text-3xl font-medium leading-tight tracking-tight md:text-4xl', INK_TEXT);

const RETRY = cn('min-h-[44px] rounded px-1 font-sans text-base font-medium underline', FOCUS_RING);

/** The small line on top: «Oggi · mercoledì 22 ottobre», the server's day; «Oggi in Diritto penale · …» narrowed. */
function DayLine({ day, subject }: { day: Progressi | null; subject?: string }) {
  const scope = subject ? `Oggi in ${subject}` : 'Oggi';
  return <p className={cn('text-sm font-medium', MUTED_TEXT)}>{day ? `${scope} · ${formatDayLong(day.oggi.giorno)}` : scope}</p>;
}

/**
 * The day block (G8), first on «Oggi» and on a phone the first thing under the bar: the day, what is on today in
 * large type, what it costs and where it comes from, and «Inizia il ripasso», the page's one primary button.
 * With nothing left, «Hai finito per oggi.» and the next day; narrowed to a subject, that subject's; with no card at
 * all, how to begin; a failed read says so and keeps the start. It enters with the sidebar's light cascade
 * (`fadeInEntries`, opacity only) once its content is first drawn, never under reduced motion.
 */
export function DayBlock({ day, dayFailed, action, actionFailed, stops, onRetry, materia, subject, onAllSubjects, onStart, onOpenSettings, settingsPanel }: DayBlockProps) {
  const filtered = subject !== undefined;
  const whole = todayState(day, dayFailed, false);
  const state = whole === 'empty' ? 'empty' : todayState(action, actionFailed || dayFailed, filtered);
  const met = day?.oggi.raggiunto ?? false;

  // The cascade, once, when the block first draws what it says (not while its places are held).
  const block = useRef<HTMLElement>(null);
  const entered = useRef(false);
  const drawn = state !== 'loading';
  useLayoutEffect(() => {
    if (!drawn || entered.current) return;
    entered.current = true;
    if (block.current && !prefersReducedMotion()) fadeInEntries(block.current);
  }, [drawn]);

  const cards = action ? action.oggi.dovute + action.oggi.nuove : 0;
  // Narrowed, the line on top names the subject; else the subjects today's cards come from.
  const from = !materia && action ? todaySubjects(action.materie, stops, action.oggi.nuove) : null;
  const detail = state === 'todo' ? [estimateLabel(cards), from && subjectsPhrase(from)].filter(Boolean).join(' · ') : '';

  return (
    <section
      ref={block}
      aria-labelledby="studia-giorno"
      aria-busy={state === 'loading'}
      // A tile with the section's hue as a rule down its left edge: the page's entry.
      className={cn(TILE, 'grid justify-items-stretch gap-3 border-l-4 border-l-[color:var(--vlx-section-gymnasium)] dark:border-l-[color:var(--vlx-section-gymnasium)] p-5 md:justify-items-start md:p-7')}
    >
      <h2 id="studia-giorno" className="sr-only">
        Il ripasso di oggi
      </h2>
      <DayLine day={day} subject={subject} />

      {state === 'loading' && (
        // The final size, so nothing jumps when the read answers.
        <>
          <p className="sr-only">Carico i tuoi progressi…</p>
          <div aria-hidden className="h-9 w-3/4 rounded-md bg-slate-100 motion-safe:animate-pulse md:h-11 dark:bg-slate-800" />
          <div aria-hidden className="h-5 w-56 max-w-full rounded bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" />
          <div aria-hidden className="mt-1 h-12 w-full rounded-xl bg-slate-100 motion-safe:animate-pulse md:w-64 dark:bg-slate-800" />
        </>
      )}

      {state === 'unread' && (
        <>
          <p role="alert" className={LARGE}>
            Non riesco a leggere i tuoi progressi.{' '}
            <button type="button" onClick={onRetry} className={RETRY}>
              Riprova
            </button>
          </p>
          <p className={cn('max-w-prose text-sm', MUTED_TEXT)}>Puoi ripassare lo stesso: il ripasso legge le sue schede.</p>
          <button type="button" onClick={onStart} className={cn(PRIMARY, 'mt-1')}>
            Inizia il ripasso
          </button>
        </>
      )}

      {state === 'empty' && (
        <>
          <p className={LARGE}>Non hai ancora schede da ripassare.</p>
          <p className="max-w-prose text-sm text-slate-700 dark:text-slate-200">
            Per cominciare, apri un articolo dalla{' '}
            <Link to="/" className={cn('font-medium underline', FOCUS_RING)}>
              Ricerca
            </Link>{' '}
            e scegli «+ Nuova scheda» sotto il testo, oppure accendi le schede della comunità: le missioni partono dalla prima scheda.
          </p>
          <button type="button" aria-controls={settingsPanel} onClick={() => onOpenSettings('comunita')} className={cn(PRIMARY, 'mt-1')}>
            Accendi le schede della comunità
          </button>
        </>
      )}

      {(state === 'todo' || state === 'done') && action && (
        <>
          <p className={LARGE} aria-live="polite">
            {state === 'todo' ? todaySentence(action) : filtered ? 'Niente da ripassare in questa materia, per oggi.' : 'Hai finito per oggi.'}
          </p>
          {state === 'todo' && detail && <p className={cn('max-w-prose text-sm', MUTED_TEXT)}>{detail}</p>}
          {state === 'done' && !filtered && <p className={cn('max-w-prose text-base', MUTED_TEXT)}>{nextDayLine(action)}</p>}

          {/* A read after the first failed: what is on screen is the last answer. */}
          {(actionFailed || dayFailed) && (
            <p role="alert" className="max-w-prose text-sm text-red-700 dark:text-red-400">
              Non riesco a leggere i tuoi progressi.{' '}
              <button type="button" onClick={onRetry} className={cn(RETRY, 'text-sm')}>
                Riprova
              </button>
            </p>
          )}

          {state === 'todo' && (
            <button type="button" onClick={onStart} className={cn(PRIMARY, 'mt-1')}>
              {met ? 'Continua il ripasso' : 'Inizia il ripasso'}
            </button>
          )}
          {state === 'done' && filtered && (
            <button type="button" onClick={onAllSubjects} className={cn(SECONDARY_BUTTON, 'mt-1 w-full px-6 md:w-auto')}>
              Ripassa tutte le materie
            </button>
          )}
          {/* Done for the day with new cards still waiting: more of them is a setting, the new cards a day. */}
          {state === 'done' && !filtered && action.stati.nuove > 0 && (
            <button type="button" aria-controls={settingsPanel} onClick={() => onOpenSettings()} className={cn(SECONDARY_BUTTON, 'mt-1 w-full px-6 md:w-auto')}>
              Impara altre schede nuove
            </button>
          )}
        </>
      )}
    </section>
  );
}
