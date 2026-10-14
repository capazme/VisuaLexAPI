import { useId, useState, type KeyboardEvent } from 'react';
import { cn } from '../../../../lib/utils';
import { dayDate, formatDayShort, niceMax } from './layout';
import { FOCUS_RING, MUTED_TEXT } from './tokens';

export interface DueForecastProps {
  prossimi: { giorno: string; schede: number }[];
  /** A subject's hue when the dashboard is narrowed to one; ink otherwise. */
  hue?: string;
}

const WIDTH = 280;
const HEIGHT = 110;
const BASE = 96;
const TOP = 8;

const cards = (n: number) => `${n} ${n === 1 ? 'scheda' : 'schede'}`;

/** «Oggi», «Domani», else «mer 21». */
function dayName(index: number, giorno: string): string {
  if (index === 0) return 'Oggi';
  if (index === 1) return 'Domani';
  return formatDayShort(giorno);
}

/**
 * The coming fourteen days (Studia progress spec §4.5): the cards due each day, overdue ones in today's
 * bar, which is drawn apart in the warm tone because it is the only one the user can act on. One tab
 * stop; the arrows move between days, and hovering or tapping a bar says its day and count.
 */
export function DueForecast({ prossimi, hue }: DueForecastProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const readoutId = useId();
  const top = niceMax(prossimi.map((d) => d.schede));
  const pitch = WIDTH / Math.max(1, prossimi.length);
  const y = (n: number) => BASE - ((BASE - TOP) * n) / top;
  const total = prossimi.reduce((n, d) => n + d.schede, 0);

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = prossimi.length - 1;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = (selected ?? 0) - 1;
    else if (event.key === 'ArrowRight') next = (selected ?? -1) + 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    setSelected(Math.max(0, Math.min(last, next)));
  };

  const chosen = selected === null ? null : prossimi[selected];
  return (
    <div className="space-y-2">
      <div
        tabIndex={0}
        role="group"
        aria-label={`Schede da ripassare nei prossimi 14 giorni: ${cards(total)}, ${cards(prossimi[0]?.schede ?? 0)} oggi`}
        aria-describedby={readoutId}
        onKeyDown={move}
        className={cn('rounded-md', FOCUS_RING)}
      >
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block h-auto w-full" aria-hidden>
          {[top / 2, top].map((value) => (
            <g key={value}>
              <line x1={0} x2={WIDTH} y1={y(value)} y2={y(value)} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth={0.5} />
              <text x={WIDTH} y={y(value) - 2} textAnchor="end" className="fill-slate-500 text-[8px] dark:fill-slate-400">
                {Math.round(value)}
              </text>
            </g>
          ))}
          {prossimi.map((day, index) => {
            const h = BASE - y(day.schede);
            const today = index === 0;
            return (
              <g key={day.giorno} data-day={day.giorno} onPointerEnter={() => setSelected(index)} onClick={() => setSelected(index)} className="cursor-pointer">
                {/* The whole column answers, not only the bar: a short bar is still easy to hit. */}
                <rect x={index * pitch} y={0} width={pitch} height={HEIGHT} fill="transparent" />
                <rect
                  x={index * pitch + 2}
                  y={BASE - Math.max(h, day.schede > 0 ? 1.5 : 0)}
                  width={pitch - 4}
                  height={Math.max(h, day.schede > 0 ? 1.5 : 0)}
                  rx={3}
                  className={cn(
                    today ? 'fill-amber-500 dark:fill-amber-400' : hue === undefined && 'fill-primary-900 dark:fill-primary-300',
                    selected === index && 'opacity-75',
                  )}
                  style={!today && hue !== undefined ? { fill: hue } : undefined}
                />
                {index % 2 === 0 && (
                  <text x={index * pitch + pitch / 2} y={HEIGHT - 2} textAnchor="middle" className="fill-slate-500 text-[8px] dark:fill-slate-400">
                    {today ? 'oggi' : dayDate(day.giorno).getUTCDate()}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <p id={readoutId} aria-live="polite" className={cn('min-h-5 text-sm tabular-nums', chosen ? 'text-slate-800 dark:text-slate-100' : MUTED_TEXT)}>
        {chosen ? `${dayName(selected!, chosen.giorno)}: ${cards(chosen.schede)} da ripassare` : 'Tocca una barra per il giorno.'}
      </p>
    </div>
  );
}
