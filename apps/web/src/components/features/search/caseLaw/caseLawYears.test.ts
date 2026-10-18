import { describe, expect, it } from 'vitest';
import {
  archiveYears, countByYear, filterByRange, inRange, isRangeSet, mergeYearCounts, normalizeRange, parseYear, rowYear, sortByYear, yearCounts, yearList, type YearsOf,
} from './caseLawYears';

interface Row { id: string; years: Array<{ year?: string | number | null; date?: string | null }> }
const yearsOf: YearsOf<Row> = (row) => row.years.flatMap(rowYear);
const rows: Row[] = [
  { id: 'a', years: [{ year: '2019' }] },
  { id: 'b', years: [{ date: '2024-03-05' }] },
  { id: 'c', years: [] },
  { id: 'd', years: [{ year: 2024 }, { year: 2016 }] },
  { id: 'e', years: [{ date: '2024-11-20' }] },
];
const ids = (list: Row[]) => list.map((r) => r.id);

describe('rowYear', () => {
  it('takes the exact day when there is one, else the year', () => {
    expect(rowYear({ date: '2026-09-01', year: 2025 })).toEqual([{ year: 2026, date: '2026-09-01' }]);
    expect(rowYear({ year: '2019' })).toEqual([{ year: 2019 }]);
    expect(rowYear({ year: 2019 })).toEqual([{ year: 2019 }]);
  });

  it('has no year when the source gives none that reads as one', () => {
    expect(rowYear({})).toEqual([]);
    expect(rowYear({ year: null, date: null })).toEqual([]);
    expect(rowYear({ year: 'n.d.' })).toEqual([]);
    expect(rowYear({ year: '19' })).toEqual([]);
    expect(rowYear({ date: 'ieri' })).toEqual([]);
  });

  it('reads a four-digit year only', () => {
    expect(parseYear(' 2024 ')).toBe(2024);
    expect(parseYear('20')).toBeNull();
    expect(parseYear('20245')).toBeNull();
    expect(parseYear(undefined)).toBeNull();
  });
});

