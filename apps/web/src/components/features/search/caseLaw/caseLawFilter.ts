import { findMatches, isSearchableQuery } from '../../../../utils/findInText';
import { filterByRange, sortByYear, type YearOrder, type YearRange, type YearsOf } from './caseLawYears';

/** What the section's controls say, for every source alike (case-law section spec, D4 and D5). */
export interface CaseLawFilters {
  range: YearRange;
  text: string;
  order: YearOrder;
}

export const NO_FILTERS: CaseLawFilters = { range: {}, text: '', order: 'desc' };

/** How many of the filters narrow the rows: the range, the text (the order alone does not). */
export function narrowingCount(filters: CaseLawFilters): number {
  return (filters.range.from !== undefined || filters.range.to !== undefined ? 1 : 0) + (filters.text.trim() !== '' ? 1 : 0);
}

export function isNarrowing(filters: CaseLawFilters): boolean {
  return narrowingCount(filters) > 0;
}

/**
 * Whether `haystack` holds `query`, ignoring case and accents the way the find window does
 * (`findMatches`: the same folding, «art 13» finds «art. 13»). A query too short to search
 * (under two letters or digits) filters nothing, as the find window searches nothing.
 */
export function matchesText(haystack: string, query: string): boolean {
  if (!isSearchableQuery(query)) return true;
  return findMatches(haystack, query, { limit: 1 }).matches.length > 0;
}

export function filterByText<T>(rows: readonly T[], textOf: (row: T) => string, query: string): T[] {
  return isSearchableQuery(query) ? rows.filter((row) => matchesText(textOf(row), query)) : [...rows];
}

/** What a source does with its loaded rows: the range, the text filter, then the order. */
export function applyCaseLawFilters<T>(
  rows: readonly T[],
  read: { yearsOf: YearsOf<T>; textOf: (row: T) => string },
  filters: CaseLawFilters,
): T[] {
  const inYears = filterByRange(rows, read.yearsOf, filters.range);
  const matching = filterByText(inYears, read.textOf, filters.text);
  return sortByYear(matching, read.yearsOf, filters.order);
}
