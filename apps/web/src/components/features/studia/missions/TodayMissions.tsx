import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { cn } from '../../../../lib/utils';
import type { Progressi } from '../../../../types/studia';
import { estimateLabel } from '../studiaLabels';
import { GoalStamp } from '../progress/Celebration';
import { nextDueDay, todayState } from '../progress/today';
import { BLOCK_HEADING, FOCUS_RING, INK_BG, INK_TEXT, MUTED_TEXT, ON_INK, QUIET_BUTTON, SECONDARY_BUTTON, TILE } from '../progress/tokens';
import { MISSION_INK_MS, MissionRow } from './MissionMark';
import { missionOrder, missionSummary, todayMissions, type Mission } from './missions';
import { useFreshMissions } from '../progress/seenProgress';

export interface TodayMissionsProps {
  /** The whole day's answer: the missions are the day's. Null before the first one, or when it could not be read. */
  day: Progressi | null;
  /** The day's last read failed (the first, or one after it). */
  dayFailed: boolean;
  /** The answer behind the first mission's action: the chosen subject's, else the day's. */
  action: Progressi | null;
  /** That read failed: the action says so with «Riprova» and keeps «Inizia». */
  actionFailed: boolean;
  onRetry: () => void;
  /** The subject the action is narrowed to, by name. */
  subject?: string;
  /** Back to every subject, offered when the one chosen has nothing left today. */
  onAllSubjects: () => void;
  /** «Inizia» and «Continua»: they stay usable when the progress cannot be read (the session reads its own cards). */
  onStart: () => void;
  /** The study settings, which set the targets of the new cards and of the goal. */
  onOpenSettings: () => void;
  /** The stamp is pressed in now (the celebration, once a day; the caller decides). */
  celebrate: boolean;
  /** Where the celebration's confetti start: the stamp, in the goal's row, so they start where the eye is. */
  stampRef?: RefObject<HTMLDivElement | null>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** «Oggi: 18 da ripassare, 8 nuove», naming the subject when one is chosen; a part that is zero is left out. */
function todoSentence(data: Progressi, subject: string | undefined): string {
  const parts = [
    data.oggi.dovute > 0 ? `${data.oggi.dovute} da ripassare` : null,
    data.oggi.nuove > 0 ? plural(data.oggi.nuove, 'nuova', 'nuove') : null,
  ].filter(Boolean);
  return `${subject ? `Oggi in ${subject}` : 'Oggi'}: ${parts.join(', ')}`;
}

/** The page's one primary button: 44 px, full width on a phone; a key that presses into its ink edge. */
const PRIMARY = cn(
  'min-h-[44px] w-full rounded-xl px-8 text-base font-semibold md:w-auto',
  'shadow-[0_4px_0_var(--color-primary-950)] transition-[translate,box-shadow] active:translate-y-[3px] active:shadow-[0_1px_0_var(--color-primary-950)] motion-reduce:transition-none',
  'dark:shadow-[0_4px_0_var(--color-primary-500)] dark:active:shadow-[0_1px_0_var(--color-primary-500)]',
  INK_BG,
  ON_INK,
  FOCUS_RING,
);

const RETRY = cn('min-h-[44px] rounded px-1 font-sans text-base font-medium underline', FOCUS_RING);

/** A read that failed with nothing on screen: say so, offer «Riprova», keep «Inizia». */
function Unread({ onRetry, onStart }: { onRetry: () => void; onStart: () => void }) {
  return (
    <div className="grid justify-items-stretch gap-3 md:justify-items-start">
      <p role="alert" className={cn('font-serif text-xl leading-snug md:text-2xl', INK_TEXT)}>
        Non riesco a leggere i tuoi progressi.{' '}
        <button type="button" onClick={onRetry} className={RETRY}>
          Riprova
        </button>
      </p>
      <p className={cn('-mt-1 text-sm', MUTED_TEXT)}>Puoi ripassare lo stesso: il ripasso legge le sue schede.</p>
      <button type="button" onClick={onStart} className={PRIMARY}>
        Inizia
      </button>
    </div>
  );
}

interface ActionProps extends Pick<TodayMissionsProps, 'action' | 'actionFailed' | 'subject' | 'onRetry' | 'onAllSubjects' | 'onStart'> {
  met: boolean;
}

/**
 * The first mission's action: what is on today, what it costs, and «Inizia» («Continua» once the goal is met);
 * with nothing left, «Hai finito per oggi» and the next day with cards. Narrowed to a subject, all of it is
 * that subject's.
 */
function TodayAction({ action, actionFailed, subject, onRetry, onAllSubjects, onStart, met }: ActionProps) {
  const filtered = subject !== undefined;
  const state = todayState(action, actionFailed, filtered);
  if (state === 'loading' || action === null) {
    if (state === 'unread') return <Unread onRetry={onRetry} onStart={onStart} />;
    return (
      <div aria-hidden className="grid gap-3">
        <div className="h-7 w-3/4 rounded-md bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" />
        <div className="h-11 w-full rounded-xl bg-slate-100 motion-safe:animate-pulse md:w-40 dark:bg-slate-800" />
      </div>
    );
  }
  const cards = action.oggi.dovute + action.oggi.nuove;
  const next = state === 'done' ? nextDueDay(action) : null;
  return (
    <div className="grid justify-items-stretch gap-3 pt-1 md:justify-items-start">
      <div className="grid gap-1">
        <p className={cn('font-serif text-xl leading-snug md:text-2xl', INK_TEXT)} aria-live="polite">
          {state === 'done' && (filtered ? 'Niente da ripassare in questa materia, per oggi.' : 'Hai finito per oggi.')}
          {state === 'todo' && todoSentence(action, subject)}
        </p>
        {state === 'todo' && <p className={cn('text-sm', MUTED_TEXT)}>{estimateLabel(cards)}</p>}
        {state === 'done' && (
          <p className={cn('text-sm', MUTED_TEXT)}>{next ? `Le prossime schede: ${next}.` : 'Nessuna scheda in programma nei prossimi 14 giorni.'}</p>
        )}
      </div>

      {/* A read after the first failed: what is on screen is the last answer. */}
      {actionFailed && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          Non riesco a leggere i tuoi progressi.{' '}
          <button type="button" onClick={onRetry} className={cn(RETRY, 'text-sm')}>
            Riprova
          </button>
        </p>
      )}

      {state === 'done' && filtered && (
        <button type="button" onClick={onAllSubjects} className={cn(SECONDARY_BUTTON, 'w-full px-5 md:w-auto')}>
          Ripassa tutte le materie
        </button>
      )}
      {state === 'todo' && (
        <button type="button" onClick={onStart} className={PRIMARY}>
          {met ? 'Continua' : 'Inizia'}
        </button>
      )}
    </div>
  );
}

