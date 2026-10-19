import { useId, useState, type KeyboardEvent } from 'react';
import { cn } from '../../../../lib/utils';
import { dayDate, formatCount, formatDayShort, niceMax, scaleLines } from './layout';
import { FOCUS_RING, MUTED_TEXT } from './tokens';

export interface DueForecastProps {
  prossimi: { giorno: string; schede: number }[];
  /** A subject's hue when the page is narrowed to one; ink otherwise. */
  hue?: string;
}

const WIDTH = 280;
const HEIGHT = 84;
/** Room over the tallest bar for its rounded top; the scale's labels sit beside the drawing, not in it. */
const TOP = 8;
const BASE = HEIGHT;

const cards = (n: number) => `${formatCount(n)} ${n === 1 ? 'scheda' : 'schede'}`;

/** A point of the drawing as a share of its box, for the labels laid beside it. */
const share = (value: number, of: number) => `${(value / of) * 100}%`;

/** «Oggi», «Domani», else «mer 21». */
function dayName(index: number, giorno: string): string {
  if (index === 0) return 'Oggi';
  if (index === 1) return 'Domani';
  return formatDayShort(giorno);
}

/**
 * The coming fourteen days (Studia progress spec §4.5; Gymnasium spec §5.3): the cards due each day, overdue ones in
 * today's bar, which is drawn apart in the warm tone over a column of its own, because it is the only one the user can
 * act on. The scale is the interface's text in a column beside the drawing, the days in a row under it; a day with
 * nothing due is a hollow mark on the base, not a gap. One tab stop; the arrows move between days, and hovering or
 * tapping a bar says its day and count.
 */
export function DueForecast({ prossimi, hue }: DueForecastProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const readoutId = useId();
  const top = niceMax(prossimi.map((d) => d.schede));
  const lines = scaleLines(top);
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
    <div className="grid gap-2">
      <div
        tabIndex={0}
        role="group"
        aria-label={`Schede da ripassare nei prossimi 14 giorni: ${cards(total)}, ${cards(prossimi[0]?.schede ?? 0)} oggi`}
        aria-describedby={readoutId}
        onKeyDown={move}
        className={cn('rounded-md', FOCUS_RING)}
      >
        {/* The labels are the interface's text beside and under the drawing, not SVG text: a drawing scaled to its
            width would scale them too, under 11 px on a phone (Gymnasium spec §5.1, one type language). */}
        <div className={cn('grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-xs leading-none tabular-nums', MUTED_TEXT)}>
          <div aria-hidden className="relative pr-0.5 text-right">
            {/* The widest label, unseen, gives the column its width; the labels sit at their lines' heights. */}
            <span className="invisible block">{formatCount(top)}</span>
            {[0, ...lines].map((value) => (
              <span key={value} className="absolute right-0.5 -translate-y-1/2" style={{ top: share(y(value), HEIGHT) }}>
                {formatCount(value)}
              </span>
            ))}
          </div>
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block h-auto w-full overflow-visible" aria-hidden>
            <rect x={0} y={0} width={pitch} height={HEIGHT} rx={3} className="fill-amber-50 dark:fill-amber-400/10" />
            {lines.map((value) => (
              <line key={value} x1={0} x2={WIDTH} y1={y(value)} y2={y(value)} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth={0.5} strokeDasharray="2 2" />
            ))}
            <line x1={0} x2={WIDTH} y1={BASE} y2={BASE} className="stroke-slate-300 dark:stroke-slate-600" strokeWidth={0.75} />
            {prossimi.map((day, index) => {
              const h = BASE - y(day.schede);
              const today = index === 0;
              return (
                <g key={day.giorno} data-day={day.giorno} onPointerEnter={() => setSelected(index)} onClick={() => setSelected(index)} className="cursor-pointer">
                  {/* The whole column answers, not only the bar: a short bar is still easy to hit. */}
                  <rect x={index * pitch} y={0} width={pitch} height={HEIGHT} fill="transparent" />
                  {day.schede > 0 ? (
                    <rect
                      x={index * pitch + 2}
                      y={BASE - Math.max(h, 1.5)}
                      width={pitch - 4}
                      height={Math.max(h, 1.5)}
                      rx={3}
                      className={cn(
                        today ? 'fill-amber-500 dark:fill-amber-400' : hue === undefined && 'fill-primary-900 dark:fill-primary-300',
                        selected === index && 'opacity-75',
                      )}
                      style={!today && hue !== undefined ? { fill: hue } : undefined}
                    />
                  ) : (
                    // Nothing due: a hollow mark on the base, so the day reads as empty, not as missing.
                    <rect
                      data-empty
                      x={index * pitch + 4}
                      y={BASE - 5}
                      width={pitch - 8}
                      height={4}
                      rx={1.5}
                      fill="none"
                      strokeWidth={selected === index ? 1.25 : 0.75}
                      strokeDasharray="2 1.5"
                      className="stroke-slate-500 dark:stroke-slate-400"
                    />
                  )}
                </g>
              );
            })}
          </svg>
          <span aria-hidden />
          <div aria-hidden className="relative h-3">
            {prossimi.map((day, index) =>
              index % 2 === 0 ? (
                <span
                  key={day.giorno}
                  className={cn('absolute top-0 -translate-x-1/2 whitespace-nowrap', index === 0 && 'font-semibold text-amber-800 dark:text-amber-300')}
                  style={{ left: share(index * pitch + pitch / 2, WIDTH) }}
                >
                  {index === 0 ? 'oggi' : dayDate(day.giorno).getUTCDate()}
                </span>
              ) : null,
            )}
          </div>
        </div>
      </div>
      <p id={readoutId} aria-live="polite" className={cn('min-h-5 text-sm tabular-nums', chosen ? 'text-slate-800 dark:text-slate-100' : MUTED_TEXT)}>
        {chosen ? `${dayName(selected!, chosen.giorno)}: ${cards(chosen.schede)} da ripassare` : 'Tocca una barra per il giorno.'}
      </p>
    </div>
  );
}

/** The chart's place while its read travels: the drawing's proportions, the row of days and the line under it. */
export function DueForecastSkeleton() {
  return (
    <div aria-hidden className="grid gap-2">
      <div className="ml-8 rounded-md bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }} />
      <div className="h-3" />
      <div className="min-h-5" />
    </div>
  );
}
