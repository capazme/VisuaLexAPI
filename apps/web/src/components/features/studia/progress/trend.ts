import type { GiornoAttivita } from '../../../../types/studia';
import { addDays, calendarDayState, dayDate, formatCount, weekday, type CalendarDayState } from './layout';

/**
 * The review trend of «Progressi» (G7), pure: the points of a period, its total and its change on the period before,
 * the round scale, and the curve — smooth but honest, resampled to a fixed number of points so one period's curve can
 * bend into another's. Days are the server's Rome days, walked as calendar days (`layout.ts`).
 */

export type TrendPeriod = '7g' | '30g' | '6m';

export const TREND_PERIODS: { id: TrendPeriod; label: string }[] = [
  { id: '7g', label: '7 giorni' },
  { id: '30g', label: '30 giorni' },
  { id: '6m', label: '6 mesi' },
];

/** The six months are the server's 26 weeks, drawn by week: by day they would be unreadable. */
export const TREND_WEEKS = 26;

export interface TrendPoint {
  /** The day, or the Monday of the week. */
  giorno: string;
  /** The week's last day drawn (today for this week), for a week's point. */
  fino?: string;
  ripassi: number;
  /** A day's state as the calendar named it; a week has none. */
  stato?: CalendarDayState;
  /** What the server said of the day, for the line that describes it. */
  day?: GiornoAttivita | null;
}

export interface TrendSeries {
  period: TrendPeriod;
  points: TrendPoint[];
  /** By week (six months) or by day. */
  byWeek: boolean;
  total: number;
  /** The change on the period before of the same length, in whole percent; null when that period has no reviews. */
  change: number | null;
  /** The days not done, at their place along the period (0 the first day, 1 the last): ticks under the axis. */
  missed: number[];
  /** The goal a point reaches: the day's, or seven days' for a week. */
  goal: number;
}

const sumDays = (byDay: Map<string, GiornoAttivita>, from: string, to: string) => {
  let total = 0;
  for (let giorno = from; giorno <= to; giorno = addDays(giorno, 1)) total += byDay.get(giorno)?.ripassi ?? 0;
  return total;
};

/**
 * The points of `period` ending `today`: one per day for 7 and 30 days, one per week (Monday to Sunday, this week up
 * to today) for six months. `goal` is the day's goal; a week's is seven times it.
 */
export function trendSeries(calendario: GiornoAttivita[], today: string, period: TrendPeriod, goal: number): TrendSeries {
  const byDay = new Map(calendario.map((d) => [d.giorno, d]));
  const firstDay = calendario.reduce<string | undefined>((first, d) => (first === undefined || d.giorno < first ? d.giorno : first), undefined);

  if (period === '6m') {
    const start = addDays(today, -weekday(today) - (TREND_WEEKS - 1) * 7);
    const points: TrendPoint[] = [];
    for (let week = 0; week < TREND_WEEKS; week += 1) {
      const giorno = addDays(start, week * 7);
      const sunday = addDays(giorno, 6);
      const fino = sunday > today ? today : sunday;
      points.push({ giorno, fino, ripassi: sumDays(byDay, giorno, fino) });
    }
    const span = (Date.parse(today) - Date.parse(start)) / 86_400_000;
    return {
      period,
      points,
      byWeek: true,
      total: points.reduce((n, p) => n + p.ripassi, 0),
      // The server keeps 26 weeks: there is no period before to compare with.
      change: null,
      missed: missedDays(byDay, start, today, firstDay).map((giorno) => (span > 0 ? (Date.parse(giorno) - Date.parse(start)) / 86_400_000 / span : 0)),
      goal: goal * 7,
    };
  }

  const days = period === '7g' ? 7 : 30;
  const start = addDays(today, -(days - 1));
  const points: TrendPoint[] = [];
  for (let i = 0; i < days; i += 1) {
    const giorno = addDays(start, i);
    const day = byDay.get(giorno) ?? null;
    points.push({ giorno, ripassi: day?.ripassi ?? 0, day, stato: calendarDayState({ giorno, day, column: 0, row: 0 }, today, firstDay) });
  }
  const total = points.reduce((n, p) => n + p.ripassi, 0);
  const before = sumDays(byDay, addDays(start, -days), addDays(start, -1));
  return {
    period,
    points,
    byWeek: false,
    total,
    change: before > 0 ? Math.round(((total - before) / before) * 100) : null,
    missed: points.flatMap((p, i) => (p.stato === 'saltato' ? [days > 1 ? i / (days - 1) : 0] : [])),
    goal,
  };
}

