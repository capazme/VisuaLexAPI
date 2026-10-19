import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../../../lib/utils';
import type { GiornoAttivita } from '../../../../types/studia';
import { calendarDayState, calendarGrid, describeDay, formatCount, formatDate, heatLevel, type CalendarDayState } from './layout';
import { FOCUS_RING, HEAT_FILL, INK_TEXT, MUTED_TEXT } from './tokens';

export interface ActivityCalendarProps {
  calendario: GiornoAttivita[];
  today: string;
  weeks: number;
  /** A subject's hue when the page is narrowed to one; the ink scale otherwise. */
  hue?: string;
  /** The counts are one subject's (the day's states stay the whole day's): the readout says so. */
  narrowed?: boolean;
}

const CELL = 13;
const GAP = 3;
const LEFT = 22;
const TOP = 16;
const PITCH = CELL + GAP;
const ROW_LABELS: Record<number, string> = { 0: 'L', 2: 'M', 4: 'V', 6: 'D' };
const HUE_OPACITY = [0, 0.35, 0.55, 0.78, 1] as const;

/** The marks of a day's state, each a shape, never a colour alone (progress spec §6.5). */
const DOT = 'fill-primary-900 dark:fill-primary-300';
const DASH = 'stroke-primary-900 dark:stroke-primary-300';
const RING = cn('stroke-current', INK_TEXT);
const TO_COME = 'stroke-slate-500 dark:stroke-slate-400';
/** The tile's ground, drawn under a mark on a subject's hue: no hue lets the ink mark fade (dark mode, the deep steps). */
const HALO = 'stroke-white dark:stroke-slate-900';

/** A point of the drawing as a share of its box, for the labels laid over it. */
const share = (value: number, of: number) => `${(value / of) * 100}%`;

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

/**
 * The mark a day's state adds over its cell: a dot, a dash, a dashed outline. `dark` is a cell of the ink scale's deep
 * steps, where the mark takes the ground's colour. On a subject's hue (`halo`) the mark stays ink over a rim of the
 * ground's colour: the hues differ too much for one colour to read on all of them, in light and dark.
 */
function StateMark({ state, x, y, dark, riposo, halo = false }: { state: CalendarDayState; x: number; y: number; dark: boolean; riposo: boolean; halo?: boolean }) {
  const cx = x + CELL / 2;
  const cy = y + CELL / 2;
  return (
    <>
      {riposo && (
        <>
          {halo && <rect data-halo x={x + 0.75} y={y + 0.75} width={CELL - 1.5} height={CELL - 1.5} rx={2.5} fill="none" strokeWidth={2.6} className={HALO} />}
          <rect x={x + 0.75} y={y + 0.75} width={CELL - 1.5} height={CELL - 1.5} rx={2.5} fill="none" strokeWidth={1.2} strokeDasharray="2 1.5" className={RING} />
        </>
      )}
      {state === 'fatto' && (
        <>
          {halo && <circle data-halo cx={cx} cy={cy} r={2.9} className="fill-white dark:fill-slate-900" />}
          <circle cx={cx} cy={cy} r={1.8} className={dark ? 'fill-white dark:fill-slate-900' : DOT} />
        </>
      )}
      {state === 'saltato' && (
        <>
          {halo && <line data-halo x1={x + 3.5} x2={x + CELL - 3.5} y1={cy} y2={cy} strokeWidth={3.7} strokeLinecap="round" className={HALO} />}
          <line x1={x + 3.5} x2={x + CELL - 3.5} y1={cy} y2={cy} strokeWidth={1.5} strokeLinecap="round" className={dark ? 'stroke-white dark:stroke-slate-900' : DASH} />
        </>
      )}
    </>
  );
}

/** A swatch of the legend, a cell of the calendar at its size. */
function Swatch({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden viewBox={`-2.5 -2.5 ${CELL + 5} ${CELL + 5}`} className="h-4 w-4 shrink-0">
      {children}
    </svg>
  );
}

/**
 * The review history as an activity calendar (Studia progress spec §4.4, §6.3; Gymnasium spec §5.3): one cell per
 * Rome day, Monday on top, the colour the day's reviews, the month over the column it starts in; a dot on a day that
 * counted, a dashed outline on a rest, a dash on a missed day, a ring on today, the rest of this week dotted; a day
 * before the first one studied has no mark, so a newcomer's calendar says nothing is missed. The legend under it says
 * each in words. One tab stop: the arrows move by day (up, down) and by week (left, right), Home and End to the ends;
 * hovering or tapping a day does the same. The line under it says the chosen day, as a screen reader hears it.
 */
