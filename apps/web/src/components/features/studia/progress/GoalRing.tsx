import { useEffect, useId, useState } from 'react';
import { cn } from '../../../../lib/utils';
import { INK_TEXT, MUTED_TEXT, SUCCESS_TEXT } from './tokens';

export interface GoalRingProps {
  ripassi: number;
  obiettivo: number;
  /** The day counts: the ring is full and green, also when the queue ended under the goal. */
  raggiunto: boolean;
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
 */
export function GoalRing({ ripassi, obiettivo, raggiunto, compact = false, className }: GoalRingProps) {
  // A fragment id must be plain: React's ids carry characters a url(#…) reference would need escaped.
  const gradientId = `goal-ring-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const share = raggiunto ? 1 : Math.min(1, obiettivo > 0 ? ripassi / obiettivo : 0);
  // Drawn empty first, then at its value, so the arc fills when the page opens.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(share));
    return () => cancelAnimationFrame(frame);
  }, [share]);

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
          <span className={cn('font-serif text-xl font-semibold tabular-nums', raggiunto ? SUCCESS_TEXT : INK_TEXT)}>{ripassi}</span>
          <span className={cn('text-sm', MUTED_TEXT)}> di {obiettivo}</span>
        </p>
      </div>
    );
  }

  return (
    <div className={cn('relative h-32 w-32 shrink-0 md:h-[148px] md:w-[148px]', className)} role="img" aria-label={name}>
      {ring}
      <div className="absolute inset-0 grid place-content-center text-center leading-tight">
        <span className={cn('font-serif text-3xl font-semibold tabular-nums md:text-4xl', raggiunto ? SUCCESS_TEXT : INK_TEXT)}>{ripassi}</span>
        <span className={cn('text-xs', MUTED_TEXT)}>di {obiettivo} ripassi</span>
      </div>
    </div>
  );
}
