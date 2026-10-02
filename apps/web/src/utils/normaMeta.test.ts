import { describe, expect, it } from 'vitest';
import type { Norma } from '../types';
import { formatNormaMeta } from './normaMeta';

const norma = (data?: string, over: Partial<Norma> = {}): Norma => ({
  tipo_atto: 'legge',
  numero_atto: '241',
  data,
  ...over,
} as Norma);

describe('formatNormaMeta', () => {
  it('writes the edition of a card the way Italian writes a date after "del"', () => {
    expect(formatNormaMeta(norma('1990-08-07'), { variant: 'card-desktop' })).toBe('Edizione del 7 agosto 1990');
  });

  it.each([
    ['2010-03-08', "Edizione dell'8 marzo 2010"],
    ['2014-09-11', "Edizione dell'11 settembre 2014"],
    ['2014-09-18', 'Edizione del 18 settembre 2014'],
    ['2014-09-28', 'Edizione del 28 settembre 2014'],
  ])('elides "del" before the 8th and the 11th only (%s)', (day, expected) => {
    expect(formatNormaMeta(norma(day), { variant: 'card-desktop' })).toBe(expected);
  });

  it('keeps the other placements as they were, a bare date needing no preposition', () => {
    expect(formatNormaMeta(norma('2010-03-08'), { variant: 'card-mobile' })).toBe('Data: 8 marzo 2010');
    expect(formatNormaMeta(norma('2010-03-08'), { variant: 'block', articleCount: 3 })).toBe('8 marzo 2010 · 3 articoli');
  });

  it('keeps the fallbacks and the aliased form', () => {
    expect(formatNormaMeta(norma(), { variant: 'card-desktop' })).toBe('Data non disponibile');
    expect(formatNormaMeta(norma(), { variant: 'card-mobile' })).toBe('Estremi non disponibili');
    expect(formatNormaMeta(norma('1942-03-16', { tipo_atto: 'codice civile', tipo_atto_reale: 'regio decreto', numero_atto: '262' }), { variant: 'card-desktop' }))
      .toBe('R.D. 16 marzo 1942, n. 262');
  });
});
