import { describe, expect, it } from 'vitest';
import { findCitationSpans, mergeMatches, readQueryCitation } from '../citationSearch';
import { findMatches } from '../findInText';
import { CITATION_TEXTS } from '../__fixtures__/citationTexts';

/** What the find window shows for `query`: the literal matches and the citation's spans, merged. */
function found(text: string, query: string): string[] {
  const citation = readQueryCitation(query);
  const spans = citation ? findCitationSpans(text, citation) : [];
  return mergeMatches(findMatches(text, query).matches, spans).map(([s, e]) => text.slice(s, e));
}

/** The citation's spans alone. */
function cited(text: string, query: string): string[] {
  const citation = readQueryCitation(query);
  expect(citation, query).not.toBeNull();
  return findCitationSpans(text, citation!).map(([s, e]) => text.slice(s, e));
}

describe('readQueryCitation', () => {
  it("reads a code's article in every spelling", () => {
    expect(readQueryCitation('art. 580 c.p.')).toEqual({ kind: 'code', code: 'codice penale', article: '580' });
    expect(readQueryCitation('art 110 cpa')).toEqual({ kind: 'code', code: 'codice del processo amministrativo', article: '110' });
    expect(readQueryCitation('art. 2 Cost.')).toEqual({ kind: 'code', code: 'costituzione', article: '2' });
    expect(readQueryCitation('art. 580 del codice penale')).toEqual({ kind: 'code', code: 'codice penale', article: '580' });
    expect(readQueryCitation('art. 2-bis c.c.')).toEqual({ kind: 'code', code: 'codice civile', article: '2-bis' });
  });

  it('reads a numbered act, with or without an article', () => {
    const act = { kind: 'act', actType: 'legge', number: '219', year: '2017' };
    expect(readQueryCitation('l. 219/2017')).toEqual(act);
    expect(readQueryCitation('legge 219/2017')).toEqual(act);
    expect(readQueryCitation('L. 219/17')).toEqual(act);
    expect(readQueryCitation('legge n. 219 del 2017')).toEqual(act);
    expect(readQueryCitation('legge 22 dicembre 2017 n. 219')).toEqual(act);
    expect(readQueryCitation('art. 1 l. 219/2017')).toEqual({ ...act, article: '1' });
    expect(readQueryCitation('art. 1, comma 2, della legge n. 219 del 2017')).toEqual({ ...act, article: '1' });
    expect(readQueryCitation('d.P.R. 115/2002')).toEqual({
      kind: 'act', actType: 'decreto del presidente della repubblica', number: '115', year: '2002',
    });
    expect(readQueryCitation('dlgs 196/2003')).toEqual({ kind: 'act', actType: 'decreto legislativo', number: '196', year: '2003' });
  });

  it("reads a decision's number and year, the court and section not required", () => {
    const decision = { kind: 'decision', number: '8980', year: '2018' };
    for (const q of ['Cass. n. 8980/2018', 'n. 8980/2018', '8980/2018', 'sent. n. 8980 del 2018', 'Cass., S.U. n 8980/2018']) {
      expect(readQueryCitation(q)).toEqual(decision);
    }
    expect(readQueryCitation('Corte cost. n. 242/2019')).toEqual({ kind: 'decision', number: '242', year: '2019' });
  });

  it('reads a decision only with a court or a marker, or bare with a four-digit year', () => {
    for (const q of ['12/12', '3/04', 'c. 219/2017', '8980 del 2018']) {
      expect(readQueryCitation(q), q).toBeNull();
    }
    expect(readQueryCitation('n. 12/12')).toEqual({ kind: 'decision', number: '12', year: '2012' });
    expect(readQueryCitation('C. cost. n. 242/2019')).toEqual({ kind: 'decision', number: '242', year: '2019' });
    expect(readQueryCitation('S.U. 8980/2018')).toEqual({ kind: 'decision', number: '8980', year: '2018' });
    expect(readQueryCitation('ord. 5/20')).toEqual({ kind: 'decision', number: '5', year: '2020' });
    expect(readQueryCitation('12/2012')).toEqual({ kind: 'decision', number: '12', year: '2012' });
  });

  it("reads the palette's spellings of a constitutional law, and dates in figures", () => {
    const cost = { kind: 'act', actType: 'legge costituzionale', number: '1', year: '2020' };
    for (const q of ['legge cost. 1/2020', 'l. cost. 1/2020', 'legge costituzionale n. 1 del 2020', 'l. costituzionale 1/2020']) {
      expect(readQueryCitation(q), q).toEqual(cost);
    }
    expect(readQueryCitation('l. 1/2020')).toEqual({ ...cost, actType: 'legge' });
    expect(readQueryCitation('D.P.R. 30.5.2002 n. 115')).toEqual({
      kind: 'act', actType: 'decreto del presidente della repubblica', number: '115', year: '2002',
    });
    expect(readQueryCitation('l. 22.12.2017, n. 219')).toEqual({ kind: 'act', actType: 'legge', number: '219', year: '2017' });
  });

  it('is not a citation: an abbreviation alone, an act without number, an article alone, words', () => {
    for (const q of ['c.p.', 'cpa', 'legge', 'la legge sul consenso', 'art. 13', 'art. 13, comma 1-quater', 'art. 580 c.p. e la legge', '219', 'danno ingiusto']) {
      expect(readQueryCitation(q)).toBeNull();
    }
  });
});

