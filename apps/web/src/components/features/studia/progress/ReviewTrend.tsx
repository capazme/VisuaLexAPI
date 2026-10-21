import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, LayoutGroup, animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { ease, spring } from '../../../../lib/motion';
import type { GiornoAttivita } from '../../../../types/studia';
import { dayDate, describeDay, formatCount, formatDate } from './layout';
import { FOCUS_RING, INK_TEXT, MUTED_TEXT, SUCCESS_TEXT } from './tokens';
import { STATE_WORDS, TREND_PERIODS, curvePaths, dayMonth, pointLabel, shortDate, trendScale, trendSeries, type TrendPeriod, type TrendSeries } from './trend';

/**
 * «Il tuo andamento» (G7), in place of the calendar: the reviews of a period as a line — by day for 7 and 30 days, by
 * week for six months —, the area under it a wash of its colour, the goal a dashed line, the days not done small ticks
 * under the axis. Over it, the period's total and its change on the period before. Inspired by Animorio's «grafico che
 * si disegna», written from scratch in SVG with Framer Motion: on opening the line draws from the left in 900 ms while
 * the total counts up; another period bends the curve into its shape in 500 ms (every curve has the same number of
 * points) while the pill slides under it and the numbers fade; a cursor follows the pointer or the finger with a
 * spring, the line full up to it and lighter after. Under reduced motion everything is drawn at once and changes at
 * once. The drawing is as wide as the card, in pixels, so its words keep their size on a phone.
 */

export interface ReviewTrendProps {
  calendario: GiornoAttivita[];
  today: string;
  /** The day's goal (`oggi.obiettivo`). */
  obiettivo: number;
  /** A subject's hue when the page is narrowed to one; the app's ink otherwise. */
  hue?: string;
  /** The counts are one subject's (the days' states and the goal stay the whole day's). */
  narrowed?: boolean;
  /** The period shown, kept by the page: a subject read anew mounts the chart again on the same period. */
  period: TrendPeriod;
  onPeriod: (period: TrendPeriod) => void;
  /** Play the opening (the line drawn from the left, the total counting up): the first time the page shows it. */
  intro: boolean;
  /** Told when the opening starts, so the page plays it once. */
  onIntro?: () => void;
}

/**
 * The plot's margins: the scale on the left (room for «3.000»), the goal's name on the right, at the end of its line
 * where it covers no point, the days and the ticks of the days not done under it.
 */
const PAD = { left: 44, right: 64, top: 14, bottom: 30 };
const DRAW_S = 0.9;
const BEND_S = 0.5;
const FADE_S = 0.15;

const monthName = new Intl.DateTimeFormat('it-IT', { month: 'short', timeZone: 'UTC' });

const reviews = (n: number) => `${formatCount(n)} ${n === 1 ? 'ripasso' : 'ripassi'}`;

const PERIOD_WORDS: Record<TrendPeriod, { total: string; before: string; summary: string }> = {
  '7g': { total: 'negli ultimi 7 giorni', before: 'sui 7 giorni prima', summary: 'al giorno negli ultimi 7 giorni' },
  '30g': { total: 'negli ultimi 30 giorni', before: 'sui 30 giorni prima', summary: 'al giorno negli ultimi 30 giorni' },
  '6m': { total: 'negli ultimi 6 mesi', before: '', summary: 'a settimana negli ultimi 6 mesi' },
};

/** The change on the period before, in words: «+18% sui 30 giorni prima». */
function changeWords(change: number, before: string): string {
  if (change === 0) return `come ${before.replace(/^sui /, 'nei ')}`;
  return `${change > 0 ? '+' : '−'}${Math.abs(change)}% ${before}`;
}

/** The labels under the axis: each day of a week, a date each week of a month, each month of six. */
function axisLabels(series: TrendSeries, plotWidth: number): { index: number; text: string }[] {
  const n = series.points.length;
  if (series.byWeek) {
    const labels: { index: number; text: string }[] = [];
    series.points.forEach((p, index) => {
      const month = monthName.format(dayDate(p.giorno));
      if (index === 0 || month !== monthName.format(dayDate(series.points[index - 1].giorno))) labels.push({ index, text: month });
    });
    // The first one, a week into a month, would sit on the second.
    return labels.length > 1 && labels[1].index - labels[0].index < 3 ? labels.slice(1) : labels;
  }
  if (n <= 7) {
    // Room for «mer 21» under each day, or only its number.
    const roomy = plotWidth / n >= 52;
    return series.points.map((p, index) => ({ index, text: roomy ? shortDate.format(dayDate(p.giorno)).replace(/ \S+$/, '') : String(dayDate(p.giorno).getUTCDate()) }));
  }
  // A date each week, counted back from today; each other week where a week is narrower than a date and its room.
  const every = (7 / (n - 1)) * plotWidth >= 64 ? 7 : 14;
  return series.points.flatMap((p, index) => ((n - 1 - index) % every === 0 ? [{ index, text: dayMonth.format(dayDate(p.giorno)) }] : []));
}

