import { motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { StatoGiorno } from '../../../../types/studia';
import { formatDayLong } from './layout';
import { DAY_STATE_LABEL, INK_BG, INK_BORDER, INK_TEXT, MUTED_TEXT, ON_INK } from './tokens';
import { spring } from '../../../../lib/motion';
import { useStreakGrowth } from './seenProgress';
import { StreakTally } from './StreakTally';

export interface StreakBadgeProps {
  attuale: number;
  record: number;
  ultimiGiorni: { giorno: string; stato: StatoGiorno }[];
  /** The celebration: the count pops, as when it grows. */
  pop?: boolean;
  /** The strip's badge (Gymnasium spec §5.1): the «§» small, the count, one short line, no week of boxes. */
  compact?: boolean;
  /** Smaller still, over the area's other views: the count without its line. */
  dense?: boolean;
}

/**
 * The streak (Studia progress spec §6.1): a round ink badge with «§» that breathes slowly, the count in
 * large serif, the record, and the last seven days as the boxes of a register: ticked for a day that
 * counted, dashed for a rest, empty for a missed day, outlined for today. Beside the count, the bundle of five being
 * filled as tally marks (`StreakTally`). The count pops and the newest mark comes down when the streak grew since this
 * browser last drew it (`useStreakGrowth`), not at every visit; under reduced motion nothing moves. `compact` is the strip's and the statistics band's: still, and without
 * the week (the band draws the current week itself, `StatsBand`).
 */
export function StreakBadge({ attuale, record, ultimiGiorni, pop = false, compact = false, dense = false }: StreakBadgeProps) {
  const reduce = useReducedMotion();
  // The count pops when it grew since this browser last drew it (or while on screen), never at every visit (S2); the
  // dense strip draws no tally and leaves the growth to the views that do.
  const grewSince = useStreakGrowth(attuale, !dense) !== null;
  const grew = grewSince || pop;
  const firstDay = attuale === 0 && record === 0;
  const name = `Serie: ${attuale} ${attuale === 1 ? 'giorno' : 'giorni'} di fila, record ${record}`;

  if (compact) {
    return (
      // An image, not a group: every child is hidden, and a group with nothing in it may be skipped.
      <div className="flex min-w-0 items-center gap-2" role="img" aria-label={name}>
        <span aria-hidden className={cn('grid h-8 w-8 shrink-0 place-content-center rounded-full font-serif text-lg font-bold leading-none', INK_BG, ON_INK)}>
          §
        </span>
        <div aria-hidden className="min-w-0 leading-tight">
          <span className="flex items-end gap-2">
            <motion.span
              key={`${attuale}-${pop}`}
              initial={grew && !reduce ? { scale: 1.35 } : false}
              animate={{ scale: 1 }}
              transition={spring.gentle}
              className={cn('inline-block origin-left font-serif text-xl font-bold leading-none tabular-nums', INK_TEXT)}
            >
              {attuale}
            </motion.span>
            {!dense && <StreakTally count={attuale} grew={grewSince} />}
          </span>
          {!dense && (
            <p className={cn('text-xs', MUTED_TEXT)}>{firstDay ? 'Il primo giorno comincia oggi' : `${attuale === 1 ? 'giorno' : 'giorni'} di fila · record ${record}`}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" role="group" aria-label={name}>
      <div className="flex items-center gap-3">
        <span className="relative grid h-14 w-14 shrink-0 place-content-center" aria-hidden>
          {!reduce && (
            <motion.span
              className={cn('absolute inset-0 rounded-full opacity-20', INK_BG)}
              animate={{ scale: [1, 1.18, 1], opacity: [0.25, 0.08, 0.25] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
          <span className={cn('relative grid h-14 w-14 place-content-center rounded-full font-serif text-3xl font-bold leading-none', INK_BG, ON_INK)}>§</span>
        </span>
        <div className="min-w-0" aria-hidden>
          <span className="flex items-end gap-3">
            <motion.span
              key={`${attuale}-${pop}`}
              initial={grew && !reduce ? { scale: 1.35 } : false}
              animate={{ scale: 1 }}
              transition={spring.gentle}
              className={cn('inline-block origin-left font-serif text-4xl font-bold leading-none tabular-nums md:text-5xl', INK_TEXT)}
            >
              {attuale}
            </motion.span>
            <StreakTally count={attuale} grew={grewSince} />
          </span>
          <p className={cn('text-xs', MUTED_TEXT)}>
            {firstDay ? 'Il primo giorno comincia oggi' : `${attuale === 1 ? 'giorno' : 'giorni'} di fila · record ${record}`}
          </p>
        </div>
      </div>
      <ol className="flex gap-1.5" aria-label="Ultimi sette giorni">
        {ultimiGiorni.map(({ giorno, stato }, index) => (
          <li key={giorno}>
            <span
              data-stato={stato}
              title={`${formatDayLong(giorno)}: ${DAY_STATE_LABEL[stato]}`}
              className={cn(
                'grid h-5 w-5 place-content-center rounded-[4px] border-[1.5px]',
                stato === 'fatto' && cn(INK_BG, INK_BORDER, ON_INK),
                stato === 'riposo' && cn('border-dashed', INK_BORDER),
                stato === 'saltato' && 'border-slate-300 dark:border-slate-600',
                stato === 'oggi' && INK_BORDER,
                // Today is the last box, outlined whether it is still open or already done.
                index === ultimiGiorni.length - 1 && 'ring-2 ring-primary-900/40 ring-offset-1 dark:ring-primary-300/40 dark:ring-offset-slate-900',
              )}
            >
              {stato === 'fatto' && <Check size={13} strokeWidth={3} aria-hidden />}
              <span className="sr-only">{`${formatDayLong(giorno)}: ${DAY_STATE_LABEL[stato]}`}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
