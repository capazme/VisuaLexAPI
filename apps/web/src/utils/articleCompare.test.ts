import { describe, expect, it } from 'vitest';
import type { ArticleData, ArticleValidity, NormaVisitata } from '../types';
import {
  compareArticles,
  compareKindOf,
  DIFF_WORD_CAP,
  diffSequences,
  summarySentence,
  type ArticleComparison,
  type CompareRow,
  type CompareUnit,
} from './articleCompare';
import { ARTICLE_FIXTURES, fixtureText } from './__fixtures__/articleTexts';

const CC: NormaVisitata = { tipo_atto: 'codice civile', data: '', numero_articolo: '1284' };

function article(text: string, norma: Partial<NormaVisitata> = {}, extra: Partial<ArticleData> = {}): ArticleData {
  return { article_text: text, norma_data: { ...CC, ...norma }, ...extra };
}
const at = (date: string) => ({ versione: 'vigente', data_versione: date });
const original = { versione: 'originale' };

const textOf = (raw: string, unit: { start: number; end: number }) => raw.slice(unit.start, unit.end);
const labels = (c: ArticleComparison) => c.rows.map((r) => r.label);
const sliced = (raw: string, ranges: ReadonlyArray<{ start: number; end: number }>) => ranges.map((r) => textOf(raw, r));

/** Normattiva's shape: heading, parenthesised rubric, commi apart by a blank line. */
const normattiva = (heading: string, rubric: string | null, commi: string[]) =>
  [heading, ...(rubric ? [`(${rubric}).`] : []), ...commi].join(' \n\n ');

/** n words that share no word with `wordsOf(n, other)`. */
const wordsOf = (n: number, tag = 'p', from = 0) => Array.from({ length: n }, (_, i) => `${tag}${from + i}x`).join(' ');

function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}
const LEXICON = Array.from({ length: 400 }, (_, i) => `voce${i.toString(36)}`);
function prose(next: () => number, words: number): string {
  return Array.from({ length: words }, () => LEXICON[Math.floor(next() * LEXICON.length)]).join(' ');
}

describe('kind (D1)', () => {
  it('is «versions» for one article in two versions, in either order', () => {
    expect(compareKindOf(article('a', at('2015-12-31')), article('b'))).toBe('versions');
    expect(compareKindOf(article('a'), article('b', original))).toBe('versions');
  });
  it('is «articles» for two articles, and for one article twice in the same version', () => {
    expect(compareKindOf(article('a'), article('b', { numero_articolo: '2043' }))).toBe('articles');
    expect(compareKindOf(article('a'), article('b'))).toBe('articles');
    expect(compareKindOf(article('a', at('2015-12-31')), article('b', { ...at('2015-12-31'), numero_articolo: '1285' }))).toBe('articles');
  });
  it('tells an article of one act from the same number in another', () => {
    expect(compareKindOf(article('a', at('2015-12-31')), article('b', { tipo_atto: 'codice penale' }))).toBe('articles');
  });
});

describe('which side is older (versions)', () => {
  const older = (l: Partial<NormaVisitata>, r: Partial<NormaVisitata>, lv?: ArticleValidity, rv?: ArticleValidity) =>
    compareArticles(article('x', l, { validity: lv }), article('x', r, { validity: rv })).older;
  const validity = (from: string | null): ArticleValidity => ({
    state: 'historical', valid_from: from, valid_to: null, version_number: 1, act_updated: null, request_in_window: true,
  });

  it('reads the request: a day is older than the text in force', () => {
    expect(older(at('2015-12-31'), {})).toBe('left');
    expect(older({}, at('2015-12-31'))).toBe('right');
  });
  it('reads the request: the original is older than any day and than the text in force', () => {
    expect(older(original, at('1950-01-01'))).toBe('left');
    expect(older(at('1950-01-01'), original)).toBe('right');
    expect(older({}, original)).toBe('right');
  });
  it('orders two days', () => {
    expect(older(at('2007-12-29'), at('2015-12-31'))).toBe('left');
    expect(older(at('2015-12-31'), at('2007-12-29'))).toBe('right');
  });
  it('falls back on the validity windows when a day is not an ISO date', () => {
    expect(older(at('31/12/2015'), at('29/12/2007'), validity('2015-01-01'), validity('2007-01-01'))).toBe('right');
    expect(older(at('31/12/2015'), at('29/12/2007'), validity('2007-01-01'), validity('2015-01-01'))).toBe('left');
  });
  it('falls back on the left when nothing says', () => {
    expect(older(at('31/12/2015'), at('29/12/2007'))).toBe('left');
  });
  it('is the left for two articles', () => {
    expect(compareArticles(article('x'), article('y', { numero_articolo: '2043' })).older).toBe('left');
  });
});

