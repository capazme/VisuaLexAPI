/**
 * The year of a case-law row, for every source alike (case-law section spec, D4): a source's rows
 * are read into `{ year, date? }`, counted per year, narrowed by a range and put in order. Pure:
 * a source says how to read its own rows (`YearsOf`), nothing here knows Brocardi, the Massimario
 * or the Cassazione.
 *
 * A row has no year, one, or several (a Massimario passage cites several decisions): it passes a
 * range when any of its years does, and a row with no year passes only while no range is set.
 */

export interface RowYear {
  year: number;
  /** The exact day (`YYYY-MM-DD`) when the source gives it. */
  date?: string;
}

export interface YearRange {
  from?: number;
  to?: number;
}

export type YearOrder = 'desc' | 'asc';

export interface YearCount {
  year: number;
  n: number;
  /** The source's own count, not the loaded rows', and not exact (the Cassazione's index, before its re-check). */
  approx?: boolean;
}

/** How a source reads one of its rows. */
export type YearsOf<T> = (row: T) => RowYear[];

const YEAR = /^\d{4}$/;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** A four-digit year typed or written by a source, else null. */
export function parseYear(value: string | number | null | undefined): number | null {
  const text = typeof value === 'number' ? String(value) : value?.trim();
  return text && YEAR.test(text) ? Number(text) : null;
}

/** A row's year from what its source has: the exact date wins, else the year; none → []. */
export function rowYear({ year, date }: { year?: string | number | null; date?: string | null }): RowYear[] {
  const day = date ? ISO_DAY.exec(date) : null;
  if (day) return [{ year: Number(day[1]), date: `${day[1]}-${day[2]}-${day[3]}` }];
  const plain = parseYear(year);
  return plain === null ? [] : [{ year: plain }];
}

export function isRangeSet(range: YearRange): boolean {
  return range.from !== undefined || range.to !== undefined;
}

/** A range typed the wrong way round (from after to) reads as the same years the right way round. */
export function normalizeRange({ from, to }: YearRange): YearRange {
  return from !== undefined && to !== undefined && from > to ? { from: to, to: from } : { from, to };
}

export function inRange(years: readonly RowYear[], range: YearRange): boolean {
  if (!isRangeSet(range)) return true;
  const { from, to } = normalizeRange(range);
  return years.some(({ year }) => (from === undefined || year >= from) && (to === undefined || year <= to));
}

export function filterByRange<T>(rows: readonly T[], yearsOf: YearsOf<T>, range: YearRange): T[] {
  return isRangeSet(range) ? rows.filter((row) => inRange(yearsOf(row), range)) : [...rows];
}

/** Every distinct year of every row, flat: what a source reports so the section can count. */
export function yearList<T>(rows: readonly T[], yearsOf: YearsOf<T>): number[] {
  return rows.flatMap((row) => [...new Set(yearsOf(row).map((y) => y.year))]);
}

/** How many times each year appears in `years`, in the order asked (newest first by default). */
export function countByYear(years: readonly number[], order: YearOrder = 'desc'): YearCount[] {
  const counts = new Map<number, number>();
  for (const year of years) counts.set(year, (counts.get(year) ?? 0) + 1);
  return [...counts.entries()]
    .map(([year, n]) => ({ year, n }))
    .sort((a, b) => (order === 'desc' ? b.year - a.year : a.year - b.year));
}

/** The years of the rows a source has loaded, counted: what it reports when it has no counts of its own. */
export function yearCounts<T>(rows: readonly T[], yearsOf: YearsOf<T>): YearCount[] {
  return countByYear(yearList(rows, yearsOf));
}

/** The counts of every block together, a year once, in the order asked. A year is approximate when any block says so. */
export function mergeYearCounts(blocks: readonly (readonly YearCount[])[], order: YearOrder = 'desc'): YearCount[] {
  const merged = new Map<number, YearCount>();
  for (const { year, n, approx } of blocks.flat()) {
    const held = merged.get(year);
    merged.set(year, { year, n: (held?.n ?? 0) + n, ...(approx || held?.approx ? { approx: true } : {}) });
  }
  return [...merged.values()].sort((a, b) => (order === 'desc' ? b.year - a.year : a.year - b.year));
}

/**
 * A year and, when known, the day, as one number to compare: 2026-09-01 → 20260901, 2026 → 20260000.
 * A row with several years sits where it is first met: by its newest newest-first, by its oldest oldest-first.
 */
function sortKey(years: readonly RowYear[], order: YearOrder): number | null {
  let best: number | null = null;
  for (const { year, date } of years) {
    const day = date ? ISO_DAY.exec(date) : null;
    const key = year * 10000 + (day ? Number(day[2]) * 100 + Number(day[3]) : 0);
    if (best === null || (order === 'desc' ? key > best : key < best)) best = key;
  }
  return best;
}

/** By year (and day), newest first or oldest first; a stable sort, rows with no year always last. */
export function sortByYear<T>(rows: readonly T[], yearsOf: YearsOf<T>, order: YearOrder): T[] {
  const keyed = rows.map((row, index) => ({ row, index, key: sortKey(yearsOf(row), order) }));
  keyed.sort((a, b) => {
    if (a.key === null || b.key === null) {
      if (a.key === b.key) return a.index - b.index;
      return a.key === null ? 1 : -1;
    }
    return a.key === b.key ? a.index - b.index : order === 'desc' ? b.key - a.key : a.key - b.key;
  });
  return keyed.map((k) => k.row);
}
