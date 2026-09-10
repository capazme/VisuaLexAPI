import { describe, it, expect } from 'vitest';
import { resolveEuPair } from './euCitation';

// The rule table behind every EU citation the client reads. `currentYear` is
// injected so the ceiling branches are exercised on purpose, not by the clock.
describe('resolveEuPair', () => {
  const at2026 = { currentYear: 2026 };

  it('reads a year followed by a serial as year/number', () => {
    expect(resolveEuPair('2024', '2847', { kind: 'regolamento', trailingMarker: false, ...at2026 }))
      .toEqual({ year: '2024', actNumber: '2847' });
  });

  it('reads a serial followed by a year as number/year', () => {
    expect(resolveEuPair('679', '2016', { kind: 'regolamento', trailingMarker: false, ...at2026 }))
      .toEqual({ year: '2016', actNumber: '679' });
  });

  it('does not take a serial below the floor for a year (REACH is 1907/2006)', () => {
    expect(resolveEuPair('1907', '2006', { kind: 'regolamento', trailingMarker: false, ...at2026 }))
      .toEqual({ year: '2006', actNumber: '1907' });
  });

  it('prefers year-first from 2015 on when both halves look like years', () => {
    expect(resolveEuPair('2016', '1953', { kind: 'regolamento', trailingMarker: false, ...at2026 }))
      .toEqual({ year: '2016', actNumber: '1953' });
  });

  it('prefers number-first before 2015 when both halves look like years', () => {
    expect(resolveEuPair('2006', '2004', { kind: 'regolamento', trailingMarker: false, ...at2026 }))
      .toEqual({ year: '2004', actNumber: '2006' });
  });

  it('never reads a (CE)/(CEE) act as new numbering, whatever the halves', () => {
    // Regulation (EC) No 2015/2006 of 19 December 2006.
    expect(resolveEuPair('2015', '2006', { kind: 'regolamento', trailingMarker: false, oldMarker: true, ...at2026 }))
      .toEqual({ year: '2006', actNumber: '2015' });
  });

  it('accepts next year as a year (acts are cited before the calendar turns)', () => {
    expect(resolveEuPair('2027', '5', { kind: 'regolamento', trailingMarker: false, ...at2026 }))
      .toEqual({ year: '2027', actNumber: '5' });
  });

  it('refuses a pair in which no half can be the year', () => {
    expect(resolveEuPair('2028', '5', { kind: 'regolamento', trailingMarker: false, ...at2026 })).toBeNull();
    expect(resolveEuPair('123', '456', { kind: 'regolamento', trailingMarker: false, ...at2026 })).toBeNull();
  });

  it('reads a two-digit year after a long serial as number/year', () => {
    expect(resolveEuPair('2913', '92', { kind: 'regolamento', trailingMarker: false, ...at2026 }))
      .toEqual({ year: '1992', actNumber: '2913' });
  });

  it('reads the old directive format year-first on the trailing marker', () => {
    expect(resolveEuPair('95', '46', { kind: 'direttiva', trailingMarker: true, ...at2026 }))
      .toEqual({ year: '1995', actNumber: '46' });
  });

  it('follows the kind when both halves have two digits', () => {
    expect(resolveEuPair('45', '01', { kind: 'regolamento', trailingMarker: false, ...at2026 }))
      .toEqual({ year: '2001', actNumber: '45' });
    expect(resolveEuPair('93', '13', { kind: 'direttiva', trailingMarker: false, ...at2026 }))
      .toEqual({ year: '1993', actNumber: '13' });
  });

  it('expands a two-digit year on the same pivot as the backend (<= 30 is 20xx)', () => {
    expect(resolveEuPair('46', '95', { kind: 'direttiva', trailingMarker: false, ...at2026 }))
      .toEqual({ year: '1946', actNumber: '95' });
    expect(resolveEuPair('12', '30', { kind: 'direttiva', trailingMarker: false, ...at2026 }))
      .toEqual({ year: '2012', actNumber: '30' });
  });
});