describe('pairing by the printed number (D2)', () => {
  const oldRaw = normattiva('Art. 1000.', 'Rubrica', [
    '1. Il debitore risponde dell\'inadempimento con tutti i suoi beni presenti e futuri.',
    '2. Il creditore può agire in via esecutiva sui beni del debitore secondo le norme del codice di procedura.',
    '3. Restano salve le cause legittime di prelazione previste dalla legge.',
  ]);
  const newRaw = normattiva('Art. 1000.', 'Rubrica', [
    '1. Il debitore risponde dell\'inadempimento con tutti i suoi beni presenti e futuri.',
    '((1-bis. Il debitore persona fisica risponde nei limiti stabiliti dalla legge speciale in materia di esdebitazione.))',
    '2. Il creditore può agire in via esecutiva sui beni del debitore secondo le norme del codice di procedura.',
    '3. Restano salve le cause legittime di prelazione previste dalla legge.',
  ]);
  const comparison = compareArticles(article(oldRaw, at('2015-12-31')), article(newRaw));

  it('pairs 1, 1-bis (added), 2, 3 in the order of the text', () => {
    expect(labels(comparison)).toEqual(['invariato', 'aggiunto', 'invariato', 'invariato']);
    expect(comparison.rows.map((r) => r.left?.number ?? null)).toEqual(['1', null, '2', '3']);
    expect(comparison.rows.map((r) => r.right?.number ?? null)).toEqual(['1', '1-bis', '2', '3']);
  });
  it('gives the units as ranges of each side\'s own text', () => {
    const added = comparison.rows[1].right as CompareUnit;
    expect(textOf(newRaw, added).trim()).toMatch(/^\(\(1-bis\. Il debitore persona fisica.*esdebitazione\.\)\)$/);
    expect(comparison.rows[1].left).toBeUndefined();
  });
  it('pairs by number even when the comma is rewritten', () => {
    const rewritten = normattiva('Art. 1000.', null, ['1. Tutt\'altra disciplina, con parole nuove e diverse da quelle di prima.']);
    const c = compareArticles(article(oldRaw.replace(/ \n\n 2\..*$/s, ''), at('2015-12-31')), article(rewritten));
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0].label).toBe('riscritto');
    expect(c.rows[0].left?.number).toBe('1');
    expect(c.rows[0].right?.number).toBe('1');
  });
  it('normalises 01., 1-bis., ((2-ter. and 4.1.', () => {
    const raw = '01. Alfa beta gamma.\n\n((1-bis. Delta epsilon zeta.))\n\n((2-ter. Eta theta iota.))\n\n4.1. Kappa lambda mi.';
    const c = compareArticles(article(raw, at('2015-12-31')), article(raw));
    expect(c.rows.map((r) => r.left?.number)).toEqual(['1', '1-bis', '2-ter', '4.1']);
  });
});

describe('pairing by content (D2)', () => {
  const comma = (n: number) => `Questa disposizione regola il caso numero ${wordsOf(12, 'c' + n)} secondo la volontà delle parti.`;
  const base = [1, 2, 3, 4, 5].map(comma);
  const oldRaw = normattiva('Art. 2000.', 'Rubrica', base);

  it('shows a comma inserted in the middle of an unnumbered code article as «aggiunto», the others «invariato»', () => {
    const inserted = [...base.slice(0, 2), 'Un comma del tutto nuovo, introdotto da una riforma recente di cui nessun altro contiene le parole.', ...base.slice(2)];
    const c = compareArticles(article(oldRaw, at('2015-12-31')), article(normattiva('Art. 2000.', 'Rubrica', inserted)));
    expect(labels(c)).toEqual(['invariato', 'invariato', 'aggiunto', 'invariato', 'invariato', 'invariato']);
    expect(c.rows[2].left).toBeUndefined();
    expect(c.summary.counts).toMatchObject({ invariato: 5, aggiunto: 1 });
  });
  it('shows a comma removed as «abrogato», the next ones keeping their pair', () => {
    const removed = [...base.slice(0, 1), ...base.slice(2)];
    const c = compareArticles(article(oldRaw, at('2015-12-31')), article(normattiva('Art. 2000.', 'Rubrica', removed)));
    expect(labels(c)).toEqual(['invariato', 'abrogato', 'invariato', 'invariato', 'invariato']);
    expect(c.rows[1].right).toBeUndefined();
  });
  it('an insertion and a removal at once', () => {
    const edited = [base[0], 'Un comma nuovo con parole mai viste prima in questo articolo del codice.', base[2], base[3]];
    const c = compareArticles(article(oldRaw, at('2015-12-31')), article(normattiva('Art. 2000.', 'Rubrica', edited)));
    expect(c.summary.counts).toMatchObject({ invariato: 3, abrogato: 2, aggiunto: 1 });
    expect(c.rows.filter((r) => r.left && r.right).every((r) => r.label === 'invariato')).toBe(true);
  });
  it('keeps the order: an older-only comma comes before a newer-only one at the same place', () => {
    const swapped = [base[0], 'Parole interamente diverse e nuove, nessuna in comune con il comma sostituito.', base[2], base[3], base[4]];
    const c = compareArticles(article(oldRaw, at('2015-12-31')), article(normattiva('Art. 2000.', 'Rubrica', swapped)));
    expect(labels(c).slice(0, 3)).toEqual(['invariato', 'abrogato', 'aggiunto']);
  });
  it('pairs a modified comma by its words when no number helps', () => {
    const edited = [...base];
    edited[1] = base[1].replace('secondo la volontà delle parti', 'secondo la volontà dei contraenti');
    const c = compareArticles(article(oldRaw, at('2015-12-31')), article(normattiva('Art. 2000.', 'Rubrica', edited)));
    expect(labels(c)).toEqual(['invariato', 'modificato', 'invariato', 'invariato', 'invariato']);
  });
  it('pairs a numbered comma with an unnumbered one only when the words agree', () => {
    const numbered = compareArticles(
      article(`1. ${comma(1)}`, at('2015-12-31')),
      article(comma(1)),
    );
    expect(numbered.rows).toHaveLength(1);
    expect(numbered.rows[0].label).toBe('modificato');
    const unrelated = compareArticles(article(`1. ${comma(1)}`, at('2015-12-31')), article(wordsOf(20, 'z')));
    expect(labels(unrelated)).toEqual(['abrogato', 'aggiunto']);
  });
});

