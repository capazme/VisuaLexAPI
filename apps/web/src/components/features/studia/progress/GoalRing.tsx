import { useEffect, useId, useState } from 'react';
import { cn } from '../../../../lib/utils';
import { INK_TEXT, MUTED_TEXT, SUCCESS_TEXT } from './tokens';

export interface GoalRingProps {
  ripassi: number;
  obiettivo: number;
  /** The day counts: the ring is full and green, also when the queue ended under the goal. */
  raggiunto: boolean;
  className?: string;
}

const SIZE = 148;
const STROKE = 15;
const RADIUS = (SIZE - STROKE) / 2 - 4;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Today's goal as a ring (Studia progress spec §6.1): a thick arc from ink to primary inside a dotted
 * seal, the count in the reader's serif. It fills from empty when it appears and eases to each new
 * value; under reduced motion it is drawn at its value at once.
 */
export function GoalRing({ ripassi, obiettivo, raggiunto, className }: GoalRingProps) {
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
  return (
    <div className={cn('relative h-32 w-32 shrink-0 md:h-[148px] md:w-[148px]', className)} role="img" aria-label={`Obiettivo di oggi: ${ripassi} di ${obiettivo} ripassi${raggiunto ? ', raggiunto' : ''}`}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full" aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="currentColor" className={INK_TEXT} />
            <stop offset="1" stopColor="currentColor" className="text-primary-500" />
          </linearGradient>
        </defs>
        <circle cx={centre} cy={centre} r={centre - 2} fill="none" strokeWidth={1} strokeDasharray="2 3" className={cn('stroke-current', INK_TEXT)} />
        <circle cx={centre} cy={centre} r={RADIUS} fill="none" strokeWidth={STROKE} className="stroke-slate-100 dark:stroke-slate-800" />
        <circle
          data-testid="goal-arc"
          cx={centre}
          cy={centre}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - shown)}
          transform={`rotate(-90 ${centre} ${centre})`}
          stroke={raggiunto ? 'currentColor' : `url(#${gradientId})`}
          className={cn(raggiunto && SUCCESS_TEXT, 'transition-[stroke-dashoffset,stroke] duration-700 ease-out motion-reduce:transition-none', shown === 0 && 'opacity-0')}
        />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center leading-tight">
        <span className={cn('font-serif text-3xl font-semibold tabular-nums md:text-4xl', raggiunto ? SUCCESS_TEXT : INK_TEXT)}>{ripassi}</span>
        <span className={cn('text-xs', MUTED_TEXT)}>di {obiettivo} ripassi</span>
      </div>
    </div>
  );
}
