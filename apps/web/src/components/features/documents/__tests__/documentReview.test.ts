import { describe, expect, it } from 'vitest';
import type { DocumentCitation } from '../documentCandidates';
import {
  applyAct, clearAct, completionScopes, confirmRow, documentActs, hasChoices, linkInputs, pickerPassage, restore, reviewRows,
  rowKey, rowsToConfirm, setChoice, snapshot, linksToFirst,
} from '../documentReview';
import { settleLinks } from '../documentLinks';

const CC = { act_type: 'codice civile' };
const L241 = { act_type: 'legge', act_number: '241', date: '1990' };

// «L'art. 5 del contratto. Visto l'art. 2043 c.c., e l'art. 5.» and so on: positions by hand.
const TEXT = 'Visto la l. 241/1990, art. 3. Poi l’art. 5 e l’Art.  5 e l’art. 9.\nE l’art. 2043 c.c. e l’art. 2.';
const at = (needle: string, from = 0) => {
  const start = TEXT.indexOf(needle, from);
  return { start, end: start + needle.length };
};
const ROWS: DocumentCitation[] = [
  { ...at('l. 241/1990, art. 3'), article: '3', state: 'resolved', act: L241 },
  { ...at('art. 5'), article: '5', state: 'incomplete' },
  { ...at('Art.  5'), article: '5', state: 'incomplete' },
  { ...at('art. 9'), article: '9', state: 'incomplete' },
  { ...at('art. 2043 c.c.'), article: '2043', state: 'resolved', act: CC },
  { ...at('art. 2.'.slice(0, 6), TEXT.indexOf('c.c.')), article: '2', state: 'inherited', act: CC },
];

describe('the user\'s choices on the rows (#376 §5.4)', () => {
  it('reaches the identical rows (same article, written alike once spaces and case are folded) and all', () => {
    const rows = reviewRows(ROWS, new Map());
    expect(completionScopes(TEXT, rows, 1)).toEqual({ identical: [1, 2], all: [1, 2, 3] });
    expect(completionScopes(TEXT, rows, 3)).toEqual({ identical: [3], all: [3, 1, 2] });
  });

  it('a row chosen for itself is the user\'s; one chosen in bulk waits for a confirmation; undo puts all back', () => {
    const keys = [rowKey(ROWS[1]), rowKey(ROWS[2])];
    const before = snapshot(new Map(), keys);
    let choices = applyAct(new Map(), [keys[0]], L241, 'row');
    choices = applyAct(choices, [keys[1]], L241, 'bulk');
    const rows = reviewRows(ROWS, choices);
    expect(rows[1]).toMatchObject({ origin: 'chosen', chosenBy: 'row', state: 'resolved', act: L241 });
    expect(rows[2]).toMatchObject({ origin: 'chosen', chosenBy: 'bulk' });
    expect(rowsToConfirm(rows, choices).map((r) => r.index)).toEqual([2, 5]);
    expect(hasChoices(choices)).toBe(true);
    expect(restore(choices, before).size).toBe(0);
  });

  it('a new act asks for a new confirmation; «Torna da completare» drops the act', () => {
    const key = rowKey(ROWS[5]);
    let choices = confirmRow(new Map(), reviewRows(ROWS, new Map())[5]);
    expect(rowsToConfirm(reviewRows(ROWS, choices), choices).map((r) => r.index)).toEqual([]);
    choices = applyAct(choices, [key], L241, 'bulk');
    expect(choices.get(key)).toEqual({ act: L241, by: 'bulk' });
    choices = clearAct(choices, key);
    expect(choices.size).toBe(0);
    expect(reviewRows(ROWS, choices)[5].origin).toBe('context');
  });

  it('a dismissed row is never linked, and confirmed rows get their link', () => {
    let choices = setChoice(new Map(), rowKey(ROWS[4]), { dismissed: true });
    choices = confirmRow(choices, reviewRows(ROWS, choices)[5]);
    const rows = reviewRows(ROWS, choices);
    const input = linkInputs(rows, choices);
    const answers = new Map([[JSON.stringify(['codice civile', '', '', '2', null]), { href: 'https://www.normattiva.it/x~art2', reason: 'ok' as const }]]);
    const links = settleLinks(input.rows, input.choices, answers);
    expect(links[4]).toEqual({ linked: false, reason: 'not_resolved' });
    expect(links[5]).toMatchObject({ linked: true });
  });
});

describe('a confirmation holds for the act confirmed (#391 §4.3)', () => {
  it('is dropped when «Riprova» gives the inherited row another act', () => {
    const choices = confirmRow(new Map(), reviewRows(ROWS, new Map())[5]);
    expect(reviewRows(ROWS, choices)[5].confirmed).toBe(true);
    const again = ROWS.map((row, i) => (i === 5 ? { ...row, act: L241 } : row));
    const rows = reviewRows(again, choices);
    expect(rows[5].confirmed).toBe(false);
    expect(rowsToConfirm(rows, choices).map((r) => r.index)).toEqual([5]);
    const input = linkInputs(rows, choices);
    expect(input.choices.get(5)).toBeUndefined();
  });
});

describe('the picker\'s acts and passage (#376 §5.2, §5.3)', () => {
  it('offers the document\'s own acts, the nearest above first, never an inherited one', () => {
    const rows = reviewRows(ROWS, new Map());
    const named = { actsNamed: [{ start: 0, act: { act_type: 'decreto legislativo', act_number: '81', date: '2008' } }] };
    expect(documentActs(rows, named, ROWS[5].start)).toEqual([CC, { act_type: 'decreto legislativo', act_number: '81', date: '2008' }, L241]);
    expect(documentActs(rows, {}, ROWS[1].start)).toEqual([L241, CC]);
  });

  it('quotes the sentence around the citation, within its paragraph', () => {
    const passage = pickerPassage(TEXT, ROWS[3].start, ROWS[3].end);
    expect(passage).toMatchObject({ before: 'Poi l’art. 5 e l’Art. 5 e l’', match: 'art. 9', after: '.' });
    expect(pickerPassage(TEXT, ROWS[5].start, ROWS[5].end).before).toBe('E l’art. 2043 c.c. e l’');
  });

  it('says a range or «e ss.» links to its first article', () => {
    expect(linksToFirst({ article: '1362-1371' })).toBe(true);
    expect(linksToFirst({ article: '167', following: true })).toBe(true);
    expect(linksToFirst({ article: '21-octies' })).toBe(false);
  });
});