describe('labels (D3)', () => {
  const withMarker = (words: string[]) => words.join(' ');
  /** Two commi of 100 words of which `shared` are the same. */
  const pairOf = (shared: number) => {
    const a = withMarker(Array.from({ length: 100 }, (_, i) => `s${i}x`));
    const b = withMarker(Array.from({ length: 100 }, (_, i) => (i < shared ? `s${i}x` : `t${i}x`)));
    return compareArticles(article(a, at('2015-12-31')), article(b)).rows;
  };

  it('is «modificato» at exactly 60% shared words and «riscritto» at 59%', () => {
    expect(pairOf(60).map((r) => r.label)).toEqual(['modificato']);
    expect(pairOf(59).map((r) => r.label)).toEqual(['riscritto']);
  });
  it('measures against the longer comma', () => {
    // 60 words kept inside a comma that grew to 110: 60/110 < 0.6
    const a = Array.from({ length: 100 }, (_, i) => `s${i}x`).slice(0, 60).join(' ');
    const longer = `${a} ${wordsOf(50, 'u')}`;
    expect(compareArticles(article(a, at('2015-12-31')), article(longer)).rows[0].label).toBe('riscritto');
    expect(compareArticles(article(a, at('2015-12-31')), article(`${a} ${wordsOf(40, 'u')}`)).rows[0].label).toBe('modificato');
  });
  it('folds case and punctuation in the measure, but not in «invariato»', () => {
    const a = 'Il Debitore, che non adempie, risponde del danno.';
    const b = 'il debitore che non adempie risponde del danno';
    const row = compareArticles(article(a, at('2015-12-31')), article(b)).rows[0];
    expect(row.label).toBe('modificato');
  });
  it('is «invariato» when only whitespace and the «(( ))» marks differ', () => {
    const a = '1. Il debitore  \t risponde   del danno.';
    const b = '1. ((Il debitore risponde del danno.))';
    expect(compareArticles(article(a, at('2015-12-31')), article(b)).rows[0].label).toBe('invariato');
  });
  it('is «abrogato» when the newer text is a repeal notice, even paired by number', () => {
    const oldRaw = normattiva('Art. 1.', null, ['1. Il debitore risponde dell\'inadempimento con tutti i suoi beni.', '2. Altro comma che resta.']);
    const newRaw = normattiva('Art. 1.', null, ['1. ((COMMA ABROGATO DAL D.LGS. 10 OTTOBRE 2022, N. 149))', '2. Altro comma che resta.']);
    const c = compareArticles(article(oldRaw, at('2015-12-31')), article(newRaw));
    expect(labels(c)).toEqual(['abrogato', 'invariato']);
    expect(c.rows[0].left).toBeDefined();
    expect(c.rows[0].right).toBeDefined();
    expect(c.rows[0].diff).toBeUndefined();
  });
  it('is «abrogato» for a bare upper-case notice, and «invariato» when both sides carry the same notice', () => {
    const oldRaw = '1. Il debitore risponde.\n\n2. COMMA ABROGATO DALLA L. 27 MAGGIO 2015, N. 69';
    const newRaw = '1. Il debitore risponde.\n\n2. COMMA ABROGATO DALLA L. 27 MAGGIO 2015, N. 69';
    expect(labels(compareArticles(article(oldRaw, at('2015-12-31')), article(newRaw)))).toEqual(['invariato', 'invariato']);
    const live = '1. Il debitore risponde.\n\n2. Il creditore può agire in via esecutiva.';
    expect(labels(compareArticles(article(live, at('2015-12-31')), article(newRaw)))).toEqual(['invariato', 'abrogato']);
  });
  it('does not take an ordinary comma with a modification for a notice', () => {
    const oldRaw = '1. Il debitore risponde del danno.';
    const newRaw = '1. ((Il debitore risponde del danno cagionato.))';
    expect(compareArticles(article(oldRaw, at('2015-12-31')), article(newRaw)).rows[0].label).toBe('modificato');
  });
  it('labels a comma with its items as one unit', () => {
    const oldRaw = normattiva('Art. 5.', null, ['4. Il principio costituisce criterio prioritario per:\n\na) valutare la responsabilità del personale;\n\nb) attribuire gli incentivi.']);
    const newRaw = normattiva('Art. 5.', null, ['4. Il principio costituisce criterio prioritario per:\n\na) valutare la responsabilità del personale;\n\nb) attribuire gli incentivi previsti.']);
    const c = compareArticles(article(oldRaw, at('2015-12-31')), article(newRaw));
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0].label).toBe('modificato');
    expect(c.rows[0].left?.items).toHaveLength(2);
    expect(sliced(oldRaw, c.rows[0].diff!.left)).toEqual(['incentivi.']);
    expect(sliced(newRaw, c.rows[0].diff!.right)).toEqual(['incentivi previsti.']);
  });
});

