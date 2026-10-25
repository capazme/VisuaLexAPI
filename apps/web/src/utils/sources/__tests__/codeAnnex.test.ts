import { describe, expect, it } from 'vitest';
import { citeNorm, namedAnnex, shortNorm } from '../normLabels';

// A code's annex is the code itself (the c.c. is Allegato 2 of r.d. 262/1942): never named,
// also for a code cited by its decree (G-350, G-351).
describe('a code’s default annex is never named', () => {
  it('the codice del turismo', () => {
    const norm = { tipo_atto: 'codice del turismo', allegato: '1', numero_articolo: '5' };
    expect(citeNorm(norm)).toBe('art. 5, d.lgs. 23 maggio 2011, n. 79');
    expect(shortNorm(norm)).toBe('art. 5 d.lgs. 79/2011');
  });

  it('the c.p.a.', () => {
    expect(citeNorm({ tipo_atto: 'codice del processo amministrativo', allegato: '2', numero_articolo: '29' }))
      .toBe('art. 29, d.lgs. 2 luglio 2010, n. 104');
  });

  it('an annex other than the default, or of an act that is not a code, is named', () => {
    expect(citeNorm({ tipo_atto: 'codice del processo amministrativo', allegato: '1', numero_articolo: '29' }))
      .toBe('art. 29, d.lgs. 2 luglio 2010, n. 104 (Allegato 1)');
    expect(citeNorm({ tipo_atto: 'decreto legislativo', numero_atto: '81', data: '2008-04-09', allegato: 'A', numero_articolo: '1' }))
      .toBe('art. 1, d.lgs. 9 aprile 2008, n. 81 (Allegato A)');
  });
});

// The TULPS is annex 1 of r.d. 773/1931 (G-351): keyed by it, never named.
describe('an act whose text is its annex', () => {
  const tulps = { tipo_atto: 'regio decreto', numero_atto: '773', data: '1931-06-18', allegato: '1', numero_articolo: '86' };
  it('names no annex', () => {
    expect(citeNorm(tulps)).toBe('art. 86, r.d. 18 giugno 1931, n. 773');
    expect(shortNorm(tulps)).toBe('art. 86 r.d. 773/1931');
  });
  it('names another annex', () => {
    expect(citeNorm({ ...tulps, allegato: '2' })).toBe('art. 86, r.d. 18 giugno 1931, n. 773 (Allegato 2)');
  });
});

// What the reader's toolbar shows as «Allegato N» (R3): the same rule as the labels.
describe('namedAnnex', () => {
  it('names an annex the labels name', () => {
    expect(namedAnnex({ tipo_atto: 'decreto legislativo', numero_atto: '81', data: '2008-04-09', allegato: 'A' })).toBe('A');
    expect(namedAnnex({ tipo_atto: 'codice del processo amministrativo', allegato: '1' })).toBe('1');
  });

  it('names none for a code\'s own annex, by name or by decree, nor for the TULPS', () => {
    expect(namedAnnex({ tipo_atto: 'codice civile', allegato: '2' })).toBe('');
    expect(namedAnnex({ tipo_atto: 'codice del processo amministrativo', allegato: '2' })).toBe('');
    expect(namedAnnex({ tipo_atto: 'regio decreto', numero_atto: '773', data: '1931-06-18', allegato: '1' })).toBe('');
    expect(namedAnnex({ tipo_atto: 'legge', numero_atto: '241', data: '1990-08-07' })).toBe('');
  });
});