export function ActivityCalendar({ calendario, today, weeks, hue, narrowed = false }: ActivityCalendarProps) {
  const grid = useMemo(() => calendarGrid(calendario, today, weeks), [calendario, today, weeks]);
  const firstDay = useMemo(() => calendario.reduce<string | undefined>((first, d) => (first === undefined || d.giorno < first ? d.giorno : first), undefined), [calendario]);
  // The day chosen, by its date: a grid of another width (a window crossing `md`) keeps it, or lets it go if it is out.
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const readoutId = useId();
  const last = grid.cells.length - 1;
  const found = selectedDay === null ? -1 : grid.cells.findIndex((cell) => cell.giorno === selectedDay);
  const selected = found < 0 ? null : found;
  const chosen = selected === null ? null : grid.cells[selected];
  const setSelected = (index: number) => setSelectedDay(grid.cells[index].giorno);

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
  const summary =
    totals.days === 0
      ? `Calendario dei ripassi dal ${formatDate(first)} a oggi: ancora nessun ripasso`
      : `Calendario dei ripassi dal ${formatDate(first)} a oggi: ${plural(totals.reviews, 'ripasso', 'ripassi')} in ${plural(totals.days, 'giorno', 'giorni')}`;

  return (
    <div className="grid gap-3">
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
        <div className="relative">
          <div aria-hidden className={cn('pointer-events-none absolute inset-0 whitespace-nowrap text-xs leading-none', MUTED_TEXT)}>
            {Object.entries(ROW_LABELS).map(([row, label]) => (
              <span key={row} className="absolute left-0 -translate-y-1/2" style={{ top: share(TOP + Number(row) * PITCH + CELL / 2, height) }}>
                {label}
              </span>
            ))}
            {grid.months.map((month) => (
              <span key={`${month.column}-${month.label}`} className="absolute top-0 font-medium text-slate-700 dark:text-slate-200" style={{ left: share(LEFT + month.column * PITCH, width) }}>
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
              const state = calendarDayState(cell, today, firstDay);
              return (
                <g key={cell.giorno} data-day={cell.giorno} data-stato={state} onPointerEnter={() => setSelected(index)} onClick={() => setSelected(index)} className="cursor-pointer">
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
                  <StateMark state={state} x={x} y={y} dark={level >= 3 && !tinted} riposo={cell.day?.riposo === true} halo={tinted} />
                  {cell.giorno === today && <rect x={x - 1.5} y={y - 1.5} width={CELL + 3} height={CELL + 3} rx={4} fill="none" strokeWidth={1.5} className={RING} />}
                </g>
              );
            })}
            {/* The rest of this week: drawn, so the week reads whole, but never chosen. */}
            {grid.future.map((cell) => (
              <rect
                key={cell.giorno}
                data-day={cell.giorno}
                data-stato="futuro"
                x={LEFT + cell.column * PITCH + 0.5}
                y={TOP + cell.row * PITCH + 0.5}
                width={CELL - 1}
                height={CELL - 1}
                rx={2.5}
                fill="none"
                strokeWidth={1}
                strokeDasharray="1.5 1.5"
                className={TO_COME}
              />
            ))}
          </svg>
        </div>
      </div>
      <ul aria-label="Legenda del calendario" className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 text-xs', MUTED_TEXT)}>
        <li className="flex items-center gap-1">
          {/* Drawn as «meno ▢▢▢▢▢ più ripassi»; said as one sentence. */}
          <span aria-hidden className="flex items-center gap-1">
            meno
            {HEAT_FILL.map((fill) => (
              <svg key={fill} viewBox="0 0 10 10" className="h-3 w-3">
                <rect width="10" height="10" rx="2" className={fill} />
              </svg>
            ))}
            più ripassi
          </span>
          <span className="sr-only">Più scuro il colore, più ripassi</span>
        </li>
        <li className="flex items-center gap-1.5">
          <Swatch>
            <rect width={CELL} height={CELL} rx={3} className={HEAT_FILL[1]} />
            <StateMark state="fatto" x={0} y={0} dark={false} riposo={false} />
          </Swatch>
          giorno fatto
        </li>
        <li className="flex items-center gap-1.5">
          <Swatch>
            <rect width={CELL} height={CELL} rx={3} className={HEAT_FILL[0]} />
            <StateMark state="riposo" x={0} y={0} dark={false} riposo />
          </Swatch>
          di riposo
        </li>
        {/* A newcomer's calendar never says «saltato», not even in its legend: there is nothing to miss yet. */}
        {firstDay !== undefined && (
          <li className="flex items-center gap-1.5">
            <Swatch>
              <rect width={CELL} height={CELL} rx={3} className={HEAT_FILL[0]} />
              <StateMark state="saltato" x={0} y={0} dark={false} riposo={false} />
            </Swatch>
            saltato
          </li>
        )}
        <li className="flex items-center gap-1.5">
          <Swatch>
            <rect width={CELL} height={CELL} rx={3} className={HEAT_FILL[0]} />
            <rect x={-1.5} y={-1.5} width={CELL + 3} height={CELL + 3} rx={4} fill="none" strokeWidth={1.5} className={RING} />
          </Swatch>
          oggi
        </li>
        <li className="flex items-center gap-1.5">
          <Swatch>
            <rect x={0.5} y={0.5} width={CELL - 1} height={CELL - 1} rx={2.5} fill="none" strokeWidth={1} strokeDasharray="1.5 1.5" className={TO_COME} />
          </Swatch>
          a venire
        </li>
      </ul>
      {/* Room for its longest day («Oggi, mercoledì 30 settembre: 9999 ripassi, 200 nuove, 1450 sbagliate, obiettivo
          raggiunto»): three lines on a phone, two from `md`, so choosing a day never moves the page. */}
      <p id={readoutId} aria-live="polite" className={cn('min-h-[3.75rem] text-sm tabular-nums md:min-h-10', chosen ? 'text-slate-800 dark:text-slate-100' : MUTED_TEXT)}>
        {chosen ? describeDay(chosen, today, firstDay, narrowed) : 'Passa sopra un giorno o toccalo per i dettagli; con la tastiera, le frecce ti spostano tra i giorni.'}
      </p>
    </div>
  );
}

/** The calendar's place while its read travels: the drawing's own proportions, the legend's and the line's height. */
export function ActivityCalendarSkeleton({ weeks }: { weeks: number }) {
  return (
    <div aria-hidden className="grid gap-3">
      <div className="w-full rounded-md bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" style={{ aspectRatio: `${LEFT + weeks * PITCH} / ${TOP + 7 * PITCH}` }} />
      <div className="h-10 md:h-4" />
      <div className="min-h-[3.75rem] md:min-h-10" />
    </div>
  );
}