/** The card's width in pixels, followed as the window changes. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** The total: it counts up from zero on opening (900 ms), and fades into a new value after. */
function Total({ value, count }: { value: number; count: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!count || !ref.current) return;
    const el = ref.current;
    const controls = animate(0, value, { duration: DRAW_S, ease: ease.out, onUpdate: (v) => (el.textContent = formatCount(Math.round(v))) });
    return () => controls.stop();
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <span ref={ref}>{formatCount(count ? 0 : value)}</span>;
}

export function ReviewTrend({ calendario, today, obiettivo, hue, narrowed = false, period, onPeriod, intro, onIntro }: ReviewTrendProps) {
  const still = useReducedMotion() ?? false;
  const uid = useId();
  const series = useMemo(() => trendSeries(calendario, today, period, obiettivo), [calendario, today, period, obiettivo]);
  const { ref: boxRef, width: measured } = useWidth();
  // Before it is measured (and in a test's DOM), a width of a card on a laptop.
  const width = measured > 0 ? measured : 640;
  const height = width < 520 ? 190 : 230;
  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const values = series.points.map((p) => p.ripassi);
  const ticks = trendScale(values, series.goal);
  const top = ticks[3];
  const { line, area } = curvePaths(values, plotW, plotH, top);
  const n = series.points.length;
  const xOf = (index: number) => (n > 1 ? (index / (n - 1)) * plotW : plotW / 2);
  const yOf = (v: number) => plotH - (v / top) * plotH;

  // A change of width redraws at once; a change of period or subject bends.
  const lastWidth = useRef(width);
  const resized = lastWidth.current !== width;
  useEffect(() => {
    lastWidth.current = width;
  });
  const bend = still || resized ? { duration: 0 } : { duration: BEND_S, ease: ease.inOut };

  // The opening: the line draws from the left while the total counts up; once for the page. The clip's width is an
  // attribute (a transform inside a clip path is not drawn alike everywhere), the plot's once drawn.
  const [opened] = useState(() => intro && !still);
  const drawnW = useMotionValue(opened ? 0 : plotW + 8);
  const drawing = useRef(opened);
  useEffect(() => {
    if (!opened) return;
    onIntro?.();
    const controls = animate(drawnW, plotW + 8, { duration: DRAW_S, ease: ease.out, onComplete: () => (drawing.current = false) });
    return () => controls.stop();
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!drawing.current) drawnW.set(plotW + 8);
  }, [plotW, drawnW]);

  // The cursor: the point chosen, by index; the line is full up to it and lighter after.
  const [active, setActive] = useState<number | null>(null);
  const chosen = active !== null && active < n ? active : null;
  const target = useMotionValue(plotW);
  const targetY = useMotionValue(plotH);
  // The app's quick spring (`lib/motion.ts`), never one typed here.
  const followX = useSpring(target, spring.snappy);
  const followY = useSpring(targetY, spring.snappy);
  // Under reduced motion the cursor jumps.
  const springX = still ? target : followX;
  const springY = still ? targetY : followY;
  // The full line ends where the cursor is (its clip starts 4 px before the plot, for the line's cap).
  const solidW = useTransform(springX, (x) => x + 4);
  const wasChosen = useRef(false);
  useEffect(() => {
    if (chosen === null) {
      // No cursor: the line full at once, also after a resize.
      target.set(plotW);
      followX.jump(plotW);
      wasChosen.current = false;
      return;
    }
    target.set(xOf(chosen));
    targetY.set(yOf(series.points[chosen].ripassi));
    // Coming in, the cursor appears on its point; it glides only from one point to the next.
    if (!wasChosen.current) {
      followX.jump(xOf(chosen));
      followY.jump(yOf(series.points[chosen].ripassi));
    }
    wasChosen.current = true;
    // `xOf` and `yOf` follow `plotW`, `n` and `top`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, plotW, n, top, series]);

  // The hidden line speaks for the keyboard only: a pointer moving over the chart would flood a screen reader.
  const [byKeys, setByKeys] = useState(false);
  const pick = (event: ReactPointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left;
    setByKeys(false);
    setActive(Math.max(0, Math.min(n - 1, Math.round((x / Math.max(1, box.width)) * (n - 1)))));
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = (chosen ?? n) - 1;
    else if (event.key === 'ArrowRight') next = (chosen ?? -1) + 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = n - 1;
    if (next === null) return;
    event.preventDefault();
    setByKeys(true);
    setActive(Math.max(0, Math.min(n - 1, next)));
  };

  // The total counts up once, on opening, from its first value; after that its new values fade in.
  const [openingTotal] = useState(() => `${period}-${series.total}`);
  const choosePeriod = (next: TrendPeriod) => {
    onPeriod(next);
    setActive(null);
  };
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = TREND_PERIODS.length - 1;
    const to = event.key === 'ArrowRight' ? (index + 1) % (last + 1) : event.key === 'ArrowLeft' ? (index + last) % (last + 1) : event.key === 'Home' ? 0 : event.key === 'End' ? last : null;
    if (to === null) return;
    event.preventDefault();
    choosePeriod(TREND_PERIODS[to].id);
    document.getElementById(`${uid}-tab-${TREND_PERIODS[to].id}`)?.focus();
  };

  const words = PERIOD_WORDS[period];
  const labels = axisLabels(series, plotW);
  const readout =
    chosen === null || !byKeys
      ? null
      : series.byWeek
        ? // «Settimana dal 12 ott: 54 ripassi», «Settimana in corso: 8 ripassi».
          pointLabel(series.points[chosen], true).replace(/^s/, 'S').replace(' · ', ': ')
        : describeDay({ giorno: series.points[chosen].giorno, day: series.points[chosen].day ?? null, column: 0, row: 0 }, today, calendario.reduce<string | undefined>((f, d) => (f === undefined || d.giorno < f ? d.giorno : f), undefined), narrowed);
  const tint = hue === undefined ? 'text-primary-600 dark:text-primary-400' : undefined;
  const ink = hue === undefined ? 'stroke-primary-600 dark:stroke-primary-400' : undefined;
  // A subject's hue, a fifth darker on the light card (`--vlx-trend-shade`, `index.css`): some hues are under 3:1 on
  // white as they are (amministrativo 2.1:1); the wash under the line keeps the hue itself.
  const lineHue = hue === undefined ? undefined : `color-mix(in oklab, ${hue}, var(--vlx-trend-shade))`;
  const summary = `Ripassi ${words.summary}: ${reviews(series.total)} in tutto; obiettivo ${formatCount(series.goal)} ${series.byWeek ? 'a settimana' : 'al giorno'}`;
  const panelId = `${uid}-panel`;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid gap-1">
          {/* The numbers fade into new ones; the total counts up only on opening. */}
          <p className={cn('font-serif text-4xl font-medium leading-none tabular-nums', INK_TEXT)}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={`${period}-${series.total}`} className="inline-block" initial={still ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={still ? undefined : { opacity: 0 }} transition={{ duration: FADE_S }}>
                <Total value={series.total} count={opened && `${period}-${series.total}` === openingTotal} />
              </motion.span>
            </AnimatePresence>
          </p>
          <p className={cn('text-sm', MUTED_TEXT)}>
            {series.total === 1 ? 'ripasso' : 'ripassi'} {words.total}
            {series.change !== null && (
              <>
                {' · '}
                {/* Up in green, down in ink: Gymnasium does not scold. */}
                <span className={cn('font-medium', series.change > 0 ? SUCCESS_TEXT : 'text-slate-600 dark:text-slate-300')}>{changeWords(series.change, words.before)}</span>
              </>
            )}
          </p>
        </div>
        <LayoutGroup id={`${uid}-periods`}>
          <div role="tablist" aria-label="Periodo" className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {TREND_PERIODS.map((p, index) => {
              const selected = p.id === period;
              return (
                <button
                  key={p.id}
                  id={`${uid}-tab-${p.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={panelId}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => choosePeriod(p.id)}
                  onKeyDown={(event) => onTabKey(event, index)}
                  className={cn('relative min-h-[44px] rounded-lg px-3 text-sm font-medium transition-colors', selected ? 'text-slate-900 dark:text-slate-50' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-50', FOCUS_RING)}
                >
                  {selected && (
                    <motion.span
                      layoutId="pill"
                      aria-hidden
                      className="absolute inset-0 rounded-lg bg-white shadow-sm dark:bg-slate-900"
                      transition={still ? { duration: 0 } : { duration: BEND_S, ease: ease.inOut }}
                    />
                  )}
                  <span className="relative">{p.label}</span>
                </button>
              );
            })}
          </div>
        </LayoutGroup>
      </div>

      <div ref={boxRef} id={panelId} role="tabpanel" aria-labelledby={`${uid}-tab-${period}`} className="min-w-0">
        {/* A finger moving sideways moves the cursor; up and down, the page still scrolls (`touch-action` on the
            drawing itself: an SVG shape does not take it). */}
        <div tabIndex={0} role="group" aria-label={summary} aria-describedby={`${uid}-readout`} onKeyDown={onKey} className={cn('relative touch-pan-y rounded-md', FOCUS_RING)}>
          <svg width={width} height={height} className="block touch-pan-y overflow-visible" aria-hidden>
            <defs>
              {/* The wash under the line, set in CSS (`stop-color` reads no variable as an attribute): the line's own
                  colour through `currentColor`, from 18% at the top to nothing at the base. */}
              <linearGradient id={`${uid}-wash`} x1="0" x2="0" y1="0" y2="1" className={tint} style={hue ? { color: hue } : undefined}>
                <stop offset="0" style={{ stopColor: 'currentColor', stopOpacity: 0.18 }} />
                <stop offset="1" style={{ stopColor: 'currentColor', stopOpacity: 0 }} />
              </linearGradient>
              <clipPath id={`${uid}-drawn`}>
                <motion.rect x={-4} y={-PAD.top} width={drawnW} height={height + 8} />
              </clipPath>
              <clipPath id={`${uid}-solid`}>
                <motion.rect x={-4} y={-PAD.top} height={height + 8} width={solidW} />
              </clipPath>
            </defs>
            <g transform={`translate(${PAD.left},${PAD.top})`}>
              {/* The scale: hairlines at the round ticks, the base a step darker. */}
              {ticks.map((tick) => (
                <g key={tick}>
                  <line x1={0} x2={plotW} y1={yOf(tick)} y2={yOf(tick)} strokeWidth={1} className={tick === 0 ? 'stroke-slate-300 dark:stroke-slate-600' : 'stroke-slate-200 dark:stroke-slate-800'} />
                </g>
              ))}

              {/* The goal: what tells «how am I doing». */}
              {series.goal > 0 && (
                <g data-goal>
                  <line x1={0} x2={plotW} y1={yOf(series.goal)} y2={yOf(series.goal)} strokeWidth={1} strokeDasharray="4 4" className="stroke-slate-500 dark:stroke-slate-400" />
                </g>
              )}

              <g clipPath={`url(#${uid}-drawn)`}>
                <motion.path data-area initial={false} animate={{ d: area }} transition={bend} fill={`url(#${uid}-wash)`} />
                {/* Lighter after the cursor, full up to it. */}
                <motion.path initial={false} animate={{ d: line }} transition={bend} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cn(ink, 'opacity-35')} style={lineHue ? { stroke: lineHue } : undefined} />
                <g clipPath={`url(#${uid}-solid)`}>
                  <motion.path data-line initial={false} animate={{ d: line }} transition={bend} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={ink} style={lineHue ? { stroke: lineHue } : undefined} />
                </g>
              </g>

              {/* The days not done, small ticks under the axis: what the calendar said, kept. */}
              {series.missed.map((at, index) => (
                <line key={index} data-missed x1={at * plotW} x2={at * plotW} y1={plotH + 4} y2={plotH + 9} strokeWidth={1.5} strokeLinecap="round" className="stroke-slate-500 dark:stroke-slate-400" />
              ))}

              {/* The cursor: a hairline and a dot ringed in the card's colour. */}
              <motion.g style={{ x: springX, opacity: chosen === null ? 0 : 1 }}>
                <line x1={0} x2={0} y1={0} y2={plotH} strokeWidth={1} className="stroke-slate-400 dark:stroke-slate-500" />
              </motion.g>
              <motion.circle
                r={5}
                cx={springX}
                cy={springY}
                style={{ opacity: chosen === null ? 0 : 1, ...(lineHue ? { fill: lineHue } : {}) }}
                strokeWidth={2}
                className={cn('stroke-white dark:stroke-slate-900', hue === undefined && 'fill-primary-600 dark:fill-primary-400')}
              />

              {/* Pointer and finger: the whole plot answers; a finger moving sideways moves the cursor while the page
                  still scrolls up and down. */}
              <rect
                x={0}
                y={-PAD.top}
                width={plotW}
                height={plotH + PAD.top}
                fill="transparent"
                onPointerMove={pick}
                onPointerDown={pick}
                onPointerLeave={(event) => event.pointerType === 'mouse' && setActive(null)}
              />
            </g>
          </svg>
          {/* The scale, the goal's name and the days are the interface's text laid over the drawing, in its pixels, not
              SVG text (Gymnasium spec §5.1, one type language). */}
          <div aria-hidden className={cn('pointer-events-none absolute inset-0 text-xs leading-none tabular-nums', MUTED_TEXT)}>
            {ticks.map((tick) => (
              <span key={tick} className="absolute -translate-y-1/2 text-right" style={{ left: 0, width: PAD.left - 8, top: PAD.top + yOf(tick) }}>
                {formatCount(tick)}
              </span>
            ))}
            {series.goal > 0 && (
              // At the end of its line, in the margin: it covers no point.
              <span className="absolute -translate-y-1/2 text-slate-600 dark:text-slate-300" style={{ left: PAD.left + plotW + 6, top: PAD.top + yOf(series.goal) }}>
                obiettivo
              </span>
            )}
            {labels.map(({ index, text }) => {
              const x = xOf(index);
              return (
                <span
                  key={`${index}-${text}`}
                  className={cn('absolute whitespace-nowrap', x < 24 ? '' : x > plotW - 24 ? '-translate-x-full' : '-translate-x-1/2')}
                  style={{ left: PAD.left + x, top: PAD.top + plotH + 14 }}
                >
                  {text}
                </span>
              );
            })}
          </div>
          {/* The cursor's label, the interface's text over the drawing. */}
          {chosen !== null && (
            <motion.div aria-hidden className="pointer-events-none absolute top-0" style={{ left: PAD.left, x: springX }}>
              <span
                className={cn(
                  'absolute top-0 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-800 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
                  xOf(chosen) < plotW * 0.25 ? 'left-0' : xOf(chosen) > plotW * 0.75 ? 'right-0' : '-translate-x-1/2',
                )}
              >
                {pointLabel(series.points[chosen], series.byWeek)}
              </span>
            </motion.div>
          )}
        </div>
        <p id={`${uid}-readout`} aria-live="polite" className="sr-only">
          {readout ?? ''}
        </p>
      </div>

      <details className="group text-sm">
        <summary className={cn('inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1 rounded-md font-medium text-primary-900 dark:text-primary-200 [&::-webkit-details-marker]:hidden', FOCUS_RING)}>
          <ChevronRight aria-hidden size={16} className="transition-transform group-open:rotate-90 motion-reduce:transition-none" />
          Vedi i numeri
        </summary>
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-left tabular-nums">
            <caption className="sr-only">Ripassi {words.summary}</caption>
            <thead>
              <tr className={MUTED_TEXT}>
                <th scope="col" className="py-1.5 pr-4 font-medium">{series.byWeek ? 'Settimana dal' : 'Giorno'}</th>
                <th scope="col" className="py-1.5 pr-4 font-medium">Ripassi</th>
                {!series.byWeek && <th scope="col" className="py-1.5 font-medium">Stato</th>}
              </tr>
            </thead>
            <tbody>
              {[...series.points].reverse().map((p) => (
                <tr key={p.giorno} className="border-t border-slate-100 dark:border-slate-800">
                  <th scope="row" className="py-1.5 pr-4 font-normal">{series.byWeek ? formatDate(p.giorno) : shortDate.format(dayDate(p.giorno))}</th>
                  <td className="py-1.5 pr-4">{formatCount(p.ripassi)}</td>
                  {!series.byWeek && <td className={cn('py-1.5', MUTED_TEXT)}>{(p.stato && STATE_WORDS[p.stato]) ?? ''}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** The chart's place while its read travels: the header's and the drawing's heights. */
export function ReviewTrendSkeleton() {
  return (
    // As tall as the chart will be on this card: 190 px under 520 px of card, 230 above (a container query).
    <div aria-hidden className="@container grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="h-[3.75rem] w-44 rounded-lg bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" />
        <div className="h-[52px] w-64 rounded-xl bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" />
      </div>
      <div className="h-[190px] rounded-md bg-slate-100 motion-safe:animate-pulse @min-[520px]:h-[230px] dark:bg-slate-800" />
      <div className="h-11" />
    </div>
  );
}