describe('note references are not compared', () => {
  const withNote = (body: string, id: string) =>
    `1. ${body} (${id})\n\n-------------\nAGGIORNAMENTO (${id})\n\n Il D.Lgs. 1 gennaio 2020, n. 1 ha disposto la modifica.`;

  it('is «invariato» when a comma differs only in the number of its update note', () => {
    const c = compareArticles(
      article(withNote('Il saggio degli interessi legali è determinato in misura pari al 5 per cento in ragione d\'anno.', '129'), at('2015-12-31')),
      article(withNote('Il saggio degli interessi legali è determinato in misura pari al 5 per cento in ragione d\'anno.', '348')),
    );
    expect(c.rows.map((r) => r.label)).toEqual(['invariato']);
  });
  it('is «invariato» when a note reference is added, including the ((49)) form', () => {
    const body = 'Il saggio degli interessi legali è determinato in misura pari al 5 per cento in ragione d\'anno.';
    const bare = `1. ${body}`;
    expect(compareArticles(article(bare, at('2015-12-31')), article(withNote(body, '129'))).rows[0].label).toBe('invariato');
    const double = `1. ${body} ((49))\n\n-------------\nAGGIORNAMENTO (49)\n\n Nota.`;
    expect(compareArticles(article(bare, at('2015-12-31')), article(double)).rows[0].label).toBe('invariato');
  });
  it('keeps the reference out of the diff and out of the measure of a word that did change', () => {
    const oldRaw = withNote('Il saggio degli interessi legali è determinato in misura pari al 5 per cento in ragione d\'anno.', '129');
    const newRaw = withNote('Il saggio degli interessi legali è determinato in misura pari al 10 per cento in ragione d\'anno.', '348');
    const row = compareArticles(article(oldRaw, at('2015-12-31')), article(newRaw)).rows[0];
    expect(row.label).toBe('modificato');
    expect(sliced(oldRaw, row.diff!.left)).toEqual(['5']);
    expect(sliced(newRaw, row.diff!.right)).toEqual(['10']);
  });
  it('still compares a parenthesised number that no update note explains', () => {
    const c = compareArticles(article('1. Il termine è di trenta giorni (30).', at('2015-12-31')), article('1. Il termine è di trenta giorni (60).'));
    expect(c.rows[0].label).toBe('modificato');
  });
});

describe('the rubric', () => {
  it('is labelled the same way', () => {
    const oldRaw = normattiva('Art. 1284.', 'Saggio degli interessi', ['1. Il saggio è del cinque per cento.']);
    const same = compareArticles(article(oldRaw, at('2015-12-31')), article(oldRaw));
    expect(same.rubric?.label).toBe('invariato');
    const changed = compareArticles(
      article(oldRaw, at('2015-12-31')),
      article(normattiva('Art. 1284.', 'Saggio degli interessi legali', ['1. Il saggio è del cinque per cento.'])),
    );
    expect(changed.rubric?.label).toBe('modificato');
    expect(changed.summary.rubric).toBe('modificato');
    expect(changed.rows.map((r) => r.label)).toEqual(['invariato']);
  });
  it('is «aggiunto» or «abrogato» when only one side has one', () => {
    const withRubric = normattiva('Art. 1.', 'Rubrica del tutto nuova', ['1. Il saggio è del cinque per cento.']);
    const without = normattiva('Art. 1.', null, ['1. Il saggio è del cinque per cento.']);
    expect(compareArticles(article(without, at('2015-12-31')), article(withRubric)).rubric?.label).toBe('aggiunto');
    expect(compareArticles(article(withRubric, at('2015-12-31')), article(without)).rubric?.label).toBe('abrogato');
    expect(compareArticles(article(without, at('2015-12-31')), article(without)).rubric).toBeUndefined();
  });
  it('is not a unit, and neither is the heading', () => {
    const raw = normattiva('Art. 1284.', 'Saggio degli interessi', ['1. Primo.', '2. Secondo.']);
    const c = compareArticles(article(raw, at('2015-12-31')), article(raw));
    expect(c.rows).toHaveLength(2);
    expect(c.rubric?.left?.kind).toBe('rubric');
    expect(c.rows.every((r) => r.left?.kind === 'comma')).toBe(true);
  });
});

