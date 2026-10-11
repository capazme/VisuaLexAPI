import { describe, it, expect } from 'vitest';
import type { ArticleData, BrocardiInfo, Norma, NormaVisitata } from '../../types';
import { buildItemKey, uniqueArticleIdFromNorma } from '../normaKeys';
import {
  addArticles, besideAfterOpen, decisionOrder, findPracticeArticle, practiceArticleKey, practiceCountLine,
  practiceCounts, sameDecision,
  type BesideRef, type Practice, type PracticeDecision,
} from '../practice';

let seq = 0;
const id = () => `id-${++seq}`;
const CC_RD: Norma = { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16' };
const CC_BARE: Norma = { tipo_atto: 'codice civile', data: '' };
const L24: Norma = { tipo_atto: 'legge', numero_atto: '24', data: '2017-03-08' };
const art = (norma: Norma, numero: string, extra: Partial<NormaVisitata> = {}, more: Partial<ArticleData> = {}): ArticleData =>
  ({ article_text: `Art. ${numero}`, norma_data: { ...norma, numero_articolo: numero, ...extra }, ...more });
const numbers = (a: ArticleData[]) => a.map((x) => uniqueArticleIdFromNorma(x.norma_data));

describe('practiceArticleKey', () => {
  it('is the annotation key and the version key of the norma_data a search fills', () => {
    const inForce = art(CC_RD, '2043', { versione: 'vigente' });
    const past = art(CC_RD, '2043', { versione: 'vigente', data_versione: '2007-12-29' });
    expect(practiceArticleKey(inForce)).toBe(`${buildItemKey(inForce.norma_data)}|vigente|`);
    expect(practiceArticleKey(past)).toBe(`${buildItemKey(past.norma_data)}|vigente|2007-12-29`);
    expect(practiceArticleKey(art(CC_RD, '2043'))).toBe(practiceArticleKey(inForce));
  });
});

describe('addArticles', () => {
  it('puts the codice civile with and without its R.D. in one act, and never merges copies whose annotation keys differ', () => {
    const fromSearch = art(CC_RD, '2043', { allegato: '2' });
    const fromIndex = art(CC_BARE, '2043');
    const art1218 = art(CC_BARE, '1218');
    let r = addArticles([], CC_RD, [fromSearch], id);
    r = addArticles(r.acts, CC_BARE, [fromIndex, art1218], id);
    expect(r.acts).toHaveLength(1);
    expect(r.acts[0].articles.map((a) => buildItemKey(a.norma_data)))
      .toEqual([buildItemKey(art1218.norma_data), buildItemKey(fromSearch.norma_data), buildItemKey(fromIndex.norma_data)]);
    expect(r.added).toEqual([practiceArticleKey(fromIndex), practiceArticleKey(art1218)]);
  });
  it('merges an identical copy, which fills Brocardi and gives the act its URN', () => {
    const first = art(CC_RD, '2043', {}, { brocardi_error: 'timeout' });
    const brocardi = { position: 'Libro IV' } as BrocardiInfo;
    let r = addArticles([], CC_RD, [first], id);
    r = addArticles(r.acts, { ...CC_RD, urn: 'urn:nir:stato:regio.decreto:1942-03-16;262' },
      [art(CC_RD, '2043', {}, { brocardi_info: brocardi })], id);
    expect(r.added).toEqual([]);
    expect(r.acts[0].articles).toHaveLength(1);
    expect(r.acts[0].articles[0].brocardi_info).toEqual(brocardi);
    expect(r.acts[0].articles[0].brocardi_error).toBeUndefined();
    expect(r.acts[0].articles[0].norma_data).toEqual(first.norma_data);
    expect(r.acts[0].norma.urn).toBe('urn:nir:stato:regio.decreto:1942-03-16;262');
  });
  it('keeps a past text beside the text in force, after it, under another key', () => {
    const inForce = art(CC_RD, '2043');
    const past = art(CC_RD, '2043', { data_versione: '2007-12-29' }, { versionInfo: { isHistorical: true, requestedDate: '2007-12-29' } });
    const r = addArticles([], CC_RD, [past, inForce], id);
    expect(r.acts[0].articles).toEqual([inForce, past]);
    expect(practiceArticleKey(past)).not.toBe(practiceArticleKey(inForce));
  });
  it('orders 2, 2-bis, 3, 10 and puts an annex after the body', () => {
    const r = addArticles([], L24, [art(L24, '10'), art(L24, '1', { allegato: 'A' }), art(L24, '2-bis'), art(L24, '3'), art(L24, '2')], id);
    expect(numbers(r.acts[0].articles)).toEqual(['2', '2-bis', '3', '10', 'allA:1']);
  });
  it('appends a new act after the others, returns its id, and leaves the input untouched', () => {
    const first = addArticles([], CC_RD, [art(CC_RD, '1218')], id);
    const before = JSON.stringify(first.acts);
    const r = addArticles(first.acts, L24, [art(L24, '1')], id);
    expect(r.acts.map((a) => a.key)).toEqual(['codice civile', 'legge|24|2017-03-08']);
    expect(r.actId).toBe(r.acts[1].id);
    expect(r.acts[0]).toBe(first.acts[0]);
    expect(JSON.stringify(first.acts)).toBe(before);
    expect(r.acts[1]).toMatchObject({ norma: L24, isCollapsed: false });
  });
  it('makes an act with no article (an index opened before any search)', () => {
    const r = addArticles([], L24, [], id);
    expect(r.acts).toHaveLength(1);
    expect(r.acts[0].articles).toEqual([]);
    expect(r.added).toEqual([]);
  });
});

describe('findPracticeArticle', () => {
  it('finds «1 bis» as 1-bis, and a code article with or without its annex', () => {
    const law = addArticles([], L24, [art(L24, '1-bis')], id).acts[0];
    expect(findPracticeArticle(law, '1 bis')?.norma_data.numero_articolo).toBe('1-bis');
    const code = addArticles([], CC_RD, [art(CC_RD, '2043', { allegato: '2' })], id).acts[0];
    expect(findPracticeArticle(code, '2043')).toBe(code.articles[0]);
    expect(findPracticeArticle(code, 'all2:2043')).toBe(code.articles[0]);
  });
  it('prefers the text in force to a past text of the same article', () => {
    const inForce = art(CC_RD, '2043');
    const act = addArticles([], CC_RD, [art(CC_RD, '2043', { data_versione: '2007-12-29' }), inForce], id).acts[0];
    expect(findPracticeArticle(act, '2043')).toEqual(inForce);
  });
  it('keeps the annex of an act that is not a code apart from its body', () => {
    const law = addArticles([], L24, [art(L24, '1'), art(L24, '1', { allegato: 'A' })], id).acts[0];
    expect(findPracticeArticle(law, '1')?.norma_data.allegato).toBeUndefined();
    expect(findPracticeArticle(law, 'allA:1')?.norma_data.allegato).toBe('A');
    expect(findPracticeArticle(law, '7')).toBeUndefined();
    expect(findPracticeArticle(law, '')).toBeUndefined();
  });
});

describe('sameDecision', () => {
  const civ = { corte: 'cassazione' as const, numero: 577, anno: 2008, archivio: 'civile' as const };
  it('matches court, number and year; a citation with an archive only that archive', () => {
    expect(sameDecision(civ, { corte: 'cassazione', numero: 577, anno: 2008 })).toBe(true);
    expect(sameDecision(civ, { ...civ, archivio: 'penale' })).toBe(false);
    expect(sameDecision(civ, { ...civ, anno: 2009 })).toBe(false);
    expect(sameDecision({ corte: 'cassazione', numero: 577, anno: 2008 }, civ)).toBe(false);
  });
});

describe('besideAfterOpen', () => {
  const win = (k: string): BesideRef => ({ id: k, kind: 'decision', decisionId: k });
  const [A, B, C] = [win('a'), win('b'), win('c')];
  it('appends up to two', () => expect(besideAfterOpen([A], B)).toEqual([A, B]));
  it('replaces the oldest with a third', () => expect(besideAfterOpen([A, B], C)).toEqual([B, C]));
  it('never replaces the window that asked', () => expect(besideAfterOpen([A, B], C, 'a')).toEqual([A, C]));
  it('moves nothing when the subject is already beside', () => expect(besideAfterOpen([A, B], A)).toEqual([A, B]));
});

describe('decisionOrder', () => {
  const dec = (key: string, numero: number, anno: number, depositDate?: string): PracticeDecision => ({
    id: key, reference: { corte: 'cassazione', numero, anno, archivio: 'civile' }, label: `${numero}/${anno}`,
    identified: depositDate !== undefined, ...(depositDate ? { depositDate } : {}),
  });
  it('puts the newest deposit first, an unread decision by its year, ties by number', () => {
    const a = dec('a', 28994, 2019, '2019-11-11');
    const b = dec('b', 577, 2008, '2008-01-11');
    const c = dec('c', 100, 2024);
    const d = dec('d', 200, 2024);
    expect(decisionOrder([b, a, c, d]).map((x) => x.id)).toEqual(['d', 'c', 'a', 'b']);
  });
  it('does not reorder its input', () => {
    const list = [dec('a', 1, 2000), dec('b', 1, 2020)];
    decisionOrder(list);
    expect(list.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('practiceCountLine', () => {
  it('names what is there, singulars right', () => {
    expect(practiceCountLine({ acts: 2, articles: 4, decisions: 2 })).toBe('2 atti · 4 articoli · 2 sentenze');
    expect(practiceCountLine({ acts: 1, articles: 1, decisions: 0 })).toBe('1 atto · 1 articolo');
    expect(practiceCountLine({ acts: 0, articles: 0, decisions: 1 })).toBe('1 sentenza');
  });
  it('counts a practice', () => {
    const { acts } = addArticles(addArticles([], CC_RD, [art(CC_RD, '1218'), art(CC_RD, '2043')], id).acts, L24, [art(L24, '1')], id);
    const p: Practice = {
      id: 'p', label: 'Pratica', labelIsCustom: false, acts, beside: [],
      decisions: [{ id: 'd', reference: { corte: 'corte_costituzionale', numero: 71, anno: 2020 }, label: 'Corte cost., n. 71/2020', identified: false }],
    };
    expect(practiceCounts(p)).toEqual({ acts: 2, articles: 3, decisions: 1 });
  });
});
