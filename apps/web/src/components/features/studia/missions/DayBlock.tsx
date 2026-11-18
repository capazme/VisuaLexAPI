import { useRef, type RefObject } from 'react';
import { Button } from '../../../ui/Button';
import { Link } from 'react-router-dom';
import { cn } from '../../../../lib/utils';
import type { Materia, Progressi, TappaIstituto } from '../../../../types/studia';
import { estimateLabel } from '../studiaLabels';
import { formatDayLong } from '../progress/layout';
import { goalMissionDone } from './missions';
import { nextDayLine, subjectsPhrase, todaySentence, todayState, todaySubjects } from '../progress/today';
import { FOCUS_RING, INK_TEXT, MUTED_TEXT, TILE } from '../progress/tokens';
import { Illustration, type IllustrationName } from '../../../ui/Illustration';

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
  /** The goal's mark is written now, once (the celebration; the caller decides); otherwise drawn whole. */
  drawGoal?: boolean;
  /** The goal's mark and its words: where the celebration's confetti start. */
  goalRef?: RefObject<HTMLDivElement | null>;
}

/** The page's one primary button (G8): the common `Button`, wide, full width on a phone (LC112: no key of its own). */
const PRIMARY = 'mt-1 w-full px-10 md:w-auto md:min-w-64';

/** The block's large line: EB Garamond, 30 px on a phone and 36 px from `md`. */
const LARGE = cn('max-w-prose font-serif text-3xl font-medium leading-tight tracking-tight md:text-4xl', INK_TEXT);

/**
 * The small line on top: the server's day, «giovedì 22 ottobre» — the page's title says «Oggi» already (G8) —; narrowed
 * to a subject, «giovedì 22 ottobre · Diritto penale». Nothing before the first read.
 */
function DayLine({ day, subject }: { day: Progressi | null; subject?: string }) {
  if (!day) return null;
  const date = formatDayLong(day.oggi.giorno);
  return <p className={cn('text-sm font-medium', MUTED_TEXT)}>{subject ? `${date} · ${subject}` : date}</p>;
}

/**
 * The day block (G8), first on «Oggi» and on a phone the first thing under the bar: the day, what is on today in
 * large type, what it costs and where it comes from, and «Inizia il ripasso», the page's one primary button.
 * With nothing left, «Hai finito per oggi.» and the next day; narrowed to a subject, that subject's; with no card at
 * all, how to begin; a failed read says so and keeps the start. It enters with the sidebar's light cascade
 * (`fadeInEntries`, opacity only) once its content is first drawn, never under reduced motion.
 */