describe('the word diff (D4)', () => {
  it('gives the deleted words on the older side and the inserted ones on the newer, as ranges', () => {
    const oldRaw = '1. Il saggio degli interessi legali è determinato in misura pari al 5 per cento in ragione d\'anno.';
    const newRaw = '1. Il saggio degli interessi legali è determinato in misura pari al 10 per cento in ragione d\'anno.';
    const c = compareArticles(article(oldRaw, at('2007-12-29')), article(newRaw));
    const diff = c.rows[0].diff!;
    expect(sliced(oldRaw, diff.left)).toEqual(['5']);
    expect(sliced(newRaw, diff.right)).toEqual(['10']);
  });
  it('puts the ranges on the right sides when the left is the newer text', () => {
    const oldRaw = '1. Il saggio degli interessi legali è determinato in misura pari al 5 per cento in ragione d\'anno.';
    const newRaw = '1. Il saggio degli interessi legali è determinato in misura pari al 10 per cento in ragione d\'anno.';
    const c = compareArticles(article(newRaw), article(oldRaw, at('2007-12-29')));
    expect(c.older).toBe('right');
    expect(sliced(oldRaw, c.rows[0].diff!.right)).toEqual(['5']);
    expect(sliced(newRaw, c.rows[0].diff!.left)).toEqual(['10']);
    expect(c.rows[0].left?.number).toBe('1');
  });
  it('joins a run of changed words into one range and does not count the «(( ))» marks as words', () => {
    const oldRaw = '1. Il debitore che non adempie risponde con tutti i suoi beni presenti e futuri del danno cagionato al creditore.';
    const newRaw = '1. Il debitore che non adempie risponde ((con il solo patrimonio personale)) del danno cagionato al creditore.';
    const c = compareArticles(article(oldRaw, at('2015-12-31')), article(newRaw));
    const diff = c.rows[0].diff!;
    expect(sliced(oldRaw, diff.left)).toEqual(['tutti i suoi beni presenti e futuri']);
    expect(sliced(newRaw, diff.right)).toEqual(['il solo patrimonio personale))']);
  });
  it('is absent for the other labels', () => {
    const c = compareArticles(article('1. Alfa beta gamma.', at('2015-12-31')), article('1. Alfa beta gamma.'));
    expect(c.rows[0].diff).toBeUndefined();
  });
  it('is dropped above the cap: the comma is «riscritto», not «modificato»', () => {
    const base = wordsOf(DIFF_WORD_CAP + 1);
    const edited = base.replace('p10x', 'changed');
    const over = compareArticles(article(base, at('2015-12-31')), article(edited)).rows[0];
    expect(over.label).toBe('riscritto');
    expect(over.diff).toBeUndefined();
    const atCap = wordsOf(DIFF_WORD_CAP);
    const ok = compareArticles(article(atCap, at('2015-12-31')), article(atCap.replace('p10x', 'changed'))).rows[0];
    expect(ok.label).toBe('modificato');
    expect(ok.diff?.left).toHaveLength(1);
  });
});

describe('a text with no commi', () => {
  it('is one unit (a one-paragraph EUR-Lex article)', () => {
    const oldRaw = 'Articolo 3\nIl presente regolamento si applica al trattamento dei dati personali effettuato nell\'ambito delle attività di uno stabilimento.';
    const newRaw = 'Articolo 3\nIl presente regolamento si applica al trattamento dei dati personali effettuato nel contesto delle attività di uno stabilimento.';
    const c = compareArticles(article(oldRaw, at('2015-12-31')), article(newRaw));
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0].label).toBe('modificato');
    expect(c.summary.commi).toEqual({ left: 1, right: 1 });
  });
  it('is one unit when the parser finds no heading either', () => {
    const c = compareArticles(article('Soltanto un periodo senza numero.', at('2015-12-31')), article('Soltanto un periodo senza numero.'));
    expect(c.rows).toHaveLength(1);
  });
  it('is no unit at all for an empty text or a bare heading', () => {
    expect(compareArticles(article('', at('2015-12-31')), article('')).rows).toEqual([]);
    expect(compareArticles(article('Art. 3', at('2015-12-31')), article('Art. 3')).rows).toEqual([]);
    expect(compareArticles({ norma_data: { ...CC, ...at('2015-12-31') } }, article('1. Qualcosa.')).rows.map((r) => r.label)).toEqual(['aggiunto']);
  });
});

