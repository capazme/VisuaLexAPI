import { describe, expect, it } from 'vitest';
import { applyCaseLawFilters, filterByText, isNarrowing, matchesText, narrowingCount, NO_FILTERS } from './caseLawFilter';
import { rowYear, type YearsOf } from './caseLawYears';

describe('matchesText', () => {
  it('ignores case and accents, on either side', () => {
    expect(matchesText('La responsabilità del custode', 'RESPONSABILITA')).toBe(true);
    expect(matchesText('La responsabilita del custode', 'responsabilità')).toBe(true);
    expect(matchesText('Il danno ingiusto', 'responsabilità')).toBe(false);
  });

  it('reads the abbreviations of a citation as the find window does', () => {
    expect(matchesText('ai sensi dell’art. 2043 c.c.', 'art 2043')).toBe(true);
    expect(matchesText('n. 8980/2018', '980/2018')).toBe(false);
  });

  it('filters nothing for a query too short to search', () => {
    expect(matchesText('qualsiasi testo', '')).toBe(true);
    expect(matchesText('qualsiasi testo', ' z ')).toBe(true);
  });
});

describe('applyCaseLawFilters', () => {
  interface Row { text: string; year?: number }
  const yearsOf: YearsOf<Row> = (row) => rowYear({ year: row.year });
  const rows: Row[] = [
    { text: 'Danno non patrimoniale', year: 2018 },
    { text: 'Responsabilità del custode', year: 2024 },
    { text: 'Responsabilità del vettore' },
    { text: 'Responsabilità della P.A.', year: 2020 },
  ];
  const read = { yearsOf, textOf: (r: Row) => r.text };

  it('shows everything, newest first, when nothing is set', () => {
    expect(applyCaseLawFilters(rows, read, NO_FILTERS).map((r) => r.year)).toEqual([2024, 2020, 2018, undefined]);
  });

  it('combines the range and the text, and keeps the rows without a year only when no range is set', () => {
    const text = { ...NO_FILTERS, text: 'responsabilita' };
    expect(applyCaseLawFilters(rows, read, text).map((r) => r.text)).toEqual([
      'Responsabilità del custode', 'Responsabilità della P.A.', 'Responsabilità del vettore',
    ]);
    const both = { ...text, range: { from: 2019 } };
    expect(applyCaseLawFilters(rows, read, both).map((r) => r.year)).toEqual([2024, 2020]);
  });

  it('filterByText leaves the rows alone for an unsearchable query', () => {
    expect(filterByText(rows, (r) => r.text, 'x')).toHaveLength(4);
  });

  it('counts what narrows: the range and the text, not the order', () => {
    expect(narrowingCount(NO_FILTERS)).toBe(0);
    expect(isNarrowing({ ...NO_FILTERS, order: 'asc' })).toBe(false);
    expect(narrowingCount({ range: { to: 2020 }, text: ' ', order: 'desc' })).toBe(1);
    expect(narrowingCount({ range: { from: 2000 }, text: 'danno', order: 'desc' })).toBe(2);
  });
});
