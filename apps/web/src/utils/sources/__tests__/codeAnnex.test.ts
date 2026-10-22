import { describe, expect, it } from 'vitest';
import { parseLegalCitation } from '../../citationParser';
import { actHeading, actSubtitle, citeNorm, namedAnnex, shortNorm } from '../normLabels';

// A code's annex is the code itself (the c.c. is Allegato 2 of r.d. 262/1942): never named,
// also for a code cited by its decree (G-350, G-351).
describe('a code’s default annex is never named', () => {
  it('the codice del turismo', () => {
    const norm = { tipo_atto: 'codice del turismo', allegato: '1', numero_articolo: '5' };
    expect(citeNorm(norm)).toBe('art. 5, d.lgs. 23 maggio 2011, n. 79');
    expect(shortNorm(norm)).toBe('art. 5 d.lgs. 79/2011');
  });

  // Four codes cited by their sigla, like the c.c. (G-360, G-366): no annex is ever named.
  it('the c.p.a., the cod. nav., the cod. post. and the c.g.c.', () => {
    expect(citeNorm({ tipo_atto: 'codice del processo amministrativo', allegato: '2', numero_articolo: '29' }))
      .toBe('art. 29 c.p.a.');
    expect(shortNorm({ tipo_atto: 'codice della navigazione', allegato: '1', numero_articolo: '69' })).toBe('art. 69 cod. nav.');
    expect(citeNorm({ tipo_atto: 'codice postale e delle telecomunicazioni', allegato: '1', numero_articolo: '20' }))
      .toBe('art. 20 cod. post.');
    expect(citeNorm({ tipo_atto: 'codice di giustizia contabile', allegato: '1', numero_articolo: '52' })).toBe('art. 52 c.g.c.');
  });

  it('an annex other than the default, or of an act that is not a code, is named', () => {
    expect(citeNorm({ tipo_atto: 'codice del turismo', allegato: '2', numero_articolo: '5' }))
      .toBe('art. 5, d.lgs. 23 maggio 2011, n. 79 (Allegato 2)');
    // Another annex of a code's decree is not the code (the c.p.a.'s annex 3): its own sigla (G-369),
    // also for a norm stored by its decree and annex.
    const other = { tipo_atto: 'codice del processo amministrativo', allegato: '3', numero_articolo: '1' };
    expect(citeNorm(other)).toBe('art. 1 disp. att. c.p.a.');
    expect(shortNorm(other)).toBe('art. 1 disp. att. c.p.a.');
    expect(namedAnnex(other)).toBe('');
    const stored = { ...other, tipo_atto_reale: 'decreto legislativo', numero_atto: '104', data: '2010-07-02' };
    expect(actHeading(stored)).toBe('Norme di attuazione del codice del processo amministrativo');
    expect(actSubtitle(stored)).toBe('d.lgs. 2 luglio 2010, n. 104');
    const byDecree = { tipo_atto: 'decreto legislativo', numero_atto: '104', data: '2010-07-02', allegato: '3', numero_articolo: '1' };
    expect(citeNorm(byDecree)).toBe('art. 1 disp. att. c.p.a.');
    expect(actHeading(byDecree)).toBe('Norme di attuazione del codice del processo amministrativo');
    expect(actSubtitle(byDecree)).toBe('d.lgs. 2 luglio 2010, n. 104');
    expect(citeNorm({ tipo_atto: 'codice civile', allegato: '1', numero_articolo: '12' })).toBe('art. 12 preleggi');
    expect(citeNorm({ tipo_atto: 'codici penali militari di pace e di guerra', allegato: '2', numero_articolo: '1' })).toBe('art. 1 c.p.m.g.');
    // An annex without a sigla of its own (the c.p.a.'s index): the decree with its annex.
    const index = { tipo_atto: 'codice del processo amministrativo', allegato: '1', numero_articolo: '1' };
    expect(citeNorm(index)).toBe('art. 1, d.lgs. 2 luglio 2010, n. 104 (Allegato 1)');
    expect(shortNorm(index)).toBe('art. 1 d.lgs. 104/2010 (All. 1)');
    expect(namedAnnex(index)).toBe('1');
    expect(actSubtitle({ ...index, tipo_atto_reale: 'decreto legislativo', numero_atto: '104', data: '2010-07-02' })).toBe('');
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
    expect(namedAnnex({ tipo_atto: 'codice del turismo', allegato: '2' })).toBe('2');
  });

  it('names none for a code\'s own annex, by name or by decree, nor for the TULPS', () => {
    expect(namedAnnex({ tipo_atto: 'codice civile', allegato: '2' })).toBe('');
    expect(namedAnnex({ tipo_atto: 'codice del processo amministrativo', allegato: '2' })).toBe('');
    expect(namedAnnex({ tipo_atto: 'regio decreto', numero_atto: '773', data: '1931-06-18', allegato: '1' })).toBe('');
    expect(namedAnnex({ tipo_atto: 'legge', numero_atto: '241', data: '1990-08-07' })).toBe('');
  });
});

// The palette reads an annex's sigla back as the code and its annex (G-369), however dotted.
describe('an annex sigla typed into the palette', () => {
  it.each([
    ['art. 1 disp. att. c.p.a.', 'codice del processo amministrativo', '3'],
    ['art. 1 disp att cpa', 'codice del processo amministrativo', '3'],
    ['art. 5 c.p.m.g.', 'codici penali militari di pace e di guerra', '2'],
  ])('%s', (label, actType, annex) => {
    const parsed = parseLegalCitation(label);
    expect([parsed?.act_type, parsed?.annex]).toEqual([actType, annex]);
  });

  it('a code\'s sigla names no annex', () => {
    expect(parseLegalCitation('art. 29 c.p.a.')).toMatchObject({ act_type: 'codice del processo amministrativo' });
    expect(parseLegalCitation('art. 29 c.p.a.')?.annex).toBeUndefined();
  });
});