describe('two articles (D1, D2)', () => {
  const a = article(normattiva('Art. 2043.', 'Risarcimento per fatto illecito', ['Qualunque fatto doloso o colposo, che cagiona ad altri un danno ingiusto, obbliga colui che ha commesso il fatto a risarcire il danno.']), { numero_articolo: '2043' });
  const b = article(normattiva('Art. 2059.', 'Danni non patrimoniali', ['1. Il danno non patrimoniale deve essere risarcito solo nei casi determinati dalla legge.', '2. Un secondo comma.']), { numero_articolo: '2059' });

  it('sets the commi side by side by position, without labels or diffs', () => {
    const c = compareArticles(a, b);
    expect(c.kind).toBe('articles');
    expect(c.older).toBe('left');
    expect(c.rows).toHaveLength(2);
    expect(c.rows[0].left).toBeDefined();
    expect(c.rows[0].right).toBeDefined();
    expect(c.rows[1].left).toBeUndefined();
    expect(c.rows[1].right?.number).toBe('2');
    expect(c.rows.every((r) => r.label === undefined && r.diff === undefined)).toBe(true);
    expect(c.rubric?.left?.kind).toBe('rubric');
    expect(c.rubric?.label).toBeUndefined();
  });
  it('pairs by number when both print one on every comma', () => {
    const left = article('1. Alfa.\n\n1-bis. Beta.\n\n2. Gamma.', { numero_articolo: '10' });
    const right = article('1. Delta.\n\n2. Epsilon.\n\n3. Zeta.', { numero_articolo: '11' });
    const c = compareArticles(left, right);
    expect(c.rows.map((r) => [r.left?.number ?? null, r.right?.number ?? null])).toEqual([
      ['1', '1'], ['1-bis', null], ['2', '2'], [null, '3'],
    ]);
  });
  it('pairs by position when a side prints no number', () => {
    const left = article('Primo.\n\nSecondo.', { numero_articolo: '10' });
    const right = article('1. Uno.\n\n2. Due.\n\n3. Tre.', { numero_articolo: '11' });
    const c = compareArticles(left, right);
    expect(c.rows.map((r) => [r.left !== undefined, r.right !== undefined])).toEqual([[true, true], [true, true], [false, true]]);
  });
});

