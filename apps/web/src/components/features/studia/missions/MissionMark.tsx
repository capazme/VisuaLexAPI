import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { INK_BG, INK_BORDER, MUTED_TEXT, ON_INK } from '../progress/tokens';
import { STATUS_LABEL, type Mission, type MissionStatus } from './missions';

/**
 * The mark beside a mission: ticked in ink when done, an ink ring while open, a dotted ring when there is nothing
 * to do today or it is still to come. It is drawn, not pressed: no mission is ticked by hand.
 */
export function MissionMark({ status }: { status: MissionStatus }) {
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

export interface MissionRowProps {
  mission: Mission;
  /** A thin bar of the share under the title (today's missions; the full list keeps to the words). */
  bar?: boolean;
  /** The note is said to a screen reader only (the goal's line, when the stamp says it to the eye). */
  quietNote?: boolean;
  /** At the end of the title's line, in place of the count: «In arrivo». */
  aside?: ReactNode;
  /** What can be done about it, under the title. */
  children?: ReactNode;
}

/** One mission: its mark, its title and state, «8 di 18» (and the bar), its note, and its action. */
export function MissionRow({ mission, bar = false, quietNote = false, aside, children }: MissionRowProps) {
  const { progress } = mission;
  const share = progress && progress.of > 0 ? Math.min(1, progress.done / progress.of) : 0;
  return (
    <li data-missione={mission.id} className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 py-4 first:pt-3 last:pb-0">
      <MissionMark status={mission.status} />
      <div className="grid min-w-0 gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className={cn('font-medium', mission.status === 'in-arrivo' || mission.status === 'vuota' ? 'text-slate-600 dark:text-slate-300' : 'text-slate-900 dark:text-slate-50')}>
            {mission.title}
            <span className="sr-only">{`: ${STATUS_LABEL[mission.status]}`}</span>
          </p>
          {aside ?? (progress && <p className="shrink-0 text-sm tabular-nums text-slate-600 dark:text-slate-300">{`${progress.done} di ${progress.of}`}</p>)}
        </div>
        {bar && progress && (
          <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <span className={cn('block h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none', INK_BG)} style={{ width: `${share * 100}%` }} />
          </span>
        )}
        {mission.note && <p className={cn('text-sm', MUTED_TEXT, quietNote && 'sr-only')}>{mission.note}</p>}
        {children}
      </div>
    </li>
  );
}
