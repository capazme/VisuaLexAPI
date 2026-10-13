import { useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { StatoGiorno } from '../../../../types/studia';
import { formatDayLong } from './layout';
import { INK_BG, INK_BORDER, INK_TEXT, MUTED_TEXT, ON_INK } from './tokens';

export interface StreakBadgeProps {
  attuale: number;
  record: number;
  ultimiGiorni: { giorno: string; stato: StatoGiorno }[];
}

const DAY_STATE_LABEL: Record<StatoGiorno, string> = {
  fatto: 'obiettivo raggiunto',
  riposo: 'giorno di riposo, la serie regge',
  saltato: 'non fatto',
  oggi: 'oggi, da fare',
};

/**
 * The streak (Studia progress spec §6.1): a round ink badge with «§» that breathes slowly, the count in
 * large serif, the record, and the last seven days as the boxes of a register: ticked for a day that
 * counted, dashed for a rest, empty for a missed day, outlined for today. The count pops when it grows;
 * under reduced motion nothing moves.
 */
export function StreakBadge({ attuale, record, ultimiGiorni }: StreakBadgeProps) {
  const reduce = useReducedMotion();
  // The count pops only when it changes, never when it first appears.
  const firstCount = useRef(attuale);
  const grew = attuale !== firstCount.current;

  return (
    <div className="flex flex-col gap-2" role="group" aria-label={`Serie: ${attuale} ${attuale === 1 ? 'giorno' : 'giorni'} di fila, record ${record}`}>
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
          <motion.span
            key={attuale}
            initial={grew && !reduce ? { scale: 1.35 } : false}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 14 }}
            className={cn('inline-block origin-left font-serif text-4xl font-bold leading-none tabular-nums md:text-5xl', INK_TEXT)}
          >
            {attuale}
          </motion.span>
          <p className={cn('text-xs', MUTED_TEXT)}>
            {attuale === 1 ? 'giorno' : 'giorni'} di fila · record {record}
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
