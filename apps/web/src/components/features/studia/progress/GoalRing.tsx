import { useEffect, useId, useState } from 'react';
import { cn } from '../../../../lib/utils';
import { useReviewsGrowth } from './seenProgress';
import { INK_TEXT, MUTED_TEXT, SUCCESS_TEXT } from './tokens';

export interface GoalRingProps {
  ripassi: number;
  obiettivo: number;
  /** The day counts: the ring is full and green, also when the queue ended under the goal. */
  raggiunto: boolean;
  /** The server's day of `ripassi`: with it, the count lands when it grew since this browser last drew it (S2). */
  giorno?: string;
  /** The strip's ring (Gymnasium spec §5.1): small, with «5 di 10» beside it. */
  compact?: boolean;
  className?: string;
}

const SIZE = 148;
const STROKE = 15;
/** Thicker in the small ring, where 15 units of 148 would draw a hairline. */
const COMPACT_STROKE = 22;

/**
 * Today's goal as a ring (Studia progress spec §6.1): a thick arc from ink to primary inside a dotted
 * seal, the count in the reader's serif. It fills from empty when it appears and eases to each new
 * value; under reduced motion it is drawn at its value at once. `compact`: 40 px, the count beside it.
 * When today's count grew since this browser last drew it, the new digit falls into place and takes on its weight
 * (S2; inspired by Animorio's «Il contatore che prende peso», written from scratch; `vlx-digit-land` in `index.css`,
 * nothing under reduced motion); reaching the goal, the ring closes as the digit settles. The numbers are the read's.
 */
export function GoalRing({ ripassi, obiettivo, raggiunto, giorno, compact = false, className }: GoalRingProps) {
  // A fragment id must be plain: React's ids carry characters a url(#…) reference would need escaped.
  const gradientId = `goal-ring-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const share = raggiunto ? 1 : Math.min(1, obiettivo > 0 ? ripassi / obiettivo : 0);
  // Drawn empty first, then at its value, so the arc fills when the page opens.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(share));
    return () => cancelAnimationFrame(frame);
  }, [share]);

  const lands = useReviewsGrowth(giorno, ripassi) !== null;
  // Keyed by the count, so each new one lands afresh. While it lands, its place is held by the count at its final
  // weight, unseen: the lighter digit is narrower, and « di 10» beside it must not move.
  const count = (size: string) => {
    const digits = cn('font-serif font-semibold tabular-nums', size, raggiunto ? SUCCESS_TEXT : INK_TEXT);
    if (!lands) return <span key={ripassi} className={digits}>{ripassi}</span>;
    return (
      <span key={ripassi} className="relative inline-block">
        <span className={cn(digits, 'invisible')}>{ripassi}</span>
        <span data-testid="goal-count-landing" className={cn(digits, 'vlx-digit-land absolute inset-0 text-center')}>
          {ripassi}
        </span>
      </span>
    );
  };

  const centre = SIZE / 2;
  const stroke = compact ? COMPACT_STROKE : STROKE;
  const radius = (SIZE - stroke) / 2 - 4;
  const circumference = 2 * Math.PI * radius;
  const name = `Obiettivo di oggi: ${ripassi} di ${obiettivo} ripassi${raggiunto ? ', raggiunto' : ''}`;
  const ring = (
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full" aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="currentColor" className={INK_TEXT} />
            <stop offset="1" stopColor="currentColor" className="text-primary-500" />
          </linearGradient>
        </defs>
        {!compact && <circle cx={centre} cy={centre} r={centre - 2} fill="none" strokeWidth={1} strokeDasharray="2 3" className={cn('stroke-current', INK_TEXT)} />}
        <circle cx={centre} cy={centre} r={radius} fill="none" strokeWidth={stroke} className="stroke-slate-100 dark:stroke-slate-800" />
        <circle
          data-testid="goal-arc"
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - shown)}
          transform={`rotate(-90 ${centre} ${centre})`}
          stroke={raggiunto ? 'currentColor' : `url(#${gradientId})`}
          className={cn(raggiunto && SUCCESS_TEXT, 'transition-[stroke-dashoffset,stroke] duration-700 ease-out motion-reduce:transition-none', shown === 0 && 'opacity-0')}
        />
      </svg>
  );

  if (compact) {
    return (
      <div className={cn('flex items-center gap-2', className)} role="img" aria-label={name}>
        <div className="h-10 w-10 shrink-0">{ring}</div>
        <p aria-hidden className="whitespace-nowrap leading-none">
          {count('text-xl')}
          <span className={cn('text-sm', MUTED_TEXT)}> di {obiettivo}</span>
        </p>
      </div>
    );
  }

  return (
    <div className={cn('relative h-32 w-32 shrink-0 md:h-[148px] md:w-[148px]', className)} role="img" aria-label={name}>
      {ring}
      <div className="absolute inset-0 grid place-content-center text-center leading-tight">
        {count('text-3xl md:text-4xl')}
        <span className={cn('text-xs', MUTED_TEXT)}>di {obiettivo} ripassi</span>
      </div>
    </div>
  );
}
