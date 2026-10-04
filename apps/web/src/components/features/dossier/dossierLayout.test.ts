import { describe, expect, it } from 'vitest';
import type { DossierItem, NormaVisitata } from '../../../types';
import { actKeyOf, actsSummary, articleLabel, codeName, compareArticles, dossierItemOrder, foldedArticleList, layoutDossier } from './dossierLayout';

let n = 0;
function art(data: Partial<NormaVisitata> & { numero_articolo: string }, actCitation?: string | null): DossierItem {
  n += 1;
  return {
    id: `i${n}`, type: 'norma', addedAt: '2026-10-04',
    data: { tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31', ...data },
    ...(actCitation !== undefined ? { actCitation } : {}),
  };
}
const L247 = 'l. 31 dicembre 2012, n. 247';
const L49 = 'l. 21 aprile 2023, n. 49';
const note = (text: string): DossierItem => ({ id: `n-${text}`, type: 'note', data: text, addedAt: '2026-10-04' });
const numbers = (items: DossierItem[]) => items.map((i) => (i.data as NormaVisitata).numero_articolo);

describe('layoutDossier', () => {
  it('names each act once, in the order the acts entered the dossier', () => {
    const items = [
      art({ numero_articolo: '3' }, L247),
      art({ numero_atto: '49', data: '2023-04-21', numero_articolo: '1' }, L49),
      art({ numero_articolo: '1' }, L247),
    ];
    const { acts } = layoutDossier(items);
    expect(acts.map((a) => a.heading)).toEqual([L247, L49]);
    expect(numbers(acts[0].articles)).toEqual(['1', '3']);
  });

  it("keeps a past text and an annexed article in their act's block, apart in its groups", () => {
    const items = [
      art({ numero_articolo: '3' }, L247),
      art({ numero_articolo: '3', versione: 'originale', data_versione: '2013-01-01' }, L247),
      art({ numero_articolo: '1', allegato: 'A' }, L247),
    ];
    const [block] = layoutDossier(items).acts;
    expect(block.articles).toHaveLength(3);
    expect(block.groups).toHaveLength(3);
    expect(block.articles.map((i) => articleLabel(i.data))).toEqual(['art. 3', 'art. 3', 'All. A, art. 1']);
  });

  it('is one block for a code saved with and without its decree, in any case', () => {
    const items = [
      art({ tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '2043' }, 'c.c.'),
      art({ tipo_atto: 'Codice civile', numero_atto: undefined, data: '', numero_articolo: '1218' }, 'c.c.'),
      art({ tipo_atto: 'preleggi', numero_atto: '262', data: '1942-03-16', numero_articolo: '12' }, 'preleggi'),
    ];
    const { acts } = layoutDossier(items);
    expect(acts.map((a) => [a.heading, a.isCode, a.articles.length])).toEqual([
      ['Codice civile', true, 2], ['Preleggi', true, 1],
    ]);
  });

  it("never shows or orders by a code's own annex (the codice civile is Allegato 2 of its decree)", () => {
    const items = [
      art({ tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '2043', allegato: '2' }, 'c.c.'),
      art({ tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '1218' }, 'c.c.'),
    ];
    const [block] = layoutDossier(items).acts;
    expect(block.articles.map((i) => articleLabel(i.data))).toEqual(['art. 1218', 'art. 2043']);
    expect(foldedArticleList(block)).toBe('artt. 1218, 2043');
  });

  it('heads an act the server has not named yet with a muted fallback, never an empty heading', () => {
    const [block] = layoutDossier([art({ numero_articolo: '3' })]).acts;
    expect(block).toMatchObject({ heading: 'legge n. 247', headingIsFallback: true });
    const [named] = layoutDossier([art({ numero_articolo: '3' }), art({ numero_articolo: '4' }, L247)]).acts;
    expect(named).toMatchObject({ heading: L247, headingIsFallback: false });
  });

  it('puts the notes first, in their order', () => {
    const { notes, acts } = layoutDossier([art({ numero_articolo: '3' }, L247), note('b'), note('a')]);
    expect(notes.map((i) => i.data)).toEqual(['b', 'a']);
    expect(acts).toHaveLength(1);
  });
});

describe('compareArticles', () => {
  const nv = (numero_articolo: string, more: Partial<NormaVisitata> = {}): NormaVisitata =>
    ({ tipo_atto: 'legge', data: '2012-12-31', numero_articolo, ...more });
  it('orders the body before the annexes, then by number and ordinal', () => {
    const sorted = [nv('10'), nv('2-bis'), nv('1', { allegato: 'A' }), nv('2'), nv('2 ter'), nv('25-terdecies'), nv('25-ter')]
      .sort(compareArticles).map(articleLabel);
    expect(sorted).toEqual(['art. 2', 'art. 2-bis', 'art. 2 ter', 'art. 10', 'art. 25-ter', 'art. 25-terdecies', 'All. A, art. 1']);
  });
  it('reads a suffix written without a hyphen, and sub-numbers as numbers', () => {
    const sorted = [nv('2bis'), nv('2-bis.10'), nv('2'), nv('2-bis.2'), nv('2ter'), nv('270-bis.1')]
      .sort(compareArticles).map((x) => x.numero_articolo);
    expect(sorted).toEqual(['2', '2bis', '2-bis.2', '2-bis.10', '2ter', '270-bis.1']);
  });
  it('puts an article that is not a number after the numbered ones', () => {
    expect([nv('unico'), nv('5')].sort(compareArticles).map((x) => x.numero_articolo)).toEqual(['5', 'unico']);
  });
  it('puts the text in force before past texts, past texts by date', () => {
    const sorted = [
      nv('3', { versione: 'originale', data_versione: '2015-01-01' }),
      nv('3'),
      nv('3', { versione: 'originale', data_versione: '2013-01-01' }),
    ].sort(compareArticles).map((x) => x.data_versione ?? '');
    expect(sorted).toEqual(['', '2013-01-01', '2015-01-01']);
  });
});

describe('the smaller helpers', () => {
  it('names the codes and the Constitution', () => {
    expect(codeName('Costituzione')).toBe('Costituzione');
    expect(codeName('codice di procedura civile')).toBe('Codice di procedura civile');
    expect(codeName('codice procedura civile')).toBe('Codice di procedura civile');
    expect(codeName('legge')).toBeNull();
  });
  it('keys an act by identity, a code by name', () => {
    expect(actKeyOf({ tipo_atto: 'Legge', numero_atto: '247', data: '2012-12-31' })).toBe('legge|247|2012-12-31');
    expect(actKeyOf({ tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16' })).toBe('codice civile');
    expect(actKeyOf({ tipo_atto: 'codice procedura civile' })).toBe(actKeyOf({ tipo_atto: 'Codice di procedura civile' }));
  });
  it('folds a block into its numbers', () => {
    const { acts } = layoutDossier([art({ numero_articolo: '3' }, L247), art({ numero_articolo: '1' }, L247)]);
    expect(foldedArticleList(acts[0])).toBe('artt. 1, 3');
    const one = layoutDossier([art({ numero_articolo: '3' }, L247)]).acts[0];
    expect(foldedArticleList(one)).toBe('art. 3');
  });
  it('gives the order a drag of the acts saves: notes, then the acts in the new order', () => {
    const a = art({ numero_articolo: '3' }, L247);
    const b = art({ numero_atto: '49', data: '2023-04-21', numero_articolo: '1' }, L49);
    const c = note('x');
    const layout = layoutDossier([a, b, c]);
    expect(dossierItemOrder([a, b, c], layout, [layout.acts[1].key, layout.acts[0].key])).toEqual([c.id, b.id, a.id]);
  });
  it('never drops an item from the saved order, even one of an act the drag does not name', () => {
    const a = art({ numero_articolo: '3' }, L247);
    const b = art({ numero_atto: '49', data: '2023-04-21', numero_articolo: '1' }, L49);
    const layout = layoutDossier([a, b]);
    expect(dossierItemOrder([a, b], layout, [layout.acts[1].key])).toEqual([b.id, a.id]);
  });
  it('folds two versions of one article into one number', () => {
    const { acts } = layoutDossier([
      art({ numero_articolo: '3' }, L247),
      art({ numero_articolo: '3', versione: 'originale', data_versione: '2013-01-01' }, L247),
      art({ numero_articolo: '1', allegato: 'A' }, L247),
    ]);
    expect(foldedArticleList(acts[0])).toBe('artt. 3, All. A art. 1');
  });
});

describe('actsSummary', () => {
  it('names the acts in order, then counts the rest', () => {
    const items = ['1', '2', '3', '4'].map((k, i) => art({ numero_atto: k, data: `200${i}-01-01`, numero_articolo: '1' }, `l. ${k}`));
    expect(actsSummary(layoutDossier(items))).toBe('l. 1 · l. 2 · l. 3 e altri 1');
    expect(actsSummary(layoutDossier(items.slice(0, 3)))).toBe('l. 1 · l. 2 · l. 3');
    expect(actsSummary(layoutDossier([note('x')]))).toBe('');
  });
});