/**
 * The list of today's missions (S2): a mission done since this browser last drew it has its ink run (the drop, then
 * the words), and once it has, slides under those still open (`missionOrder`); under reduced motion the order and the
 * marks are final at once. Mounted with the day's read, so its first answer is not taken for a mission just done.
 */
function MissionsOfToday({ day, missions, children }: { day: Progressi; missions: Mission[]; children: (mission: Mission) => ReactNode }) {
  const reduce = useReducedMotion() ?? false;
  const done = missions.filter((m) => m.status === 'fatta').map((m) => m.id);
  const fresh = useFreshMissions(day.oggi.giorno, done);
  // The fresh missions whose ink has run: they may move now.
  const [inked, setInked] = useState<ReadonlySet<string>>(() => new Set());
  const running = reduce ? [] : [...fresh].filter((id) => !inked.has(id));
  const runningKey = running.join(' ');
  useEffect(() => {
    if (!runningKey) return;
    const timer = window.setTimeout(() => setInked((before) => new Set([...before, ...runningKey.split(' ')])), MISSION_INK_MS);
    return () => window.clearTimeout(timer);
  }, [runningKey]);
  const met = day.oggi.raggiunto;

  return (
    <ol aria-label="Missioni di oggi" className="divide-y divide-slate-100 dark:divide-slate-800">
      {missionOrder(missions, new Set(running)).map((mission) => (
        // Met by the count, the stamp says it to the eye; met with the queue finished under it, the line says why.
        <MissionRow
          key={mission.id}
          mission={mission}
          bar
          ink={running.includes(mission.id) ? 'drip' : 'still'}
          layout={!reduce}
          quietNote={mission.id === 'obiettivo' && met && day.oggi.ripassi >= day.oggi.obiettivo}
        >
          {children(mission)}
        </MissionRow>
      ))}
    </ol>
  );
}