describe('the summary (D6)', () => {
  const sentence = (l: ArticleData, r: ArticleData) => summarySentence(compareArticles(l, r).summary);
  const c = (n: number, tail = 'secondo quanto la legge dispone') => `${n}. Il comma numero ${n} stabilisce che le parti devono comportarsi ${tail}.`;

  it('writes the owner\'s example: a day to the text in force', () => {
    const older = article(normattiva('Art. 3000.', null, [c(1), c(2), c(3), c(4), c(5)]), at('2015-12-31'));
    const newer = article(normattiva('Art. 3000.', null, [
      c(1),
      c(2, 'secondo quanto il codice dispone'),
      c(3, 'secondo quanto il regolamento dispone'),
      '((4. COMMA ABROGATO DALLA L. 1 GENNAIO 2020, N. 1))',
      c(5),
      '((6. Un comma interamente nuovo, aggiunto da un intervento successivo del legislatore.))',
    ]));
    expect(sentence(older, newer)).toBe(
      'Dal testo al 31 dicembre 2015 al testo in vigore: 2 commi modificati, 1 aggiunto, 1 abrogato · 2 invariati',
    );
  });
  it('counts one change in the singular and a changed rubric', () => {
    const older = article(normattiva('Art. 3000.', 'Saggio degli interessi', [c(1), c(2)]), original);
    const newer = article(normattiva('Art. 3000.', 'Saggio degli interessi legali', [c(1), c(2, 'secondo quanto il codice dispone')]));
    expect(sentence(older, newer)).toBe('Dal testo originale al testo in vigore: rubrica modificata, 1 comma modificato · 1 invariato');
  });
  it('writes riscritto, aggiunto and abrogato in the singular and the plural', () => {
    const older = article(normattiva('Art. 3000.', null, [`1. ${wordsOf(12, 'a')}`, `2. ${wordsOf(12, 'b')}`, `3. ${wordsOf(12, 'c')}`]), at('2007-12-29'));
    const newer = article(normattiva('Art. 3000.', null, [`1. ${wordsOf(12, 'q')}`, `2. ${wordsOf(12, 'r')}`, `4. ${wordsOf(12, 's')}`, `5. ${wordsOf(12, 't')}`, `6. ${wordsOf(12, 'u')}`]), at('2015-12-31'));
    expect(sentence(older, newer)).toBe('Dal testo al 29 dicembre 2007 al testo al 31 dicembre 2015: 2 commi riscritti, 3 aggiunti, 1 abrogato');
    const fewer = article(normattiva('Art. 3000.', null, [`1. ${wordsOf(12, 'a')}`, `2. ${wordsOf(12, 'b')}`, `3. ${wordsOf(12, 'c')}`, `4. ${wordsOf(12, 'd')}`]), at('2007-12-29'));
    const rest = article(normattiva('Art. 3000.', null, [`1. ${wordsOf(12, 'q')}`, `5. ${wordsOf(12, 's')}`]), at('2015-12-31'));
    expect(sentence(fewer, rest)).toBe('Dal testo al 29 dicembre 2007 al testo al 31 dicembre 2015: 1 comma riscritto, 1 aggiunto, 3 abrogati');
  });
  it('elides the preposition before 8 and 11', () => {
    const l = article(normattiva('Art. 3000.', null, [c(1)]), at('2014-09-08'));
    const r = article(normattiva('Art. 3000.', null, [c(1, 'secondo quanto il codice dispone')]), at('2014-09-11'));
    expect(sentence(l, r)).toBe("Dal testo all'8 settembre 2014 al testo all'11 settembre 2014: 1 comma modificato");
  });
  it('says «nessuna modifica» when nothing changed', () => {
    const raw = normattiva('Art. 3000.', 'Rubrica', [c(1), c(2)]);
    expect(sentence(article(raw, at('2015-12-31')), article(raw))).toBe('Dal testo al 31 dicembre 2015 al testo in vigore: nessuna modifica');
  });
  it('follows the older side when it stands on the right', () => {
    const raw = normattiva('Art. 3000.', null, [c(1), c(2)]);
    const edited = normattiva('Art. 3000.', null, [c(1), c(2, 'secondo quanto il codice dispone')]);
    expect(sentence(article(edited), article(raw, at('2015-12-31')))).toBe('Dal testo al 31 dicembre 2015 al testo in vigore: 1 comma modificato · 1 invariato');
  });
  it('writes the two articles with their comma counts', () => {
    const l = article(normattiva('Art. 2043.', null, ['Unico comma.']), { numero_articolo: '2043' });
    const r = article(normattiva('Art. 2059.', null, ['1. Uno.', '2. Due.']), { numero_articolo: '2059' });
    expect(sentence(l, r)).toBe('Art. 2043 c.c. (1 comma) e art. 2059 c.c. (2 commi)');
  });
  it('names a past text among two articles, never as the text in force', () => {
    const l = article('1. Uno.', { numero_articolo: '2043', ...at('2007-12-29') });
    const r = article('1. Uno.', { numero_articolo: '2059' });
    expect(sentence(l, r)).toBe('Art. 2043 c.c. — testo al 29/12/2007 (1 comma) e art. 2059 c.c. (1 comma)');
  });
  it('keeps the labels and counts in the data', () => {
    const summary = compareArticles(article('1. Uno.', at('2015-12-31')), article('1. Uno.')).summary;
    expect(summary).toMatchObject({
      kind: 'versions',
      older: 'left',
      counts: { invariato: 1, modificato: 0, riscritto: 0, aggiunto: 0, abrogato: 0 },
      commi: { left: 1, right: 1 },
      labels: { left: 'testo al 31 dicembre 2015', right: 'testo in vigore' },
    });
  });
});

