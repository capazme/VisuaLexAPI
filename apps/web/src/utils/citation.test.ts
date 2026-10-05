import { describe, expect, it } from 'vitest';
import { formatNormCitation, withCitation } from './citation';
import { CITATION_GOLDEN } from './__fixtures__/citationGolden';

describe('formatNormCitation — the golden file', () => {
  it.each(CITATION_GOLDEN.map((c) => [c.name, c] as const))('%s', (_name, golden) => {
    expect(formatNormCitation(golden.context)).toEqual(golden.expected);
  });

  it('has a case for every way the function answers', () => {
    const answers = CITATION_GOLDEN.map((c) => c.expected === null);
    expect(answers).toContain(true);
    expect(answers).toContain(false);
    expect(CITATION_GOLDEN.length).toBeGreaterThanOrEqual(10);
  });
});

describe('formatNormCitation — the details the golden file does not spell out', () => {
  const norma = { tipo_atto: 'Codice Civile', numero_articolo: '2043', allegato: '2' };

  it('recognises a code however the vocabulary spells it', () => {
    expect(formatNormCitation({ norma, requestedDate: '2000-05-05' })?.short)
      .toBe('art. 2043 c.c., nel testo in vigore al 5 maggio 2000');
  });

  it('never prints the default annex of a code', () => {
    expect(formatNormCitation({ norma, requestedDate: '2000-05-05' })?.long).not.toContain('Allegato');
  });

  it('never states a window it was not given', () => {
    expect(formatNormCitation({ norma, requestedDate: '2000-05-05' })?.long).not.toMatch(/ dal /);
  });
});

describe('formatNormCitation — what a repealed or a reached-by-no-day text may not say', () => {
  const norma = { tipo_atto: 'codice penale', numero_articolo: '594' };

  it('cites a repealed article only for a day that was asked for', () => {
    const validity = { state: 'abrogated' as const, valid_from: '2016-02-06', valid_to: null, version_number: 2, act_updated: null, request_in_window: null };
    expect(formatNormCitation({ norma, validity })).toBeNull();
  });

  it('cites the text in force with no day as nothing at all', () => {
    const validity = { state: 'current' as const, valid_from: '2025-12-28', valid_to: null, version_number: 8, act_updated: null, request_in_window: null };
    expect(formatNormCitation({ norma, validity })).toBeNull();
  });

  it('does not cite an act of the Union whatever its spelling, nor the original text of one', () => {
    for (const tipo_atto of ['TUE', 'Regolamento UE', ' direttiva ue ']) {
      expect(formatNormCitation({ norma: { tipo_atto, numero_articolo: '5' }, requestedDate: '2007-10-12' })).toBeNull();
      expect(formatNormCitation({ norma: { tipo_atto, numero_articolo: '5' }, original: true })).toBeNull();
    }
  });
});

describe('withCitation', () => {
  const citation = { short: 'S', long: 'art. 1284 c.c., nel testo in vigore al 29 dicembre 2007 (Normattiva)' };

  it('puts the citation of a past text first, so the quotation cannot travel without its version', () => {
    expect(withCitation('Il testo.', citation, 'x')).toBe(`${citation.long}\n\nIl testo.`);
  });

  it('starts the text in force with its citation too (D8)', () => {
    const inForce = 'art. 2043 c.c. (Normattiva, testo vigente, consultato il 5 ottobre 2026)';
    expect(withCitation('Il testo.', null, inForce)).toBe(`${inForce}\n\nIl testo.`);
  });
});
