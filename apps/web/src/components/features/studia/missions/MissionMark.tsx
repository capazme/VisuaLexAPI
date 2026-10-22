import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import { ease, spring } from '../../../../lib/motion';
import { cn } from '../../../../lib/utils';
import { INK_BG, INK_BORDER, INK_TEXT, MUTED_TEXT, ON_INK } from '../progress/tokens';
import { STATUS_LABEL, type Mission, type MissionStatus } from './missions';

/**
 * How long a mission's ink runs (S2): the drop falls into the box, the box fills, the ink crosses the words
 * (`vlx-mission-inking` in `index.css`, 300 ms in, for 320 ms). Then the mission may slide under the others.
 */
export const MISSION_INK_MS = 680;

/** The drop falling into the box, the box filling, the tick: a mission done just now (S2). */
function DrippingMark() {
  return (
    <span aria-hidden className={cn('relative mt-0.5 grid h-6 w-6 shrink-0 place-content-center rounded-full border-2', INK_BORDER)}>
      <motion.span
        className="absolute left-1/2 top-0 -ml-[3px] h-1.5 w-1.5 rounded-full"
        style={{ background: 'var(--vlx-section-gymnasium)' }}
        initial={{ y: -14, scaleY: 1.5, opacity: 0 }}
        animate={{ y: 6, scaleY: 1, opacity: [0, 1, 1, 0] }}
        transition={{ duration: 0.2, ease: ease.inOut }}
      />
      <motion.span
        className={cn('absolute -inset-0.5 rounded-full', INK_BG)}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.16, ease: ease.out, delay: 0.18 }}
      />
      <motion.span className={cn('relative', ON_INK)} initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...spring.snappy, delay: 0.26 }}>
        <Check size={14} strokeWidth={3} />
      </motion.span>
    </span>
  );
}

/**
 * The mark beside a mission: ticked in ink when done, an ink ring while open, a dotted ring when there is nothing
 * to do today or it is still to come. It is drawn, not pressed: no mission is ticked by hand. `drip`: done just now —
 * a drop of ink falls into the box and fills it (S2; inspired by Animorio's «La lista che gocciola», written from
 * scratch, the drop and not the pool); at rest, and under reduced motion, the mark as it is.
 */
export function MissionMark({ status, drip = false }: { status: MissionStatus; drip?: boolean }) {
  const reduce = useReducedMotion();
  if (status === 'fatta' && drip && !reduce) return <DrippingMark />;
  return (
    <span
      aria-hidden
      className={cn(
        'mt-0.5 grid h-6 w-6 shrink-0 place-content-center rounded-full border-2',
        status === 'fatta' && cn(INK_BG, INK_BORDER, ON_INK),
        status === 'aperta' && INK_BORDER,
        (status === 'vuota' || status === 'in-arrivo') && 'border-dotted border-slate-300 dark:border-slate-600',
      )}
    >
      {status === 'fatta' && <Check size={14} strokeWidth={3} />}
    </span>
  );
}

/**
 * What a mission is worth (Gymnasium XP spec §9): «20 XP» beside its count, «+20 XP» in ink once earned. Said in words
 * to a screen reader. Never on a mission still to come, which cannot be earned.
 */
function MissionPoints({ points, earned }: { points: number; earned: boolean }) {
  return (
    <p className={cn('shrink-0 text-xs font-medium tabular-nums', earned ? INK_TEXT : MUTED_TEXT)}>
      <span aria-hidden>{`${earned ? '+' : ''}${points} XP`}</span>
      <span className="sr-only">{earned ? `${points} punti guadagnati` : `vale ${points} punti`}</span>
    </p>
  );
}

export interface MissionRowProps {
  mission: Mission;
  /** A thin bar of the share under the title, 4 px (today's missions, G8; the full list keeps to the words). */
  bar?: boolean;
  /** The note is said to a screen reader only (the goal's line, when the stamp says it to the eye). */
  quietNote?: boolean;
  /** At the end of the title's line, in place of the count: «In arrivo». */
  aside?: ReactNode;
  /** What can be done about it, under the title. */
  children?: ReactNode;
  /**
   * Today's missions (S2): a mission done has its words inked through — `drip` when it was done since this browser
   * last drew it (the drop, then the ink crossing the words), `still` at rest. The full list keeps to the words.
   */
  ink?: 'drip' | 'still';
  /** The row slides to its new place when the order changes (today's missions; never under reduced motion). */
  layout?: boolean;
}

/** One mission: its mark, its title and state, «8 di 18» and its points (and the bar), its note, and its action. */
export function MissionRow({ mission, bar = false, quietNote = false, aside, children, ink, layout = false }: MissionRowProps) {
  const { progress } = mission;
  // A mission done is full, also the goal the server counted with the queue finished under it.
  const share = mission.status === 'fatta' ? 1 : progress && progress.of > 0 ? Math.min(1, progress.done / progress.of) : 0;
  const inked = ink !== undefined && mission.status === 'fatta';
  return (
    <motion.li
      layout={layout ? 'position' : false}
      transition={spring.snappy}
      data-missione={mission.id}
      className={cn(
        'grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 py-3 first:pt-2.5',
        // A row that moves keeps its padding wherever it lands: the last one's is taken back by the list's margin
        // (`MissionsOfToday`). The first row and its missing rule never change: the due cards stay first.
        !layout && 'last:pb-0',
      )}
    >
      <MissionMark status={mission.status} drip={inked && ink === 'drip'} />
      <div className="grid min-w-0 gap-1.5">
        {/* On a phone the count and the points always go under the title, whatever its length, so every row has the
            same shape (G8, Bill); from `md` they sit at the end of the title's line. */}
        <div className="flex flex-col items-start gap-y-1 md:flex-row md:flex-wrap md:items-baseline md:justify-between md:gap-x-3">
          <p
            className={cn(
              'font-medium',
              inked
                ? ink === 'drip'
                  ? 'vlx-mission-inking'
                  : 'vlx-mission-done'
                : mission.status === 'in-arrivo' || mission.status === 'vuota'
                  ? 'text-slate-600 dark:text-slate-300'
                  : 'text-slate-900 dark:text-slate-50',
            )}
          >
            {mission.title}
            <span className="sr-only">{`: ${STATUS_LABEL[mission.status]}`}</span>
          </p>
          <div className="flex shrink-0 items-baseline gap-x-3">
            {aside ?? (progress && <p className="shrink-0 text-sm tabular-nums text-slate-600 dark:text-slate-300">{`${progress.done} di ${progress.of}`}</p>)}
            {mission.status !== 'in-arrivo' && <MissionPoints points={mission.points} earned={mission.status === 'fatta'} />}
          </div>
        </div>
        {bar && progress && (
          <span aria-hidden className="block h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <span className={cn('block h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none', INK_BG)} style={{ width: `${share * 100}%` }} />
          </span>
        )}
        {mission.note && <p className={cn('max-w-prose text-sm', MUTED_TEXT, quietNote && 'sr-only')}>{mission.note}</p>}
        {children}
      </div>
    </motion.li>
  );
}
