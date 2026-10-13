import { describe, expect, it } from 'vitest';
import { findCitationSpans, matchesWithCitation, mergeMatches, readQueryCitation } from '../citationSearch';
import { findMatches } from '../findInText';
import { CITATION_TEXTS } from '../__fixtures__/citationTexts';

/** What the find window shows for `query` (`useFindWindow`): the literal matches and, for a
 *  citation, the bounded literal matches and the citation's spans, merged. */
function found(text: string, query: string): string[] {
  const literal = findMatches(text, query).matches;
  return (matchesWithCitation(text, query, literal) ?? literal).map(([s, e]) => text.slice(s, e));
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

  it("reads «all'art.» and «dell'art.» as an article's prefix, and an article with no space after the dot", () => {
    const act = { kind: 'act', actType: 'legge', number: '99', year: '2015', article: '1' };
    expect(readQueryCitation("dell'art. 1 della legge 99/2015")).toEqual(act);
    expect(readQueryCitation("all'art. 1 l. 99/2015")).toEqual(act);
    expect(readQueryCitation('art.1 l. 99/2015')).toEqual(act);
    expect(readQueryCitation('art.13 c.c.')).toEqual({ kind: 'code', code: 'codice civile', article: '13' });
    expect(readQueryCitation('Cass. n.8980/2018')).toEqual({ kind: 'decision', number: '8980', year: '2018' });
  });

  it('reads a decision typed date first as its number and year', () => {
    const decision = { kind: 'decision', number: '8980', year: '2018' };
    for (const q of [
      'Cass. 12 aprile 2018, n. 8980',
      'Cass., sez. III, 12 aprile 2018, n. 8980',
      'sent. 12.4.2018 n. 8980',
      'Cass. civ., 12/04/2018, n. 8980',
      'Cass. civ., sez. un., 1° aprile 2018, numero 8980',
    ]) {
      expect(readQueryCitation(q), q).toEqual(decision);
    }
  });

  it('does not read a date first as a decision without a court, with an act, or with a date that is none', () => {
    for (const q of [
      '12 aprile 2018, n. 8980',
      'Cass. 12 aprile 2018, 8980',
      'Cass. in applicazione della legge 12 aprile 2018, n. 8980',
      'Cass. 32 aprile 2018, n. 8980',
      'Cass. 12 aprilo 2018, n. 8980',
      'Cass. 12 aprile 18, n. 8980',
      'Cass. 12 aprile 2018, n. 8980 e 8981',
    ]) {
      expect(readQueryCitation(q), q).toBeNull();
    }
    // An act's date first is an act, never a decision.
    expect(readQueryCitation('legge 12 aprile 2018, n. 8980')).toEqual({ kind: 'act', actType: 'legge', number: '8980', year: '2018' });
    expect(readQueryCitation('decreto legislativo 12 aprile 2018, n. 8980')).toMatchObject({ kind: 'act', actType: 'decreto legislativo' });
  });

  it('reads an article with its ordinal comma, its commi or «e ss.» before or after the act', () => {
    const act = { kind: 'act', actType: 'legge', number: '99', year: '2015', article: '1' };
    for (const q of [
      'art. 1, primo comma, della legge n. 99 del 2015',
      'art. 1, ultimo comma, l. 99/2015',
      'art. 1, secondo e terzo comma, della legge 99/2015',
      'art. 1, commi 2 e 3, della legge n. 99 del 2015',
      'art. 1, commi 2-4, l. 99/2015',
      'art. 1 e ss. della legge n. 99 del 2015',
      'art. 1 e seguenti l. 99/2015',
      'legge 99/2015, art. 1, primo comma',
      'legge 99/2015, art. 1, commi 2 e 3',
      'legge 99/2015, art. 1 e ss.',
    ]) {
      expect(readQueryCitation(q), q).toEqual(act);
    }
  });

  it("reads a code's article with «del», an ordinal comma, «commi» or «e ss.»", () => {
    const c = { kind: 'code', code: 'codice civile', article: '2043' };
    for (const q of [
      'art. 2043 del c.c.',
      'art. 2043 del codice civile',
      'art. 2043 del cod. civ.',
      'art. 2043, primo comma, c.c.',
      'art. 2043, primo comma, del c.c.',
      'art. 2043, commi 2 e 3, c.c.',
      'art. 2043 e ss. c.c.',
      'art. 2043 e seguenti del c.c.',
    ]) {
      expect(readQueryCitation(q), q).toEqual(c);
    }
    expect(readQueryCitation('art. 2 della Cost.')).toEqual({ kind: 'code', code: 'costituzione', article: '2' });
    expect(readQueryCitation('art. 360 del c.p.c.')).toEqual({ kind: 'code', code: 'codice di procedura civile', article: '360' });
    // Still not citations: a list of articles, an article alone, words after the code.
    for (const q of ['artt. 2043 e 2044 del c.c.', 'art. 2043 e ss.', 'art. 2043, primo comma', 'art. 2043 del c.c. e la legge']) {
      expect(readQueryCitation(q), q).toBeNull();
    }
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

  it('never finds a law inside a decree-law whose hyphen takes a space', () => {
    const text = 'Il decreto- legge n. 34 del 2020, il decreto -legge 34/2020 e il decreto - legge 19 maggio 2020, n. 34.';
    for (const q of ['l. 34/2020', 'legge 34/2020', 'legge n. 34 del 2020']) expect(found(text, q), q).toEqual([]);
    expect(cited(text, 'd.l. 34/2020')).toEqual([
      'decreto- legge n. 34 del 2020', 'decreto -legge 34/2020', 'decreto - legge 19 maggio 2020, n. 34',
    ]);
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

  it("links «all'art.» and «dell'art.», and never to a charter, a convention or a treaty", () => {
    const q = 'art. 1 l. 99/2015';
    expect(cited('La legge 99/2015, all\'art. 1, dispone.', q)).toEqual(["legge 99/2015, all'art. 1"]);
    expect(cited('La legge 99/2015, dell\'art. 1, dispone.', q)).toEqual(["legge 99/2015, dell'art. 1"]);
    expect(cited("Si veda l'art. 2 e dell'art. 1 della legge 99/2015.", q)).toEqual(['art. 1 della legge 99/2015']);
    expect(cited("Si veda l'art. 2 e all'art. 1 della legge 99/2015.", q)).toEqual(['art. 1 della legge 99/2015']);
    for (const other of ['della Carta', 'CEDU', 'della Convenzione', 'del Trattato', 'TFUE', 'TUE']) {
      const text = `La legge 99/2015, art. 1 ${other}, dispone.`;
      expect(cited(text, q), text).toEqual([]);
    }
    expect(cited('La legge 99/2015, art. 1 della cartella, dispone.', q)).toEqual(['legge 99/2015, art. 1']);
  });

  it('finds an article and a number written with no space after the dot', () => {
    expect(found("Si veda l'art.13 c.c. e l'art. 13 c.c.", 'art. 13 c.c.')).toEqual(['art.13 c.c.', 'art. 13 c.c.']);
    expect(found('Si veda art.1 della l. n.99/2015.', 'art. 1 l. 99/2015')).toEqual(['art.1 della l. n.99/2015']);
    expect(found('Come Cass. n.8980/2018 afferma.', 'Cass. n. 8980/2018')).toEqual(['Cass. n.8980/2018']);
    expect(found('Come Cass.n.8980/2018 afferma.', 'n. 8980/2018')).toEqual(['n.8980/2018']);
    // The code's other forms too: «art.13» is read as an article.
    expect(found("L'art.13 del codice civile e l'art.2043 cod. civ.", 'art. 13 c.c.')).toEqual(['art.13 del codice civile']);
    expect(found("L'art.13 del codice civile e l'art.2043 cod. civ.", 'art.2043 c.c.')).toEqual(['art.2043 cod. civ.']);
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

  it("never finds a decision's number in a regional law, an act of the Union or a bare decree", () => {
    const acts = [
      'legge regionale n. 99 del 2015',
      'l.r. n. 99/2015',
      'legge reg. Puglia n. 99 del 2015',
      'legge della Regione Veneto n. 99 del 2015',
      'legge della Provincia autonoma di Trento n. 99/2015',
      'legge della Regione Friuli-Venezia Giulia 3 marzo 2015, n. 99',
      'direttiva n. 99/2015',
      'dir. n. 99/2015',
      'regolamento n. 99/2015',
      'Reg. (UE) n. 99/2015',
      'decreto n. 99 del 2015',
      'decreto 3 marzo 2015, n. 99',
    ];
    const text = `${acts.join('; ')}; non Cass. n. 99/2015 né la legge, sentenza n. 99 del 2015.`;
    for (const q of ['Cass. n. 99/2015', 'n. 99/2015', '99/2015']) {
      expect(cited(text, q), q).toEqual(['n. 99/2015', 'n. 99 del 2015']);
    }
    expect(found(text, 'n. 99/2015')).toEqual(['n. 99/2015', 'n. 99 del 2015']);
  });

  it("finds a decision cited date first, never an act, another year or a longer number", () => {
    const text = CITATION_TEXTS.decisionDateFirst;
    const dated = ['12 aprile 2018, n. 8980', '12 aprile 2018, n. 8980', '12.4.2018 n. 8980', '12/04/2018, n. 8980'];
    for (const q of ['Cass. n. 8980/2018', '8980/2018', 'sent. n. 8980 del 2018', 'Cass. 12 aprile 2018, n. 8980', 'sent. 12.4.2018 n. 8980']) {
      expect(cited(text, q), q).toEqual(dated);
    }
    // The window: the query's own words as typed (§13), and the dates around them.
    const court = 'Cass. 12 aprile 2018, n. 8980';
    expect(found(text, court)).toEqual([court, '12 aprile 2018, n. 8980', '12.4.2018 n. 8980', '12/04/2018, n. 8980', court, court]);
    // Another year is another decision: its own date, and nothing of the 2018 ones.
    expect(cited(text, 'Cass. n. 8980/2019')).toEqual(['12 aprile 2019, n. 8980', 'n. 8980/2019', 'n. 8980 del 2019']);
    expect(cited(text, 'Cass. n. 8980/2020')).toEqual([]);
    // A number that is the start of longer ones is none of them.
    expect(cited(text, 'Cass. n. 89/2018')).toEqual([]);
    expect(cited(text, 'Cass. n. 898/2018')).toEqual(['12 aprile 2018, n. 898']);
  });

  it("finds a decision's number whichever way it is cited in the same text", () => {
    const text = 'Cass. 12 aprile 2018, n. 8980; Cass. n. 8980/2018; la n. 8980 del 2018; Cass. 12 aprile 2018 n. 8980/2018.';
    expect(cited(text, 'Cass. n. 8980/2018')).toEqual(['12 aprile 2018, n. 8980', 'n. 8980/2018', 'n. 8980 del 2018', 'n. 8980/2018']);
  });

  it('a date-first decision needs a court or a decision marker before the date', () => {
    const q = 'Cass. n. 8980/2018';
    const decisions: [string, string][] = [
      ['Così Cass. 12 aprile 2018, n. 8980 afferma.', '12 aprile 2018, n. 8980'],
      ['Così Cass. civ., sez. III, 12/04/2018, n. 8980 afferma.', '12/04/2018, n. 8980'],
      ['Così sent. 12.4.2018 n. 8980 afferma.', '12.4.2018 n. 8980'],
      ['Così (ord. 12 aprile 2018, n. 8980) afferma.', '12 aprile 2018, n. 8980'],
      ['Così Corte cost., sentenza 12 aprile 2018, n. 8980 afferma.', '12 aprile 2018, n. 8980'],
      ['Così Cass. 12 aprile 2018 e 13 maggio 2018, n. 8980 afferma.', '13 maggio 2018, n. 8980'],
      ['Così Cons. Stato, sez. VI, ordinanza 12 aprile 2018, n. 8980 afferma.', '12 aprile 2018, n. 8980'],
      ['Così Cass. S.U. 12 aprile 2018, n. 8980 afferma.', '12 aprile 2018, n. 8980'],
    ];
    for (const [text, span] of decisions) expect(cited(text, q), text).toEqual([span]);
    const none = [
      // No court or marker: a ministerial decree, a regional law, an office's act.
      "il decreto del Ministro dell'economia e delle finanze 12 aprile 2018, n. 8980",
      "la legge della Regione autonoma Valle d'Aosta 12 aprile 2018, n. 8980",
      'la legge provinciale della Provincia autonoma di Bolzano 12 aprile 2018, n. 8980',
      'delle leggi 12 aprile 2018, n. 8980 e altre',
      'dei decreti legislativi 12 aprile 2018, n. 8980',
      'dei dd.lgs. 12 aprile 2018, n. 8980',
      'il decreto legislativo 3 marzo 2015 n. 99 e 12 aprile 2018, n. 8980',
      'il T.U. 12 aprile 2018, n. 8980',
      'il testo unico 12 aprile 2018, n. 8980',
      'il d.d.g. 12 aprile 2018, n. 8980',
      'il provvedimento 12 aprile 2018, n. 8980',
      'la delibera 12 aprile 2018, n. 8980',
      'la deliberazione della Giunta regionale 12 aprile 2018, n. 8980',
      "l'ordinanza 12 aprile 2018, n. 8980 del Sindaco",
      'il 12 aprile 2018, n. 8980 persone',
      'il giorno 12.4.2018, n. 8980 di protocollo',
      // A marker too far, or cut off from the date.
      'Cass. ha deciso. Il 12 aprile 2018, n. 8980 persone ne hanno fatto richiesta',
      'Cass. è citata; 12 aprile 2018, n. 8980',
      `Cass. ${'e poi '.repeat(15)}12 aprile 2018, n. 8980`,
      'Cassazione. 12 aprile 2018, n. 8980',
      // An act between the marker and the date.
      'Cass. e la legge 12 aprile 2018, n. 8980',
      'Cass. e il decreto del Ministro 12 aprile 2018, n. 8980',
    ];
    for (const text of none) expect(cited(text, q), text).toEqual([]);
  });

  it('an act of an administrative court is an act, the decree of any other court is a decision', () => {
    const q = 'Cass. n. 5/2018';
    for (const text of ['Il parere del C.d.S. n. 5/2018.', 'Il parere del Consiglio di Stato n. 5/2018.', 'La nota del T.A.R. Lazio n. 5/2018.', 'La nota della Cons. Stato n. 5/2018.']) {
      expect(cited(text, q), text).toEqual([]);
    }
    for (const text of ['Il decreto del Tribunale di Milano n. 5/2018.', 'Il provvedimento del Tribunale di Roma n. 5/2018.', 'Il decreto della Corte d\'appello n. 5/2018.']) {
      expect(cited(text, q), text).toEqual(['n. 5/2018']);
    }
  });

  it('a sentence ends at a full stop after a number, a bracket or a quote, so the marker does not reach over it', () => {
    const q = 'Cass. n. 8980/2018';
    const none = [
      '(Cass. n. 5/2017). Il Comune, con atto 12 aprile 2018, n. 8980, ha disposto',
      'Cass. n. 5/2017. Il 12 aprile 2018, n. 8980 persone',
      'Così (Cass. sez. 3). Il 12 aprile 2018, n. 8980 persone',
      'Come in «Cass. n. 5/2017». Il 12 aprile 2018, n. 8980 persone',
      'Come in "Cass. n. 5/2017". Il 12 aprile 2018, n. 8980 persone',
    ];
    for (const text of none) expect(cited(text, q), text).toEqual([]);
    // The dots of a date are not a sentence's end, and a decision's own dots are not either.
    expect(cited('Cass. 12.4.2018 e 13.4.2018, n. 8980', q)).toEqual(['13.4.2018, n. 8980']);
    expect(cited('Cass. S.U. 12.4.2018, n. 8980', q)).toEqual(['12.4.2018, n. 8980']);
  });

  it('abbreviations of a court, a section or a decision are no end of a sentence, nor are the administrative courts', () => {
    const q = 'Cass. n. 8980/2018';
    const found8980: [string, string][] = [
      ['Cons. giust. amm. Sicilia, 12 aprile 2018, n. 8980', '12 aprile 2018, n. 8980'],
      ['Corte conti, sez. giurisd. 12 aprile 2018, n. 8980', '12 aprile 2018, n. 8980'],
      ['Corte conti, sez. contr. 12 aprile 2018, n. 8980', '12 aprile 2018, n. 8980'],
      ['Cass., ord. interloc. 12 aprile 2018, n. 8980', '12 aprile 2018, n. 8980'],
      ['T.A.R. Lazio 12 aprile 2018, n. 8980', '12 aprile 2018, n. 8980'],
      ['TAR Lazio, Roma, sez. II-bis, 12 aprile 2018, n. 8980', '12 aprile 2018, n. 8980'],
      ['C.d.S. 12 aprile 2018, n. 8980', '12 aprile 2018, n. 8980'],
      ['CdS, sez. IV, 12 aprile 2018, n. 8980', '12 aprile 2018, n. 8980'],
      ['C.G.A. 12 aprile 2018, n. 8980', '12 aprile 2018, n. 8980'],
      ['C.G.A.R.S. 12 aprile 2018, n. 8980', '12 aprile 2018, n. 8980'],
    ];
    for (const [text, span] of found8980) expect(cited(text, q), text).toEqual([span]);
    for (const head of ['T.A.R. Lazio', 'C.d.S.', 'C.G.A.R.S.']) {
      expect(readQueryCitation(`${head} 12 aprile 2018, n. 8980`), head).toEqual({ kind: 'decision', number: '8980', year: '2018' });
    }
  });

  it('«c.d.s.» after an article or a preposition is the codice della strada, never a Consiglio di Stato marker', () => {
    const q = 'Cons. Stato n. 5/2018';
    const none = [
      'verbale ex art. 126-bis c.d.s. 12 aprile 2018, n. 5',
      'art. 142 c.d.s. 12 aprile 2018, n. 5',
      'violazione del c.d.s. del 12 aprile 2018, n. 5',
      'art. 142, comma 8, C.d.S. 12 aprile 2018, n. 5',
      'art. 142 del cds 12 aprile 2018, n. 5',
      'artt. 142 e 143 c.d.s. 12 aprile 2018, n. 5',
    ];
    for (const text of none) expect(cited(text, q), text).toEqual([]);
    const found5: string[] = [
      'C.d.S. 12 aprile 2018, n. 5',
      'CdS, sez. IV, 12 aprile 2018, n. 5',
      'sentenza del C.d.S. 12 aprile 2018, n. 5',
      'art. 142 c.d.s.; C.d.S. 12 aprile 2018, n. 5',
      'Cons. Stato, sez. IV, 12 aprile 2018, n. 5',
    ];
    for (const text of found5) expect(cited(text, q), text).toEqual(['12 aprile 2018, n. 5']);
  });

  it('a sentence that ends on a short abbreviation is not seen as an end (a known ambiguity)', () => {
    const q = 'Cass. n. 8980/2018';
    expect(cited("Cass. n. 5/2017 sull'art. 3 Cost. Il 12 aprile 2018, n. 8980 il Comune", q)).toEqual(['12 aprile 2018, n. 8980']);
    expect(cited('Cass. n. 5/2017 sul c.c. Il 12 aprile 2018, n. 8980 il Comune', q)).toEqual(['12 aprile 2018, n. 8980']);
  });

  it("never finds a decision's number inside an administrative act, cited date first or not", () => {
    const acts = [
      'circolare', 'circ.', 'nota', 'provvedimento', 'provv.', 'delibera', 'delib.', 'deliberazione', 'determina', 'det.',
      'determinazione', 'risoluzione', 'parere',
    ];
    for (const act of acts) {
      for (const form of [`${act} 12 aprile 2018, n. 8980`, `${act} n. 8980/2018`, `${act} n. 8980 del 2018`, `${act} del Ministero n. 8980/2018`]) {
        const text = `Cass. e ${form}, non altro.`;
        expect(cited(text, 'Cass. n. 8980/2018'), text).toEqual([]);
        // The literal match of the number stays out of the act too.
        expect(found(`Si veda la ${form}, non altro.`, 'n. 8980/2018'), form).toEqual([]);
      }
    }
    // «ordinanza» and «sentenza» are decisions.
    expect(cited('Cass., ordinanza n. 8980/2018 e sentenza n. 8980 del 2018.', 'Cass. n. 8980/2018')).toEqual(['n. 8980/2018', 'n. 8980 del 2018']);
    expect(cited('Cass., sentenza 12 aprile 2018, n. 8980.', 'Cass. n. 8980/2018')).toEqual(['12 aprile 2018, n. 8980']);
    expect(readQueryCitation('Cass. circolare 12 aprile 2018, n. 8980')).toBeNull();
  });

  it('links an article to the act through its ordinal comma, its commi or «e ss.»', () => {
    const q = 'art. 1 l. 99/2015';
    const linked: [string, string][] = [
      ['Si veda art. 1, primo comma, della legge 99/2015.', 'art. 1, primo comma, della legge 99/2015'],
      ['Si veda art. 1 primo comma l. 99/2015.', 'art. 1 primo comma l. 99/2015'],
      ['Si veda art. 1, ultimo comma, della l. n. 99 del 2015.', 'art. 1, ultimo comma, della l. n. 99 del 2015'],
      ['Si veda art. 1, decimo comma, legge 99/2015.', 'art. 1, decimo comma, legge 99/2015'],
      ['Si veda art. 1, secondo e terzo comma, della legge 99/2015.', 'art. 1, secondo e terzo comma, della legge 99/2015'],
      ['Si veda art. 1, commi 2 e 3, della legge 99/2015.', 'art. 1, commi 2 e 3, della legge 99/2015'],
      ['Si veda art. 1, commi 2-4, l. 99/2015.', 'art. 1, commi 2-4, l. 99/2015'],
      ['Si veda art. 1, commi 1, 2 e 4, l. 99/2015.', 'art. 1, commi 1, 2 e 4, l. 99/2015'],
      ['Si veda art. 1, primo comma, lett. b), della legge 99/2015.', 'art. 1, primo comma, lett. b), della legge 99/2015'],
      ['Si veda art. 1 e ss. della legge n. 99 del 2015.', 'art. 1 e ss. della legge n. 99 del 2015'],
      ['Si veda artt. 1 e ss. l. 99/2015.', 'artt. 1 e ss. l. 99/2015'],
      ['Si veda art. 1 e seguenti della legge 99/2015.', 'art. 1 e seguenti della legge 99/2015'],
      ['Si veda art. 1 ss. della legge 99/2015.', 'art. 1 ss. della legge 99/2015'],
      ['Si veda art. 1, comma 2, e ss. della legge 99/2015.', 'art. 1, comma 2, e ss. della legge 99/2015'],
      ['La legge 99/2015, art. 1, primo comma, dispone.', 'legge 99/2015, art. 1, primo comma'],
      ['La legge 99/2015, art. 1, commi 2 e 3, dispone.', 'legge 99/2015, art. 1, commi 2 e 3'],
      ['La legge 99/2015, art. 1 e ss., dispone.', 'legge 99/2015, art. 1 e ss.'],
      ['La legge 99/2015, art. 1, secondo e terzo comma, dispone.', 'legge 99/2015, art. 1, secondo e terzo comma'],
    ];
    for (const [text, span] of linked) expect(cited(text, q), text).toEqual([span]);
    // «e ss.» is not an article of its own: the span starts at the article the query names.
    expect(cited("Si veda l'art. 2 e l'art. 1 e ss. della legge 99/2015.", q)).toEqual(['art. 1 e ss. della legge 99/2015']);
    expect(cited("Si veda l'art. 1 e ss. e l'art. 2 della legge 99/2015.", 'art. 2 l. 99/2015')).toEqual(["art. 2 della legge 99/2015"]);
    expect(cited('Si veda art. 480, terzo comma, della legge 99/2015.', 'art. 480 l. 99/2015')).toEqual(['art. 480, terzo comma, della legge 99/2015']);
    expect(cited('Si veda art. 480, terzo comma, della legge 99/2015.', 'art. 480-ter l. 99/2015')).toEqual([]);
  });

  it('breaks the link at another article, another act, a code, a full stop or a semicolon', () => {
    const q = 'art. 1 l. 99/2015';
    const broken = [
      'Si veda art. 2, primo comma, della legge 99/2015.',
      'Si veda art. 3 e ss. della legge 99/2015.',
      'Si veda art. 11, commi 2 e 3, della legge 99/2015.',
      'Si veda art. 1, primo comma, della legge 300/1970 e la legge 99/2015.',
      'Si veda art. 1, primo comma, Cost., legge 99/2015.',
      'Si veda art. 1 e ss. c.c., legge 99/2015.',
      'Si veda art. 1, primo comma. Legge 99/2015.',
      'Si veda art. 1, primo comma; legge 99/2015.',
      'Si veda art. 1 e ss.; legge 99/2015.',
      'Si veda art. 1, primo comma, citato, legge 99/2015.',
      'Si veda art. 1, commi 2 e 3, del regolamento e la legge 99/2015.',
      'Si veda art. 1 e ss. del d.lgs. 5/2020 e la legge 99/2015.',
      'Si veda art. 1, primo periodo, della legge 99/2015.',
      'La legge 99/2015, art. 1, primo comma, Cost., dispone.',
      'La legge 99/2015, art. 1 e ss. c.c., dispone.',
      'La legge 99/2015, art. 1, commi 2 e 3, del d.lgs. 5/2020, dispone.',
      'La legge 99/2015, art. 2, primo comma, dispone.',
    ];
    for (const text of broken) expect(cited(text, q), text).toEqual([]);
  });

  it('«ss.» before an act type is read as «e ss.», not as the end of a sentence (a known ambiguity)', () => {
    expect(cited('Si veda art. 1 e ss. Legge 99/2015, che dispone.', 'art. 1 l. 99/2015')).toEqual(['art. 1 e ss. Legge 99/2015']);
    expect(cited('Si veda artt. 1 e ss. L. 99/2015.', 'art. 1 l. 99/2015')).toEqual(['artt. 1 e ss. L. 99/2015']);
  });

  it("finds a code's article with «del», an ordinal comma, «commi» or «e ss.», never another article or code", () => {
    const text = CITATION_TEXTS.codeLinks;
    const forms = [
      'art. 2043 del c.c.',
      'art. 2043, primo comma, c.c.',
      'art. 2043 e ss. c.c.',
      'art. 2043, commi 2 e 3, del cod. civ.',
      'art. 2043, secondo e terzo comma, del codice civile',
    ];
    for (const q of ['art. 2043 c.c.', 'art. 2043 del c.c.', 'art. 2043 del codice civile', 'art. 2043, primo comma, c.c.']) {
      expect(cited(text, q), q).toEqual(forms);
    }
    expect(cited(text, 'art. 2043 c.p.c.')).toEqual(['art. 2043 del c.p.c.']);
    expect(cited(text, 'art. 2043 c.p.')).toEqual(['art. 2043 del c.p.']);
    expect(cited(text, 'art. 2043 Cost.')).toEqual(['art. 2043 della Costituzione', 'art. 2043 della Cost.']);
    expect(cited(text, 'art. 2044 c.c.')).toEqual(['art. 2044 del c.c.']);
    // The literal match with a final dot stays bounded: «c.p.» is not the start of «c.p.c.».
    expect(found(text, 'art. 2043 del c.p.')).toEqual(['art. 2043 del c.p.']);
  });

  it('finds the articles of a list with «del c.c.», and «dell\'art.» before the code', () => {
    const text = "Gli artt. 2043 e 2044 del c.c. e l'art. 2043 del c.c.";
    expect(cited(text, 'art. 2044 c.c.')).toEqual(['artt. 2043 e 2044 del c.c.']);
    expect(cited("Si veda dell'art. 5 del c.c.", 'art. 5 c.c.')).toEqual(['art. 5 del c.c.']);
  });

  it('keeps the offsets of the original text with accents and capitals', () => {
    const text = 'È così: LEGGE N. 219 DEL 2017.';
    const citation = readQueryCitation('l. 219/2017');
    expect(citation).not.toBeNull();
    const spans = findCitationSpans(text, citation!);
    expect(spans.map(([s, e]) => text.slice(s, e))).toEqual(['LEGGE N. 219 DEL 2017']);
  });
});

describe('the window: literal matches bounded as the citation spans are', () => {
  it('never finds a law inside a decree-law, however the type is written', () => {
    const text = CITATION_TEXTS.actTypeNames;
    expect(found(text, 'l. 34/2020')).toEqual(['legge 17 luglio 2020, n. 34', 'l. 34/2020']);
    expect(found(text, 'legge 34/2020')).toEqual(['legge 17 luglio 2020, n. 34', 'l. 34/2020']);
    const numbered = 'Il d.l. n. 34/2020, il d. l. n. 34/2020, il r.d.l. n. 34/2020 e la l. n. 34/2020.';
    expect(found(numbered, 'l. n. 34/2020')).toEqual(['l. n. 34/2020']);
    expect(found(numbered, 'd.l. n. 34/2020')).toEqual(['d.l. n. 34/2020', 'd. l. n. 34/2020']);
  });

  it('never starts right after a letter, a digit or a dot', () => {
    expect(found('la xl. 34/2020, la 1l. 34/2020, la .l. 34/2020', 'l. 34/2020')).toEqual([]);
    expect(found("dell'art. 1 c.p. e (art. 1 c.p.)", 'art. 1 c.p.')).toEqual(['art. 1 c.p.', 'art. 1 c.p.']);
  });

  it('a query ending with a dot never ends right before a letter', () => {
    const text = 'Gli art. 1 c.p.c., art. 1 c.p.p. e art. 1 c.p. vigente.';
    expect(found(text, 'art. 1 c.p.')).toEqual(['art. 1 c.p.']);
    expect(found('Si veda art. 360 c.p.c., n. 3.', 'art. 360 c.p.')).toEqual([]);
    expect(found('Si veda art. 360 c.p.c., n. 3.', 'art. 360 c.p.c.')).toEqual(['art. 360 c.p.c.']);
  });

  it("a decision's number never inside an act's citation", () => {
    const text = 'La l. n. 99/2015 e la legge n. 99 del 2015, non la sentenza n. 99/2015.';
    expect(found(text, 'n. 99/2015')).toEqual(['n. 99/2015']);
    expect(found(text, 'Cass. n. 99/2015')).toEqual(['n. 99/2015']);
    expect(found(text, 'n. 99 del 2015')).toEqual(['n. 99/2015']);
  });

  it('a query that is not a citation keeps every literal match', () => {
    expect(matchesWithCitation('il d.l. citato', 'l. citato', [[5, 14]])).toBeNull();
    expect(found('il d.l. citato', 'l. citato')).toEqual(['l. citato']);
  });
});

describe('the new patterns stay linear on hostile text', () => {
  const bounded = (text: string, queries: string[]) => {
    const t0 = performance.now();
    for (const q of queries) found(text, q);
    return performance.now() - t0;
  };

  it('a long run of spaces, commas or connectors after an article', () => {
    const queries = ['art. 1 l. 99/2015', 'art. 1 c.c.', 'Cass. n. 8980/2018', 'art. 1 del c.c.'];
    const texts = [
      `art. 1${' '.repeat(3000)}x legge 99/2015`,
      `art. 1${', '.repeat(8000)}primo comma`,
      `art. 1${' e ss.'.repeat(4000)} della legge 99/2015`,
      `art. 1, commi ${'2, '.repeat(6000)}x legge 99/2015`,
      `art. 1, ${'primo e '.repeat(4000)}comma c.c.`,
      `Cass. 12 aprile 2018${' '.repeat(3000)}n. 8980x`,
      `12 aprile 2018,${' , '.repeat(8000)}n. 8980`,
      `${'art. 1 del '.repeat(3000)}c.c.`,
      `${'art. 1, primo comma, '.repeat(2000)}legge 99/2015`,
    ];
    for (const text of texts) expect(bounded(text, queries), text.slice(0, 40)).toBeLessThan(2000);
  });

  it('a long query typed date first', () => {
    const t0 = performance.now();
    const read = ['Cass.' + ' x'.repeat(5000) + ' 12 aprile 2018, n. 8980x', 'Cass.' + ', '.repeat(5000) + '12 aprile 2018, n. 8980x'].map(readQueryCitation);
    expect(read).toEqual([null, null]);
    expect(performance.now() - t0).toBeLessThan(2000);
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