function missedDays(byDay: Map<string, GiornoAttivita>, from: string, today: string, firstDay: string | undefined): string[] {
  const missed: string[] = [];
  for (let giorno = from; giorno <= today; giorno = addDays(giorno, 1)) {
    if (calendarDayState({ giorno, day: byDay.get(giorno) ?? null, column: 0, row: 0 }, today, firstDay) === 'saltato') missed.push(giorno);
  }
  return missed;
}

/**
 * A round scale with four ticks, 0 included (0 / 5 / 10 / 15): its top covers the highest point and the goal, and its
 * step is 1, 2, 2.5 or 5 times a power of ten, so no tick reads 667.
 */
export function trendScale(values: number[], goal: number): number[] {
  const top = Math.max(goal, ...values, 1);
  const raw = top / 3;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s * 3 >= top && Number.isInteger(s)) ?? Math.ceil(raw);
  return [0, step, step * 2, step * 3];
}

/** How many points every curve is drawn with: one period's bends into another's point by point. */
export const CURVE_SAMPLES = 97;

/**
 * The values at `CURVE_SAMPLES` evenly spaced places along the points, through a monotone cubic curve (Fritsch and
 * Carlson): between two points it never goes above the higher nor below the lower, so it invents no peak, never goes
 * under zero, and a flat stretch stays flat.
 */
export function resampleMonotone(values: number[], samples = CURVE_SAMPLES): number[] {
  const n = values.length;
  if (n === 0) return Array.from({ length: samples }, () => 0);
  if (n === 1) return Array.from({ length: samples }, () => values[0]);
  const slopes = values.slice(1).map((v, i) => v - values[i]);
  const tangents = values.map((_, i) => {
    if (i === 0) return slopes[0];
    if (i === n - 1) return slopes[n - 2];
    const a = slopes[i - 1];
    const b = slopes[i];
    return a * b <= 0 ? 0 : (a + b) / 2;
  });
  // Fritsch–Carlson: tangents kept inside the circle of radius 3 of each segment's slope, so the curve stays monotone.
  for (let i = 0; i < n - 1; i += 1) {
    if (slopes[i] === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i] / slopes[i];
    const b = tangents[i + 1] / slopes[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      tangents[i] = (3 * a * slopes[i]) / h;
      tangents[i + 1] = (3 * b * slopes[i]) / h;
    }
  }
  return Array.from({ length: samples }, (_, s) => {
    const x = (s / (samples - 1)) * (n - 1);
    const i = Math.min(n - 2, Math.floor(x));
    const t = x - i;
    const t2 = t * t;
    const t3 = t2 * t;
    const value =
      (2 * t3 - 3 * t2 + 1) * values[i] + (t3 - 2 * t2 + t) * tangents[i] + (-2 * t3 + 3 * t2) * values[i + 1] + (t3 - t2) * tangents[i + 1];
    // A float's last digit is no reason to go under zero.
    return Math.max(0, value);
  });
}

/** The line and the area under it, as paths of `CURVE_SAMPLES` points in a box `width` × `height` over a scale to `top`. */
export function curvePaths(values: number[], width: number, height: number, top: number): { line: string; area: string } {
  const samples = resampleMonotone(values);
  const at = samples.map((v, s) => `${((s / (samples.length - 1)) * width).toFixed(2)},${(height - (v / top) * height).toFixed(2)}`);
  const line = `M${at.join('L')}`;
  return { line, area: `${line}L${width.toFixed(2)},${height.toFixed(2)}L0.00,${height.toFixed(2)}Z` };
}

/** «mar 14 ott». */
export const shortDate = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
/** «14 ott». */
export const dayMonth = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const reviews = (n: number) => `${formatCount(n)} ${n === 1 ? 'ripasso' : 'ripassi'}`;

/** What a day's state adds to its label; nothing for a day before the first one studied. */
export const STATE_WORDS: Partial<Record<NonNullable<TrendPoint['stato']>, string>> = {
  fatto: 'obiettivo raggiunto',
  riposo: 'giorno di riposo',
  saltato: 'non fatto',
  oggi: 'oggi',
};

/** The cursor's label: «mar 14 ott · 12 ripassi · obiettivo raggiunto», «settimana dal 6 ott · 54 ripassi». */
export function pointLabel(point: TrendPoint, byWeek: boolean): string {
  if (byWeek) return `settimana dal ${dayMonth.format(dayDate(point.giorno))} · ${reviews(point.ripassi)}`;
  const state = point.stato ? STATE_WORDS[point.stato] : undefined;
  return [shortDate.format(dayDate(point.giorno)), reviews(point.ripassi), state].filter(Boolean).join(' · ');
}