describe('findCitationSpans', () => {
  it("finds a code's article in its other forms, never a neighbour", () => {
    const text = CITATION_TEXTS.codeForms;
    expect(found(text, 'art. 580 c.p.')).toEqual(['art. 580 del codice penale', 'art. 580 cod. pen.', 'art. 580 c.p.']);
    expect(found(text, 'art. 580 del codice penale')).toEqual(['art. 580 del codice penale', 'art. 580 cod. pen.', 'art. 580 c.p.']);
    expect(found(text, 'art. 58 c.p.')).toEqual(['art. 58 c.p.']);
  });

  it('finds an article inside a list of articles of the code', () => {
    const text = 'Sono violati gli artt. 2, 13 e 32 Cost., non gli artt. 3 e 31 Cost.';
    expect(cited(text, 'art. 32 Cost.')).toEqual(['artt. 2, 13 e 32 Cost.']);
    expect(cited(text, 'art. 3 Cost.')).toEqual(['artt. 3 e 31 Cost.']);
    expect(cited(text, 'art. 1 Cost.')).toEqual([]);
  });

  it('finds a code written with and without dots, not another code', () => {
    const text = CITATION_TEXTS.codeAbbreviations;
    expect(found(text, 'art 110 cpa')).toEqual(['art. 110 c.p.a.', 'art. 110 del codice del processo amministrativo']);
    expect(found(text, 'art. 2 Cost.')).toEqual(['art. 2 della Costituzione', 'art. 2 Cost.']);
  });

  it('finds a numbered act in every form, never another year or a longer number', () => {
    const text = CITATION_TEXTS.actForms;
    const forms = [
      'legge n. 219 del 2017',
      'l. n. 219/2017',
      'legge 22 dicembre 2017 n. 219',
      'L. 219/17',
      'l. n. 219 del 2017',
      'legge 219/2017',
      'legge 219/2017',
      'legge 219/2017',
      'legge n. 219/2017',
    ];
    expect(found(text, 'l. 219/2017')).toEqual(forms);
    expect(found(text, 'legge 219/2017')).toEqual(forms);
    expect(found(text, 'L. 219/17')).toEqual(forms);
    expect(found(text, 'l. 219/2016')).toEqual(['l. 219/2016']);
  });

  it("finds an act's article before it in the same sentence, or right after it", () => {
    expect(found(CITATION_TEXTS.actForms, 'art. 1 l. 219/2017')).toEqual([
      'art. 1 della l. n. 219 del 2017',
      'art. 1, comma 5, legge 219/2017',
      'legge n. 219/2017, art. 1, comma 3',
    ]);
  });

  it("never finds a law inside another act type's name", () => {
    const text = CITATION_TEXTS.actTypeNames;
    expect(cited(text, 'l. 34/2020')).toEqual(['legge 17 luglio 2020, n. 34', 'l. 34/2020']);
    expect(cited(text, 'legge 34/2020')).toEqual(['legge 17 luglio 2020, n. 34', 'l. 34/2020']);
    expect(cited(text, 'd.l. 34/2020')).toEqual([
      'decreto-legge 19 maggio 2020, n. 34', 'decreto legge n. 34 del 2020', 'd. l. 34/2020', 'd.l. 34/2020',
    ]);
    expect(cited(text, 'r.d.l. 34/2020')).toEqual(['regio decreto-legge n. 34 del 2020', 'r. d. l. 34/2020']);
    expect(cited(text, 'd.lgs. 34/2020')).toEqual(['decreto legislativo 34/2020', 'd. lgs. 34/2020']);
    const constitutional = ['legge costituzionale n. 34 del 2020', 'legge cost. 34/2020', 'l. cost. 34/2020'];
    expect(cited(text, 'l. cost. 34/2020')).toEqual(constitutional);
    expect(cited(text, 'legge cost. 34/2020')).toEqual(constitutional);
  });

  it('finds an act whose date is written in figures', () => {
    const text = CITATION_TEXTS.numericDates;
    expect(cited(text, 'd.P.R. 115/2002')).toEqual(['D.P.R. 30.5.2002 n. 115']);
    expect(cited(text, 'l. 219/2017')).toEqual(['l. 22.12.2017, n. 219']);
    expect(cited(text, 'd.lgs. 196/2003')).toEqual(['d.lgs. n. 196 del 30.6.2003']);
  });

  it('links an article to the act only across a whitelisted gap', () => {
    const q = 'art. 1 l. 219/2017';
    const linked: [string, string][] = [
      ["Si veda l'art. 1 e l'art. 2 della legge 219/2017.", "art. 1 e l'art. 2 della legge 219/2017"],
      ['Si vedano gli artt. 3, 1 e 2 della legge 219/2017.', 'artt. 3, 1 e 2 della legge 219/2017'],
      ['Si veda art. 1, comma 2, lett. b), della legge 219/2017.', 'art. 1, comma 2, lett. b), della legge 219/2017'],
      ['Si veda art. 1, co. 2, legge 219/2017.', 'art. 1, co. 2, legge 219/2017'],
      ['Si veda art. 1, n. 3, della legge 219/2017.', 'art. 1, n. 3, della legge 219/2017'],
      ['Si veda art. 1, numero 3, di cui alla legge 219/2017.', 'art. 1, numero 3, di cui alla legge 219/2017'],
      ['Si veda art. 1 di cui al l. 219/2017.', 'art. 1 di cui al l. 219/2017'],
      ['La legge 219/2017, art. 1, comma 3, dispone.', 'legge 219/2017, art. 1, comma 3'],
    ];
    for (const [text, span] of linked) expect(cited(text, q), text).toEqual([span]);
    expect(cited("Si veda l'art. 1 e l'art. 2 della legge 219/2017.", 'art. 2 l. 219/2017')).toEqual(["art. 2 della legge 219/2017"]);
    const broken = [
      "Si veda l'art. 1 del d.lgs. citato e la legge 219/2017.",
      "Si veda l'art. 1 del regolamento e la legge 219/2017.",
      "Si veda l'art. 1 della legge 300/1970 e la legge 219/2017.",
      "Si veda l'art. 1 della legge, e la legge 219/2017.",
      "Si veda l'art. 1 Cost., legge 219/2017.",
      "Si veda l'art. 1 c.c., legge 219/2017.",
      "Si veda l'art. 1 cod. civ., legge 219/2017.",
      "Si veda l'art. 1 citato, legge 219/2017.",
      "Si veda l'art. 1, n. 3, dell'atto, legge 219/2017.",
      'Si veda art. 1. Legge 219/2017.',
      'Si veda art. 1; legge 219/2017.',
      'La legge 219/2017, art. 1 Cost., dispone.',
      'La legge 219/2017, art. 1 c.c., dispone.',
      'La legge 219/2017, art. 1 del d.lgs. 5/2020, dispone.',
    ];
    for (const text of broken) expect(cited(text, q), text).toEqual([]);
  });

  it('reads the act type from the tables: d.P.R. and d.lgs. are two acts', () => {
    const text = CITATION_TEXTS.dprForms;
    const forms = ['d.P.R. 30 maggio 2002, n. 115', 'd.P.R. n. 115 del 2002', 'D.P.R. 115/2002'];
    expect(found(text, 'd.P.R. 115/2002')).toEqual(forms);
    expect(found(text, 'dpr 115/2002')).toEqual(forms);
    expect(found(text, 'd.lgs. 115/2002')).toEqual(['d.lgs. 115/2002']);
  });

  it("finds a decision's number and year in every form, never a longer number or another year", () => {
    const text = CITATION_TEXTS.decisionForms;
    const forms = ['n 8980/2018', 'n. 8980/2018', 'n. 8980 del 2018', '8980/2018'];
    for (const q of ['Cass. n. 8980/2018', 'n. 8980/2018', '8980/2018', 'sent. n. 8980 del 2018']) {
      expect(cited(text, q)).toEqual(forms);
    }
    expect(cited(text, 'Cass. n. 21748/2007')).toEqual(['n. 21748 del 2007', 'n. 21748/2007']);
    // With the literal match: it covers the court as typed, and the span inside it is kept once.
    expect(found(text, 'Cass. n. 8980/2018')).toEqual(['n 8980/2018', 'Cass. n. 8980/2018', 'n. 8980 del 2018', '8980/2018']);
    expect(found(text, 'n. 8980/2018')).toEqual(forms);
  });

  it("never finds a decision's number and year inside an act's citation", () => {
    expect(cited(CITATION_TEXTS.decisionAndAct, 'Cass. n. 219/2017')).toEqual(['n. 219/2017', 'n. 219 del 2017']);
  });

  it('keeps the offsets of the original text with accents and capitals', () => {
    const text = 'È così: LEGGE N. 219 DEL 2017.';
    const citation = readQueryCitation('l. 219/2017');
    expect(citation).not.toBeNull();
    const spans = findCitationSpans(text, citation!);
    expect(spans.map(([s, e]) => text.slice(s, e))).toEqual(['LEGGE N. 219 DEL 2017']);
  });
});

describe('mergeMatches', () => {
  it('orders by start and joins overlapping matches into their union', () => {
    expect(mergeMatches([[10, 20], [30, 35]], [[0, 5], [12, 18], [10, 22], [34, 40]])).toEqual([[0, 5], [10, 22], [30, 40]]);
    expect(mergeMatches([[0, 4]], [[2, 8], [7, 9]])).toEqual([[0, 9]]);
    expect(mergeMatches([[0, 4]], [[4, 6]])).toEqual([[0, 4], [4, 6]]);
    expect(mergeMatches([], [])).toEqual([]);
  });
});