/**
 * «Le missioni di oggi» (Gymnasium spec §5.1), first on the page: the day's three missions, one under the other,
 * each with its mark, its progress and an action, and the summary «2 di 3». The first carries the page's one
 * primary button; the other two open the settings that set their targets; the goal's is sealed by the stamp once
 * met. The missions come from the whole day's read (`missions.ts`); the action follows the subject chosen.
 * While the first read travels the card holds its size; a failed read says so and keeps «Inizia»; with no card
 * at all, how to begin.
 */
export function TodayMissions({ day, dayFailed, action, actionFailed, onRetry, subject, onAllSubjects, onStart, onOpenSettings, celebrate, stampRef }: TodayMissionsProps) {
  const state = todayState(day, dayFailed, false);
  const missions = day && (state === 'todo' || state === 'done') ? todayMissions(day) : null;
  const summary = missions ? missionSummary(missions) : null;
  const met = day?.oggi.raggiunto ?? false;

  return (
    <section aria-labelledby="studia-missioni" aria-busy={state === 'loading'} className={cn(TILE, 'p-5 md:p-6')}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="studia-missioni" className={BLOCK_HEADING}>
          Le missioni di oggi
        </h3>
        {summary && (
          <p className="text-sm font-medium tabular-nums text-slate-700 dark:text-slate-200">
            {`${summary.done} di ${summary.of}`}
            <span className="sr-only"> compiute</span>
          </p>
        )}
      </div>

      {state === 'loading' && (
        // The final size, so nothing jumps when the read answers.
        <div className="mt-4 grid gap-4">
          <p className="sr-only">Carico i tuoi progressi…</p>
          {[0, 1, 2].map((row) => (
            <div key={row} aria-hidden className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3">
              <div className="h-6 w-6 rounded-full bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" />
              <div className={cn('rounded-lg bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800', row === 0 ? 'h-36' : 'h-14')} />
            </div>
          ))}
        </div>
      )}

      {state === 'unread' && (
        <div className="mt-3">
          <Unread onRetry={onRetry} onStart={onStart} />
        </div>
      )}

      {state === 'empty' && (
        <div className="mt-3 grid justify-items-start gap-2">
          <p className={cn('font-serif text-xl leading-snug md:text-2xl', INK_TEXT)}>Non hai ancora schede da ripassare.</p>
          <p className="max-w-prose text-sm text-slate-700 dark:text-slate-200">
            Per cominciare, apri un articolo dalla{' '}
            <Link to="/" className={cn('font-medium underline', FOCUS_RING)}>
              Ricerca
            </Link>{' '}
            e scegli «+ Nuova scheda» sotto il testo: le missioni partono dalla prima scheda.
          </p>
          <button type="button" aria-haspopup="dialog" onClick={onOpenSettings} className={QUIET_BUTTON}>
            Oppure accendi le schede della comunità
          </button>
        </div>
      )}

      {missions && day && (
        <MissionsOfToday day={day} missions={missions}>
          {(mission) => (
            <>
              {mission.id === 'dovute' && (
                // The day's read failing again is said here too: the missions above are its last answer.
                <TodayAction action={action} actionFailed={actionFailed || dayFailed} subject={subject} onRetry={onRetry} onAllSubjects={onAllSubjects} onStart={onStart} met={met} />
              )}
              {mission.id === 'nuove' && mission.status !== 'fatta' && (
                <button type="button" aria-haspopup="dialog" onClick={onOpenSettings} className={QUIET_BUTTON}>
                  {mission.status === 'vuota' ? 'Accendi le schede della comunità' : 'Cambia le nuove al giorno'}
                </button>
              )}
              {mission.id === 'obiettivo' &&
                (met && day ? (
                  <div ref={stampRef} className="w-max">
                    <GoalStamp giorno={day.oggi.giorno} serie={day.serie.attuale} press={celebrate} className="ml-1 mt-1" />
                  </div>
                ) : (
                  <button type="button" aria-haspopup="dialog" onClick={onOpenSettings} className={QUIET_BUTTON}>
                    Cambia l’obiettivo
                  </button>
                ))}
            </>
          )}
        </MissionsOfToday>
      )}
    </section>
  );
}
