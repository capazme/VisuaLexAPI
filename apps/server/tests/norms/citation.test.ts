import { describe, expect, it } from 'vitest';
import { citeArticle } from '../../src/norms/citation';
// The web app's golden file is the specification of the wording (the owner reads
// it). The server's formatter is pinned to it: for every case the web cites, the
// "art. …" part of its citation is what the server writes. A change of style in
// the web app fails here until the server follows.
import { CITATION_GOLDEN } from '../../../web/src/utils/__fixtures__/citationGolden';

// The owner's citation style (the same as the web app's `utils/citation.ts`):
// "art. 2, l. 7 agosto 1990, n. 241" for an act cited by type, date and number;
// "art. 1284 c.c." for a code and the Constitution, with no comma.
const CC = { tipo_atto: 'codice civile', tipo_atto_reale: 'regio decreto', numero_atto: '262', data: '1942-03-16', allegato: '2' };

describe('citeArticle, pinned to the web app\'s golden citations', () => {
  const cases = CITATION_GOLDEN.filter((c) => c.expected !== null);
  it('covers the web\'s cases', () => {
    expect(cases.length).toBeGreaterThan(15);
  });
  for (const c of cases) {
    it(c.name, () => {
      const head = c.expected!.short.split(/, (?:nel testo|abrogato)/)[0];
      expect(citeArticle(c.context.norma)).toBe(head);
    });
  }
});

describe('citeArticle', () => {
  it('cites a law by type, date and number', () => {
    expect(citeArticle({ tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31', numero_articolo: '3' })).toBe(
      'art. 3, l. 31 dicembre 2012, n. 247',
    );
    expect(citeArticle({ tipo_atto: 'legge', numero_atto: '241', data: '1990-08-07', numero_articolo: '2' })).toBe(
      'art. 2, l. 7 agosto 1990, n. 241',
    );
  });

  it('tells two acts of the same type apart', () => {
    const a = citeArticle({ tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31', numero_articolo: '3' });
    const b = citeArticle({ tipo_atto: 'legge', numero_atto: '49', data: '2023-04-21', numero_articolo: '3' });
    expect(a).not.toBe(b);
    expect(b).toBe('art. 3, l. 21 aprile 2023, n. 49');
  });

  it('cites the codes and the Constitution by their abbreviation, with no comma', () => {
    expect(citeArticle({ ...CC, numero_articolo: '1284' })).toBe('art. 1284 c.c.');
    expect(citeArticle({ ...CC, numero_articolo: '2645-bis' })).toBe('art. 2645-bis c.c.');
    expect(citeArticle({ tipo_atto: 'costituzione', numero_articolo: '81' })).toBe('art. 81 Cost.');
    expect(citeArticle({ tipo_atto: 'Codice di procedura civile', numero_articolo: '183' })).toBe('art. 183 c.p.c.');
    expect(citeArticle({ tipo_atto: 'preleggi', tipo_atto_reale: 'regio decreto', numero_atto: '262', data: '1942-03-16', allegato: '1', numero_articolo: '12' })).toBe('art. 12 preleggi');
  });

  it('cites an aliased act by the act it is, with the other abbreviations', () => {
    expect(citeArticle({ tipo_atto: 'codice in materia di protezione dei dati personali', tipo_atto_reale: 'decreto legislativo', numero_atto: '196', data: '2003-06-30', numero_articolo: '7' })).toBe('art. 7, d.lgs. 30 giugno 2003, n. 196');
    expect(citeArticle({ tipo_atto: 'decreto legge', numero_atto: '18', data: '2020-03-17', numero_articolo: '1' })).toBe('art. 1, d.l. 17 marzo 2020, n. 18');
    expect(citeArticle({ tipo_atto: 'decreto del presidente della repubblica', numero_atto: '445', data: '2000-12-28', numero_articolo: '46' })).toBe('art. 46, d.p.r. 28 dicembre 2000, n. 445');
    expect(citeArticle({ tipo_atto: 'regio decreto', numero_atto: '267', data: '1942-03-16', numero_articolo: '1' })).toBe('art. 1, r.d. 16 marzo 1942, n. 267');
  });

  it('writes the first of the month with the ordinal, and an annex of an act that is not a code', () => {
    expect(citeArticle({ tipo_atto: 'legge', numero_atto: '10', data: '2020-10-01', numero_articolo: '1' })).toBe('art. 1, l. 1° ottobre 2020, n. 10');
    expect(citeArticle({ tipo_atto: 'decreto legislativo', numero_atto: '36', data: '2023-03-31', numero_articolo: '5', allegato: 'I.1' })).toBe('art. 5, d.lgs. 31 marzo 2023, n. 36 (Allegato I.1)');
  });

  it('cites an act known only by its year as the year', () => {
    expect(citeArticle({ tipo_atto: 'legge', numero_atto: '10', data: '2020', numero_articolo: '1' })).toBe('art. 1, l. 2020, n. 10');
  });

  it('cites an act of the Union by its number and year (the web app cites none: a reading is not a version)', () => {
    expect(citeArticle({ tipo_atto: 'regolamento UE', numero_atto: '679', data: '2016-04-27', numero_articolo: '5' })).toBe('art. 5, regolamento (UE) 2016/679');
    expect(citeArticle({ tipo_atto: 'direttiva UE', numero_atto: '790', data: '2019-04-17', numero_articolo: '17' })).toBe('art. 17, direttiva (UE) 2019/790');
  });
});