describe('the reader\'s real texts', () => {
  const rawOf = (id: string) => fixtureText(id);

  it.each(ARTICLE_FIXTURES.map((f) => [f.id, f.text] as const))('%s compared with itself: every comma «invariato»', (_id, raw) => {
    const c = compareArticles(article(raw, at('2015-12-31')), article(raw));
    expect(c.kind).toBe('versions');
    expect(c.rows.every((r) => r.label === 'invariato' && r.left && r.right)).toBe(true);
    expect(c.summary.counts.modificato + c.summary.counts.aggiunto + c.summary.counts.abrogato).toBe(0);
  });

  it('keeps the update notes\' tail out of the units', () => {
    const raw = rawOf('nrm-cp-640');
    const c = compareArticles(article(raw, at('2015-12-31')), article(raw));
    const tail = raw.indexOf('AGGIORNAMENTO');
    expect(Math.max(...c.rows.map((r) => r.left!.end))).toBeLessThanOrEqual(tail);
  });

  it('art. 640 c.p.: the two versions of a comma, the repeal of a number and a comma added', () => {
    const raw = rawOf('nrm-cp-640');
    const earlier = raw
      .replace('\n\n 2-bis) ((NUMERO ABROGATO DAL D.L. 11 APRILE 2025, N. 48)). ', '\n\n 2-bis) se il fatto è commesso a danno di persona ricoverata in un istituto di cura. ')
      .replace(/\n\n 2-ter\) [^\n]*\n\n/, '\n\n');
    const c = compareArticles(article(earlier, { numero_articolo: '640', tipo_atto: 'codice penale', ...at('2015-12-31') }), article(raw, { numero_articolo: '640', tipo_atto: 'codice penale' }));
    expect(c.kind).toBe('versions');
    // the items belong to their comma: "2-bis" repealed and "2-ter" added are changes inside the second comma
    expect(c.rows.map((r) => r.label)).toContain('modificato');
    expect(c.summary.counts.aggiunto + c.summary.counts.modificato + c.summary.counts.riscritto).toBeGreaterThan(0);
  });

  it('art. 2-ter d.lgs. 196/2003: the 1-bis comma entered between 1 and 2', () => {
    const raw = rawOf('nrm-privacy-2ter');
    const earlier = raw.replace(/\n\n\(\(1-bis\.[^\n]*\)\)\n\n/, '\n\n');
    expect(earlier).not.toBe(raw);
    const c = compareArticles(article(earlier, { tipo_atto: 'decreto legislativo', numero_articolo: '2-ter', ...at('2015-12-31') }), article(raw, { tipo_atto: 'decreto legislativo', numero_articolo: '2-ter' }));
    expect(c.rows.map((r) => r.right?.number)).toEqual(['1', '1-bis', '2', '3', '4']);
    expect(c.rows.map((r) => r.label)).toEqual(['invariato', 'aggiunto', 'invariato', 'invariato', 'invariato']);
    expect(c.rubric?.label).toBe('invariato');
  });
});

describe('diffSequences', () => {
  const text = (ops: ReturnType<typeof diffSequences>, a: string[], b: string[]) =>
    ops.map((o) => (o.type === 'equal' ? a[o.a!] : o.type === 'delete' ? `-${a[o.a!]}` : `+${b[o.b!]}`)).join(' ');

  it('keeps the common head and tail and puts deletions before insertions', () => {
    const a = 'il saggio è del 5 per cento'.split(' ');
    const b = 'il saggio è del 10 per cento'.split(' ');
    expect(text(diffSequences(a, b), a, b)).toBe('il saggio è del -5 +10 per cento');
  });
  it('handles empty sides and no common token', () => {
    expect(diffSequences([], [])).toEqual([]);
    expect(diffSequences(['a'], [])).toEqual([{ type: 'delete', a: 0 }]);
    expect(diffSequences([], ['b'])).toEqual([{ type: 'insert', b: 0 }]);
    expect(text(diffSequences(['a', 'b'], ['c', 'd']), ['a', 'b'], ['c', 'd'])).toBe('-a -b +c +d');
  });
  it('finds a longest common subsequence', () => {
    const a = 'a b c d e f'.split(' ');
    const b = 'x b d y f'.split(' ');
    const ops = diffSequences(a, b);
    expect(ops.filter((o) => o.type === 'equal').map((o) => a[o.a!])).toEqual(['b', 'd', 'f']);
  });
});

describe('cost', () => {
  const rows = (c: ArticleComparison): CompareRow[] => c.rows;

  it('compares two 200-comma articles, by number and by content, in a bounded time', () => {
    const next = rng(7);
    const commi = Array.from({ length: 200 }, () => prose(next, 30));
    const numbered = (list: string[]) => list.map((t, i) => `${i + 1}. ${t}`).join('\n\n');
    const edited = commi.map((t, i) => (i % 10 === 0 ? `${t} ${LEXICON[i]}` : t));
    edited.splice(100, 0, prose(next, 30));

    const t0 = performance.now();
    const byNumber = compareArticles(article(numbered(commi), at('2015-12-31')), article(numbered(edited.slice(0, 200))));
    const byContent = compareArticles(article(commi.join('\n\n'), at('2015-12-31')), article(edited.join('\n\n')));
    const elapsed = performance.now() - t0;

    expect(rows(byNumber)).toHaveLength(200);
    expect(byContent.summary.counts.aggiunto).toBe(1);
    expect(byContent.summary.counts.modificato).toBe(20);
    expect(byContent.summary.counts.invariato).toBe(180);
    expect(elapsed).toBeLessThan(5000);
  });

  it('compares two commi of 5 000 words without a table of 25 million cells', () => {
    const next = rng(11);
    const base = prose(next, 5000);
    const edited = `${base.split(' ').slice(0, 2500).join(' ')} cambiato ${base.split(' ').slice(2500).join(' ')}`;
    const t0 = performance.now();
    const c = compareArticles(article(`1. ${base}`, at('2015-12-31')), article(`1. ${edited}`));
    const elapsed = performance.now() - t0;
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0].label).toBe('riscritto');
    expect(c.rows[0].diff).toBeUndefined();
    expect(elapsed).toBeLessThan(2000);
  });
});
