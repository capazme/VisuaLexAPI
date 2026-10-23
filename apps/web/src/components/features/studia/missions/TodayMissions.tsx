import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Settings2 } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { Progressi } from '../../../../types/studia';
import { GoalStamp } from '../progress/Celebration';
import { todayState } from '../progress/today';
import { BLOCK_HEADING, QUIET_BUTTON, TILE } from '../progress/tokens';
import { MISSION_INK_MS, MissionRow } from './MissionMark';
import { missionOrder, missionSummary, todayMissions, type Mission } from './missions';
import { useFreshMissions } from '../progress/seenProgress';

export interface TodayMissionsProps {
  /** The whole day's answer: the missions are the day's. Null before the first one, or when it could not be read. */
  day: Progressi | null;
  /** The day's last read failed (the first, or one after it): the day block says so, with «Riprova». */
  dayFailed: boolean;
  /** Opens the study settings in «I tuoi progressi» (G6), at the community's subjects when asked. */
  onOpenSettings: (target?: 'comunita') => void;
  /** The id of the settings' panel, which the line under the missions controls. */
  settingsPanel?: string;
  /** The stamp is pressed in now (the celebration, once a day; the caller decides). */
  celebrate: boolean;
  /** Where the celebration's confetti start: the stamp, in the goal's row, so they start where the eye is. */
  stampRef?: RefObject<HTMLDivElement | null>;
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
    // `-mb-3`: the last row's bottom padding, which a moving row keeps (`MissionRow`'s `layout`).
    <ol aria-label="Missioni di oggi" className={cn('divide-y divide-slate-100 dark:divide-slate-800', !reduce && '-mb-3')}>
      {missionOrder(missions, new Set(running)).map((mission) => (
        // Met by the count and earned, the stamp says it to the eye; met with the queue finished under it, or under the
        // mission's 10 reviews, the line says why.
        <MissionRow
          key={mission.id}
          mission={mission}
          bar
          ink={running.includes(mission.id) ? 'drip' : 'still'}
          layout={!reduce}
          quietNote={mission.id === 'obiettivo' && mission.status === 'fatta' && met && day.oggi.ripassi >= day.oggi.obiettivo}
        >
          {children(mission)}
        </MissionRow>
      ))}
    </ol>
  );
}

/**
 * «Le missioni di oggi» (Gymnasium spec §5.1), under the day block (G8): the day's three missions as three compact
 * rows — the mark, the title, «4 di 16», the points and a bar of 4 px — and the summary «2 di 3». The action is the day
 * block's, above; the goal's row takes the stamp once met. The targets are settings, not missions: one line under the
 * rows opens them («Obiettivo e nuove al giorno: nelle impostazioni»). While the first read travels the card holds its
 * size; a failed read, or no card at all, is the day block's to say (no card is drawn then).
 */
export function TodayMissions({ day, dayFailed, onOpenSettings, settingsPanel, celebrate, stampRef }: TodayMissionsProps) {
  const state = todayState(day, dayFailed, false);
  const missions = day && (state === 'todo' || state === 'done') ? todayMissions(day) : null;
  // A failed read and no card at all are the day block's to say; a server without the points (#253) sends no
  // missions: no card at all, rather than «0 di 0» over nothing.
  if (state === 'unread' || state === 'empty' || missions?.length === 0) return null;
  const summary = missions ? missionSummary(missions) : null;
  const met = day?.oggi.raggiunto ?? false;
  // No new card to be had: the settings open on the community's subjects, where more can come from.
  const noNewCards = missions?.some((mission) => mission.id === 'nuove' && mission.status === 'vuota') ?? false;

  return (
    <section aria-labelledby="studia-missioni" aria-busy={state === 'loading'} className={cn(TILE, 'px-4 pb-1 pt-4 md:px-6 md:pt-5')}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="studia-missioni" className={BLOCK_HEADING}>
          Le missioni di oggi
        </h2>
        {summary && (
          <p className="text-sm font-medium tabular-nums text-slate-700 dark:text-slate-200">
            {`${summary.done} di ${summary.of}`}
            <span className="sr-only"> compiute</span>
          </p>
        )}
      </div>

      {state === 'loading' && (
        // The final size, so nothing jumps when the read answers.
        <div className="mt-1 grid pb-12">
          <p className="sr-only">Carico i tuoi progressi…</p>
          {[0, 1, 2].map((row) => (
            <div key={row} aria-hidden className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 py-3">
              <div className="h-6 w-6 rounded-full bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" />
              {/* A row's words, its count and its bar: one line from `md`, two on a phone (P1). */}
              <div className="h-16 rounded-lg bg-slate-100 motion-safe:animate-pulse md:h-9 dark:bg-slate-800" />
            </div>
          ))}
        </div>
      )}

      {missions && day && (
        <>
          <MissionsOfToday day={day} missions={missions}>
            {(mission) =>
              mission.id === 'obiettivo' &&
              met && (
                <div ref={stampRef} className="w-max">
                  <GoalStamp giorno={day.oggi.giorno} serie={day.serie.attuale} press={celebrate} className="ml-1 mt-1" />
                </div>
              )
            }
          </MissionsOfToday>
          {/* The targets are settings, not missions (G8): one way to them, under the rows. */}
          <div className="mt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              aria-controls={settingsPanel}
              onClick={() => onOpenSettings(noNewCards ? 'comunita' : undefined)}
              className={cn(QUIET_BUTTON, 'mx-0 inline-flex items-center gap-1.5 font-normal text-slate-600 dark:text-slate-300')}
            >
              Obiettivo e nuove al giorno: nelle impostazioni
              <Settings2 size={15} aria-hidden className="shrink-0" />
            </button>
          </div>
        </>
      )}
    </section>
  );
}
