import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { cn } from '../../../../lib/utils';
import type { GiornoAttivita } from '../../../../types/studia';
import { calendarGrid, describeDay, formatDate, heatLevel } from './layout';
import { FOCUS_RING, HEAT_FILL, INK_TEXT, MUTED_TEXT } from './tokens';

export interface ActivityCalendarProps {
  calendario: GiornoAttivita[];
  today: string;
  weeks: number;
  /** A subject's hue when the dashboard is narrowed to one; the ink scale otherwise. */
  hue?: string;
}

const CELL = 13;
const GAP = 3;
const LEFT = 22;
const TOP = 16;
const PITCH = CELL + GAP;
const ROW_LABELS: Record<number, string> = { 0: 'L', 2: 'M', 4: 'V', 6: 'D' };
const HUE_OPACITY = [0, 0.35, 0.55, 0.78, 1] as const;

/** A point of the drawing as a share of its box, for the labels laid over it. */
const share = (value: number, of: number) => `${(value / of) * 100}%`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The review history as an activity calendar (Studia progress spec §4.4, §6.3): one cell per Rome day,
 * Monday on top, the colour the day's reviews, a dot on a day that counted, a dashed outline on a rest.
 * One tab stop: the arrows move by day (up, down) and by week (left, right), Home and End to the ends;
 * hovering or tapping a day does the same. The line under it says the chosen day.
 */
export function ActivityCalendar({ calendario, today, weeks, hue }: ActivityCalendarProps) {
  const grid = useMemo(() => calendarGrid(calendario, today, weeks), [calendario, today, weeks]);
  const [selected, setSelected] = useState<number | null>(null);
  const readoutId = useId();
  const last = grid.cells.length - 1;
  const chosen = selected === null ? null : grid.cells[Math.min(selected, last)];

  const totals = useMemo(() => {
    let reviews = 0;
    let days = 0;
    for (const cell of grid.cells) {
      if (cell.day && cell.day.ripassi > 0) {
        reviews += cell.day.ripassi;
        days += 1;
      }
    }
    return { reviews, days };
  }, [grid]);

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 };
    let next: number | null = null;
    if (event.key in step) next = (selected ?? last) + step[event.key];
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    setSelected(Math.max(0, Math.min(last, next)));
  };

  const width = LEFT + grid.columns * PITCH;
  const height = TOP + 7 * PITCH;
  const first = grid.cells[0]?.giorno ?? today;
  const summary = `Calendario dei ripassi dal ${formatDate(first)} a oggi: ${plural(totals.reviews, 'ripasso', 'ripassi')} in ${plural(totals.days, 'giorno', 'giorni')}`;

  return (
    <div className="space-y-2">
      <div
        tabIndex={0}
        role="group"
        aria-label={summary}
        aria-describedby={readoutId}
        onKeyDown={move}
        className={cn('rounded-md', FOCUS_RING)}
      >
        {/* The labels are the interface's text laid over the drawing, not SVG text: a drawing scaled to its width
            would scale them too, under 11 px on a narrow one (Gymnasium spec §5.1, one type language). */}
        <div className="relative max-w-[56rem]">
          <div aria-hidden className={cn('pointer-events-none absolute inset-0 whitespace-nowrap text-xs leading-none', MUTED_TEXT)}>
            {Object.entries(ROW_LABELS).map(([row, label]) => (
              <span key={row} className="absolute left-0 -translate-y-1/2" style={{ top: share(TOP + Number(row) * PITCH + CELL / 2, height) }}>
                {label}
              </span>
            ))}
            {grid.months.map((month) => (
              <span key={`${month.column}-${month.label}`} className="absolute top-0" style={{ left: share(LEFT + month.column * PITCH, width) }}>
                {month.label}
              </span>
            ))}
          </div>
          <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" aria-hidden>
            {grid.cells.map((cell, index) => {
              const x = LEFT + cell.column * PITCH;
              const y = TOP + cell.row * PITCH;
              const level = heatLevel(cell.day?.ripassi ?? 0, grid.max);
              const tinted = hue !== undefined && level > 0;
              return (
                <g key={cell.giorno} data-day={cell.giorno} onPointerEnter={() => setSelected(index)} onClick={() => setSelected(index)} className="cursor-pointer">
                  {/* The whole pitch answers, gaps included: on a phone a cell is about 20 px. */}
                  <rect x={x - GAP / 2} y={y - GAP / 2} width={PITCH} height={PITCH} fill="transparent" />
                  <rect
                    x={x}
                    y={y}
                    width={CELL}
                    height={CELL}
                    rx={3}
                    className={cn(!tinted && HEAT_FILL[level], selected === index && 'stroke-slate-900 dark:stroke-white')}
                    style={tinted ? { fill: hue, fillOpacity: HUE_OPACITY[level] } : undefined}
                    strokeWidth={selected === index ? 1.5 : 0}
                  />
                  {cell.day?.riposo && (
                    <rect x={x + 0.75} y={y + 0.75} width={CELL - 1.5} height={CELL - 1.5} rx={2.5} fill="none" strokeWidth={1.2} strokeDasharray="2 1.5" className={cn('stroke-current', INK_TEXT)} />
                  )}
                  {/* In ink on the pale steps, in the ground's colour on the dark ones: readable on every cell. */}
                  {cell.day?.valido && <circle cx={x + CELL / 2} cy={y + CELL / 2} r={1.8} className={level >= 3 && !tinted ? 'fill-white dark:fill-slate-900' : 'fill-primary-900 dark:fill-primary-300'} />}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <div aria-hidden className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs', MUTED_TEXT)}>
        <span className="flex items-center gap-1">
          meno
          {HEAT_FILL.map((fill) => (
            <svg key={fill} viewBox="0 0 10 10" className="h-2.5 w-2.5">
              <rect width="10" height="10" rx="2" className={fill} />
            </svg>
          ))}
          più
        </span>
        <span className="flex items-center gap-1">
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5">
            <rect width="10" height="10" rx="2" className={HEAT_FILL[1]} />
            <circle cx="5" cy="5" r="1.6" className="fill-primary-900 dark:fill-primary-300" />
          </svg>
          obiettivo raggiunto
        </span>
        <span className="flex items-center gap-1">
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5">
            <rect x="0.6" y="0.6" width="8.8" height="8.8" rx="2" fill="none" strokeWidth="1.2" strokeDasharray="2 1.5" className={cn('stroke-current', INK_TEXT)} />
          </svg>
          giorno di riposo
        </span>
      </div>
      <p id={readoutId} aria-live="polite" className={cn('min-h-5 text-sm tabular-nums', chosen ? 'text-slate-800 dark:text-slate-100' : MUTED_TEXT)}>
        {chosen ? describeDay(chosen, today) : 'Passa sopra un giorno, o toccalo, per i dettagli.'}
      </p>
    </div>
  );
}
