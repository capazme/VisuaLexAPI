import { useEffect, useState } from 'react';
import { cn } from '../../../../lib/utils';
import { useReviewsGrowth } from './seenProgress';
import { INK_TEXT, MUTED_TEXT } from './tokens';

export interface GoalRingProps {
  ripassi: number;
  obiettivo: number;
  /** The day counts: the line says «raggiunto»; the bar keeps the true share.*/
  raggiunto: boolean;
  /** The server's day of `ripassi`: with it, the count lands when it grew since this browser last drew it (S2). */
  giorno?: string;
  /** The strip's: «5 su 10», without «Obiettivo di oggi». */
  compact?: boolean;
  className?: string;
}

/**
 * Today's goal (LC39, the anti-slop review: the ring was a dashboard's widget, full and green at «6 di 10»): one line,
 * «Obiettivo di oggi: 6 su 10», and under it a 4 px bar in ink filled to the true share, never green; reached, «Obiettivo
 * di oggi raggiunto» and the bar full (the count the missions read; the cards reviewed would contradict it). It fills from empty when it appears and eases to each new value; under reduced motion it
 * is drawn at its value at once. When today's count grew since this browser last drew it, the new digit falls into
 * place (S2, `vlx-digit-land`). `compact`: the strip's, the words shorter.
 */
export function GoalRing({ ripassi, obiettivo, raggiunto, giorno, compact = false, className }: GoalRingProps) {
  // Reached, the day counts (the server's, as the missions read it: «10 di 10»): full, and no count that would contradict
  // it (the cards reviewed are fewer than the grades). Before it, the true share.
  const share = raggiunto ? 1 : Math.min(1, obiettivo > 0 ? ripassi / obiettivo : 0);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(share));
    return () => cancelAnimationFrame(frame);
  }, [share]);

  const lands = useReviewsGrowth(giorno, ripassi) !== null;
  const digits = cn('font-semibold tabular-nums', INK_TEXT);
  const count = !lands ? (
    <span key={ripassi} className={digits}>{ripassi}</span>
  ) : (
    <span key={ripassi} className="relative inline-block">
      <span className={cn(digits, 'invisible')}>{ripassi}</span>
      <span data-testid="goal-count-landing" className={cn(digits, 'vlx-digit-land absolute inset-0 text-center')}>{ripassi}</span>
    </span>
  );
  const name = `Obiettivo di oggi: ${ripassi} di ${obiettivo} ripassi${raggiunto ? ', raggiunto' : ''}`;

  return (
    <div role="img" aria-label={name} className={cn('grid w-full gap-1.5', compact ? 'max-w-48' : 'max-w-xs', className)}>
      <p aria-hidden className={cn('text-sm', MUTED_TEXT)}>
        {raggiunto ? (
          compact ? 'Obiettivo raggiunto' : 'Obiettivo di oggi raggiunto'
        ) : (
          <>
            {compact ? null : 'Obiettivo di oggi: '}
            {count} su {obiettivo}
          </>
        )}
      </p>
      <span aria-hidden className="block h-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <span
          data-testid="goal-arc"
          className="block h-full rounded-full bg-ink-900 transition-[width] duration-700 ease-out motion-reduce:transition-none dark:bg-ink-100"
          style={{ width: `${shown * 100}%` }}
        />
      </span>
    </div>
  );
}
