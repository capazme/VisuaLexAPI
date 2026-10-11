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
    expect(readQueryCitation('legge 22 dicembre 2017, n. 219')).toEqual(act);
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
      'legge 22 dicembre 2017, n. 219',
      'L. 219/17',
      'legge n. 219 del 2017',
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
      'art. 1 della legge n. 219 del 2017',
      'art. 1, comma 5, legge 219/2017',
      'legge n. 219/2017, art. 1',
    ]);
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

  it('keeps the offsets of the original text with accents and capitals', () => {
    const text = 'È così: LEGGE N. 219 DEL 2017.';
    const citation = readQueryCitation('l. 219/2017');
    expect(citation).not.toBeNull();
    const spans = findCitationSpans(text, citation!);
    expect(spans.map(([s, e]) => text.slice(s, e))).toEqual(['LEGGE N. 219 DEL 2017']);
  });
});

describe('mergeMatches', () => {
  it('orders by start and keeps an overlap once', () => {
    expect(mergeMatches([[10, 20], [30, 35]], [[0, 5], [12, 18], [10, 22], [34, 40]])).toEqual([[0, 5], [10, 22], [30, 35]]);
    expect(mergeMatches([], [])).toEqual([]);
  });
});
