import { describe, expect, it } from 'vitest';
import type { Norma } from '../types';
import { formatNormaMeta, formatNormaTitle } from './normaMeta';

const norma = (data?: string, over: Partial<Norma> = {}): Norma => ({
  tipo_atto: 'legge',
  numero_atto: '241',
  data,
  ...over,
} as Norma);

describe('formatNormaTitle', () => {
  it('heads an act by its citation, a code by its name', () => {
    expect(formatNormaTitle(norma('1990-08-07'))).toBe('l. 7 agosto 1990, n. 241');
    expect(formatNormaTitle(norma('1942-03-16', { tipo_atto: 'Codice Civile', numero_atto: '262' }))).toBe('Codice civile');
  });
});

describe('formatNormaMeta', () => {
  it('says nothing the title already says', () => {
    for (const variant of ['card-desktop', 'card-mobile', 'block'] as const) {
      expect(formatNormaMeta(norma('1990-08-07'), { variant })).toBe('');
    }
    expect(formatNormaMeta(norma('2010-03-08'), { variant: 'block', articleCount: 3 })).toBe('3 articoli');
    expect(formatNormaMeta(norma('2010-03-08'), { variant: 'block', articleCount: 1 })).toBe('1 articolo');
  });

  it('names the decree a code is, and the code an aliased act is', () => {
    expect(formatNormaMeta(norma('1942-03-16', { tipo_atto: 'codice civile', tipo_atto_reale: 'regio decreto', numero_atto: '262' }), { variant: 'card-desktop' }))
      .toBe('r.d. 16 marzo 1942, n. 262');
    expect(formatNormaMeta(norma('2005-09-06', { tipo_atto: 'codice del consumo', numero_atto: '206' }), { variant: 'block', articleCount: 2 }))
      .toBe('Codice del consumo · 2 articoli');
  });

  it('says when an act has neither date nor number', () => {
    expect(formatNormaMeta(norma(undefined, { numero_atto: undefined }), { variant: 'card-mobile' })).toBe('Estremi non disponibili');
    expect(formatNormaMeta(norma(undefined, { tipo_atto: 'costituzione', numero_atto: undefined }), { variant: 'card-mobile' })).toBe('');
  });
});