describe('the range', () => {
  it('keeps the rows of any year while none is set, those without a year too', () => {
    expect(isRangeSet({})).toBe(false);
    expect(ids(filterByRange(rows, yearsOf, {}))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('keeps a row when any of its years falls in the range, and drops the rows without a year', () => {
    expect(ids(filterByRange(rows, yearsOf, { from: 2024, to: 2024 }))).toEqual(['b', 'd', 'e']);
    expect(ids(filterByRange(rows, yearsOf, { from: 2016, to: 2019 }))).toEqual(['a', 'd']);
    expect(ids(filterByRange(rows, yearsOf, { from: 2020 }))).toEqual(['b', 'd', 'e']);
    expect(ids(filterByRange(rows, yearsOf, { to: 2018 }))).toEqual(['d']);
  });

  it('reads a range typed the wrong way round as the same years', () => {
    expect(normalizeRange({ from: 2024, to: 2016 })).toEqual({ from: 2016, to: 2024 });
    expect(inRange([{ year: 2019 }], { from: 2024, to: 2016 })).toBe(true);
  });
});

describe('counts', () => {
  it('counts each year once per row, newest first, and reverses', () => {
    const years = yearList(rows, yearsOf);
    expect(years).toEqual([2019, 2024, 2024, 2016, 2024]);
    expect(countByYear(years)).toEqual([{ year: 2024, n: 3 }, { year: 2019, n: 1 }, { year: 2016, n: 1 }]);
    expect(countByYear(years, 'asc').map((c) => c.year)).toEqual([2016, 2019, 2024]);
  });

  it('counts a year once for a row that cites it twice', () => {
    expect(yearList([{ id: 'x', years: [{ year: 2020 }, { date: '2020-05-05' }] }], yearsOf)).toEqual([2020]);
  });
});

describe('the order', () => {
  it('puts the newest first, the day deciding within a year, and the rows without a year last', () => {
    expect(ids(sortByYear(rows, yearsOf, 'desc'))).toEqual(['e', 'b', 'd', 'a', 'c']);
  });

  it('reverses it, the rows without a year still last, and keeps equal rows in their order', () => {
    // `d` cites 2024 and 2016: newest first it sits with 2024, oldest first with 2016
    expect(ids(sortByYear(rows, yearsOf, 'asc'))).toEqual(['d', 'a', 'b', 'e', 'c']);
    const same: Row[] = [1, 2, 3].map((n) => ({ id: String(n), years: [{ year: 2020 }] }));
    expect(ids(sortByYear(same, yearsOf, 'asc'))).toEqual(['1', '2', '3']);
    expect(ids(sortByYear(same, yearsOf, 'desc'))).toEqual(['1', '2', '3']);
  });
});

describe('the counts of several blocks', () => {
  it('counts a source\'s loaded rows', () => {
    expect(yearCounts(rows, yearsOf)).toEqual([{ year: 2024, n: 3 }, { year: 2019, n: 1 }, { year: 2016, n: 1 }]);
  });

  it('adds the blocks year by year, in the order asked', () => {
    const merged = mergeYearCounts([[{ year: 2024, n: 2 }, { year: 2019, n: 1 }], [{ year: 2024, n: 5 }, { year: 2010, n: 4 }]]);
    expect(merged).toEqual([{ year: 2024, n: 7 }, { year: 2019, n: 1 }, { year: 2010, n: 4 }]);
    expect(mergeYearCounts([[{ year: 2024, n: 2 }, { year: 2019, n: 1 }]], 'asc').map((c) => c.year)).toEqual([2019, 2024]);
  });

  it('calls a year approximate as soon as one block says its count is', () => {
    const merged = mergeYearCounts([[{ year: 2024, n: 2 }], [{ year: 2024, n: 5, approx: true }, { year: 2019, n: 1 }]]);
    expect(merged).toEqual([{ year: 2024, n: 7, approx: true }, { year: 2019, n: 1 }]);
    expect(mergeYearCounts([[{ year: 2024, n: 5, approx: true }], [{ year: 2024, n: 2 }]])[0].approx).toBe(true);
  });
});

describe('archiveYears', () => {
  it('passes a range the archive can hold as it is', () => {
    expect(archiveYears({ from: 2022, to: 2024 }, 2026)).toEqual({ dal: 2022, al: 2024, outside: false });
    expect(archiveYears({}, 2026)).toEqual({ dal: undefined, al: undefined, outside: false });
    expect(archiveYears({ from: 2022 }, 2026)).toEqual({ dal: 2022, al: undefined, outside: false });
  });

  it('lowers «al» to the current year and raises «dal» to 1900', () => {
    expect(archiveYears({ from: 2022, to: 2027 }, 2026)).toEqual({ dal: 2022, al: 2026, outside: false });
    expect(archiveYears({ from: 1850, to: 2024 }, 2026)).toEqual({ dal: 1900, al: 2024, outside: false });
    expect(archiveYears({ to: 2099 }, 2026)).toEqual({ dal: undefined, al: 2026, outside: false });
  });

  it('reads a range typed the wrong way round the right way round first', () => {
    expect(archiveYears({ from: 2027, to: 2022 }, 2026)).toEqual({ dal: 2022, al: 2026, outside: false });
  });

  it('says outside for a range no year of which the archive can hold', () => {
    expect(archiveYears({ from: 2030 }, 2026).outside).toBe(true);
    expect(archiveYears({ from: 2030, to: 2031 }, 2026).outside).toBe(true);
    expect(archiveYears({ to: 1850 }, 2026).outside).toBe(true);
    expect(archiveYears({ from: 2026 }, 2026).outside).toBe(false);
    expect(archiveYears({ to: 1900 }, 2026).outside).toBe(false);
  });
});