export function DayBlock({
  day, dayFailed, action, actionFailed, stops, onRetry, materia, subject, onAllSubjects, onStart, onOpenSettings, settingsPanel,
  drawGoal = false, goalRef,
}: DayBlockProps) {
  const filtered = subject !== undefined;
  const whole = todayState(day, dayFailed, false);
  const state = whole === 'empty' ? 'empty' : todayState(action, actionFailed || dayFailed, filtered);
  const met = day?.oggi.raggiunto ?? false;
  // «Obiettivo raggiunto» only when the goal's mission is done (G9), whatever the streak counts: the whole day's, so a
  // subject chosen (its read travelling, or nothing left in it) neither hides nor redraws it.
  const goal = day && (whole === 'todo' || whole === 'done') && goalMissionDone(day) ? day : null;

  // The cascade, once, when the block first draws what it says (not while its places are held).
  const block = useRef<HTMLElement>(null);

  const cards = action ? action.oggi.dovute + action.oggi.nuove : 0;
  // Narrowed, the line on top names the subject; else the subjects today's cards come from.
  const from = !materia && action ? todaySubjects(action.materie, stops, action.oggi.nuove) : null;
  const detail = state === 'todo' ? [estimateLabel(cards), from && subjectsPhrase(from)].filter(Boolean).join(' · ') : '';

  const art: IllustrationName | null = state === 'todo' ? 'learn-ripasso' : state === 'done' ? 'learn-giorno-chiuso' : state === 'empty' ? 'learn-schede-vuote' : null;
  return (
    <section
      ref={block}
      aria-labelledby="studia-giorno"
      aria-busy={state === 'loading'}
      // The page's entry: its weight is the title's size, not a coloured edge. With the goal's mark, its right side
      // kept for it from `md`.
      className={cn(
        TILE,
        'relative grid justify-items-stretch gap-3 p-5 md:justify-items-start md:p-7',
        goal ? 'pr-32 md:pr-52' : art && (state === 'done' ? 'pr-32 md:pr-52' : 'md:pr-44'),
      )}
    >
      {/* LC35: an engraving at the block's right from md, what the day holds: the open book and its cards, the empty
          drawer. The day done has its own, with the goal's words (below). */}
      {!goal && art && <Illustration name={art} className={cn('absolute right-4 top-4 md:right-7 md:top-1/2 md:-translate-y-1/2', art === 'learn-giorno-chiuso' ? 'aspect-[480/284] top-auto bottom-5 w-24 md:bottom-7 md:top-auto md:w-40 md:translate-y-0' : 'h-16 w-16 md:h-32 md:w-32')} />}
      <h2 id="studia-giorno" className="sr-only">
        Il ripasso di oggi
      </h2>
      {goal && (
        // The day closed (LC39; the anti-slop review: one object, inside the card): the lamp just put out, resting at
        // the card's foot on its right, 96 px on a phone and 160 from `md`; the smoke rises from its wick (`goalRef`).
        // The streak is said in «I tuoi progressi», not here: no line of its own.
        <div ref={goalRef} data-testid="goal-plate" className={cn('absolute bottom-5 right-5 w-24 md:bottom-7 md:right-7 md:w-40', drawGoal && 'vlx-plate-in')}>
          <Illustration name="learn-giorno-chiuso" label="Obiettivo raggiunto" className="aspect-[480/284] w-full" />
        </div>
      )}
      <DayLine day={day} subject={subject} />
      {/* The date's place while the day's read travels — also when a subject's read answers first: on a phone two lines
          with a subject («mercoledì 21 ottobre · Diritto processuale penale»), one without (P1). */}
      {!day && !dayFailed && <div aria-hidden className={cn('h-5 w-40 rounded bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800', subject && 'max-md:h-10')} />}

      {state === 'loading' && (
        // The final size, so nothing jumps when the read answers (P1: on a phone the block grew 91 px, CLS 0.63): the large
        // line on two lines under 390 px, where «23 da ripassare, 15 nuove» wraps, one from there; the cost and the
        // subjects on two below `md`.
        <>
          <p className="sr-only">Carico i tuoi progressi…</p>
          <div aria-hidden className="h-[75px] w-3/4 rounded-md bg-slate-100 motion-safe:animate-pulse min-[390px]:h-[38px] md:h-11 dark:bg-slate-800" />
          <div aria-hidden className="h-10 w-56 max-w-full rounded bg-slate-100 motion-safe:animate-pulse md:h-5 dark:bg-slate-800" />
          <div aria-hidden className="mt-1 h-11 w-full rounded-md bg-slate-100 motion-safe:animate-pulse md:w-64 dark:bg-slate-800" />
        </>
      )}

      {state === 'unread' && (
        <>
          <p role="alert" className={LARGE}>
            Non riesco a leggere i tuoi progressi.{' '}
            <Button type="button" variant="link" onClick={onRetry} className="text-base">
              Riprova
            </Button>
          </p>
          <p className={cn('max-w-prose text-sm', MUTED_TEXT)}>Puoi ripassare lo stesso: il ripasso legge le sue schede.</p>
          <Button type="button" size="lg" onClick={onStart} className={PRIMARY}>
            Inizia il ripasso
          </Button>
        </>
      )}

      {state === 'empty' && (
        <>
          <p className={LARGE}>Non hai ancora schede da ripassare.</p>
          <p className="max-w-prose text-sm text-slate-700 dark:text-slate-200">
            Per cominciare, apri un articolo dalla{' '}
            {/* 44 px to a finger by its padding, taken back by its margins so no line moves (G8b). */}
            <Link to="/" className={cn('-my-3 inline-block py-3 font-medium underline', FOCUS_RING)}>
              Ricerca
            </Link>{' '}
            e scegli «+ Nuova scheda» sotto il testo, oppure accendi le schede della comunità: le missioni partono dalla prima scheda.
          </p>
          <Button type="button" size="lg" aria-controls={settingsPanel} onClick={() => onOpenSettings('comunita')} className={PRIMARY}>
            Accendi le schede della comunità
          </Button>
        </>
      )}

      {(state === 'todo' || state === 'done') && action && (
        <>
          <p className={LARGE} aria-live="polite">
            {state === 'todo' ? todaySentence(action) : filtered ? 'Niente da ripassare in questa materia, per oggi.' : 'Hai finito per oggi.'}
          </p>
          {/* While the subjects' read travels, on a phone the line keeps the two lines it takes once they come (P1). */}
          {state === 'todo' && detail && <p className={cn('max-w-prose text-sm', MUTED_TEXT, stops === null && !materia && 'max-md:min-h-10')}>{detail}</p>}
          {state === 'done' && !filtered && <p className={cn('max-w-prose text-base', MUTED_TEXT)}>{nextDayLine(action)}</p>}

          {/* A read after the first failed: what is on screen is the last answer. */}
          {(actionFailed || dayFailed) && (
            <p role="alert" className="max-w-prose text-sm text-red-700 dark:text-red-400">
              Non riesco a leggere i tuoi progressi.{' '}
              <Button type="button" variant="link" onClick={onRetry}>
                Riprova
              </Button>
            </p>
          )}

          {state === 'todo' && (
            <Button type="button" size="lg" onClick={onStart} className={PRIMARY}>
              {met ? 'Continua il ripasso' : 'Inizia il ripasso'}
            </Button>
          )}
          {state === 'done' && filtered && (
            <Button type="button" variant="secondary" onClick={onAllSubjects} className="mt-1 w-full px-6 md:w-auto">
              Ripassa tutte le materie
            </Button>
          )}
          {/* Done for the day with new cards still waiting: more of them is a setting, the new cards a day. */}
          {state === 'done' && !filtered && action.stati.nuove > 0 && (
            <Button type="button" variant="secondary" aria-controls={settingsPanel} onClick={() => onOpenSettings()} className="mt-1 w-full px-6 md:w-auto">
              Impara altre schede nuove
            </Button>
          )}
        </>
      )}
    </section>
  );
}
