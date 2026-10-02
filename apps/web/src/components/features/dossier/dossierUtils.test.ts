import { describe, it, expect } from 'vitest';
import {
  searchParamsFromNorma, packItemContent, unpackItemContent,
  computeItemCounts, dossierRecency, dossierContainsArticle, normaForDossier,
  computeNormaGroups, searchParamsFromGroup, dossierItemPdfTitle, tabLabelForGroup, searchesForGroups,
} from './dossierUtils';
import { buildItemKey } from '../../../utils/normaKeys';
import type { ArticleData, Dossier, DossierItem, NormaVisitata } from '../../../types';

const norma: NormaVisitata = {
  tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '2043',
};
// The spread widens `type` back to the union's key set, which TS cannot
// narrow into a member — the cast restates what the fixture is.
const item = (over: Partial<DossierItem>): DossierItem => ({
  id: 'i1', type: 'norma', data: norma, addedAt: '2026-08-01T10:00:00.000Z', ...over,
} as DossierItem);
const dossier = (items: DossierItem[]): Dossier => ({
  id: 'd1', title: 'Pratica', createdAt: '2026-07-01T09:00:00.000Z', items,
});

describe('searchParamsFromNorma', () => {
  it('maps NormaVisitata to SearchParams honoring stored version, without doctrine for a past text', () => {
    expect(searchParamsFromNorma({ ...norma, versione: 'originale', data_versione: '1990-01-01', allegato: '2' }))
      .toEqual({
        act_type: 'codice civile', act_number: '262', date: '1942-03-16', article: '2043',
        version: 'originale', version_date: '1990-01-01', show_brocardi_info: false, annex: '2',
      });
  });
  it('defaults to vigente and empty version_date, and asks for the doctrine of the text in force', () => {
    const p = searchParamsFromNorma(norma);
    expect(p.version).toBe('vigente');
    expect(p.version_date).toBe('');
    expect(p.show_brocardi_info).toBe(true);
    expect(p).not.toHaveProperty('annex');
  });
  it.each([
    [{ versione: 'originale' }],
    [{ versione: 'vigente', data_versione: '2007-12-29' }],
  ])('keeps the doctrine out of a reopened past text %j', (version) => {
    expect(searchParamsFromNorma({ ...norma, ...version }).show_brocardi_info).toBe(false);
  });
});

describe('pack/unpackItemContent', () => {
  it('round-trips an important norma item', () => {
    const packed = packItemContent(norma, 'important');
    expect((packed as Record<string, unknown>)._dossierMeta).toEqual({ important: true });
    expect(unpackItemContent(packed)).toEqual({ data: norma, status: 'important' });
  });
  it('strips stale meta when status is not important', () => {
    const packed = packItemContent({ ...norma, _dossierMeta: { important: true } }, 'unread');
    expect(packed).toEqual(norma);
    expect(unpackItemContent(packed)).toEqual({ data: norma });
  });
  it('passes raw strings through untouched (note items)', () => {
    expect(packItemContent('appunto', 'important')).toBe('appunto');
    expect(unpackItemContent('appunto')).toEqual({ data: 'appunto' });
  });
});

describe('computeItemCounts', () => {
  it('counts norme, note and important', () => {
    expect(computeItemCounts([
      item({}), item({ id: 'i2', status: 'important' }),
      item({ id: 'i3', type: 'note', data: 'memo' }),
      item({ id: 'i4', status: 'done' }), // legacy value: not important
    ])).toEqual({ norme: 3, note: 1, important: 1 });
  });
});

describe('dossierRecency', () => {
  it('is the max of createdAt and item addedAt', () => {
    const d = dossier([item({ addedAt: '2026-08-20T10:00:00.000Z' })]);
    expect(dossierRecency(d)).toBe(new Date('2026-08-20T10:00:00.000Z').getTime());
  });
  it('falls back to createdAt for empty dossiers', () => {
    expect(dossierRecency(dossier([]))).toBe(new Date('2026-07-01T09:00:00.000Z').getTime());
  });
});

describe('dossierContainsArticle', () => {
  it('matches same act + normalized article id', () => {
    expect(dossierContainsArticle(dossier([item({})]), { ...norma })).toBe(true);
  });
  it('tolerates -bis formatting differences', () => {
    const stored = item({ data: { ...norma, numero_articolo: '2043-bis' } });
    expect(dossierContainsArticle(dossier([stored]), { ...norma, numero_articolo: '2043 bis' })).toBe(true);
  });
  it('rejects different act or article', () => {
    expect(dossierContainsArticle(dossier([item({})]), { ...norma, numero_articolo: '2059' })).toBe(false);
    expect(dossierContainsArticle(dossier([item({})]), { ...norma, tipo_atto: 'codice penale' })).toBe(false);
  });
  it('tells two versions of one article apart, so both can sit in one dossier', () => {
    const stored = dossier([item({ data: { ...norma, versione: 'vigente', data_versione: '2007-12-29' } })]);
    expect(dossierContainsArticle(stored, { ...norma, versione: 'vigente', data_versione: '2007-12-29' })).toBe(true);
    expect(dossierContainsArticle(stored, { ...norma, versione: 'vigente', data_versione: '2015-01-01' })).toBe(false);
    expect(dossierContainsArticle(stored, { ...norma, versione: 'vigente' })).toBe(false);
    expect(dossierContainsArticle(stored, { ...norma, versione: 'originale' })).toBe(false);
  });
  it('treats an item saved before versions were kept as the text in force', () => {
    const legacy = dossier([item({})]); // no version fields at all
    expect(dossierContainsArticle(legacy, { ...norma, versione: 'vigente', data_versione: '' })).toBe(true);
    expect(dossierContainsArticle(legacy, { ...norma })).toBe(true);
    expect(dossierContainsArticle(legacy, { ...norma, versione: 'vigente', data_versione: '2007-12-29' })).toBe(false);
  });
  it('does not take the text in force for the original text, nor the reverse', () => {
    const original = dossier([item({ data: { ...norma, versione: 'originale' } })]);
    expect(dossierContainsArticle(original, { ...norma, versione: 'vigente' })).toBe(false);
    expect(dossierContainsArticle(dossier([item({})]), { ...norma, versione: 'originale' })).toBe(false);
  });
  it('treats the nulls a server payload may carry as absent', () => {
    const fromServer = dossier([item({ data: { ...norma, versione: null, data_versione: null } as unknown as NormaVisitata })]);
    expect(dossierContainsArticle(fromServer, { ...norma })).toBe(true);
    expect(dossierContainsArticle(fromServer, { ...norma, versione: 'vigente', data_versione: '2007-12-29' })).toBe(false);
  });
  it('reads the original text and the text in force the way the table does', () => {
    const original = dossier([item({ data: { ...norma, versione: ' Originale ' } })]);
    expect(dossierContainsArticle(original, { ...norma, versione: 'originale' })).toBe(true);
    const withDay = dossier([item({ data: { ...norma, versione: 'vigente', data_versione: ' 2007-12-29 ' } })]);
    expect(dossierContainsArticle(withDay, { ...norma, versione: 'vigente', data_versione: '2007-12-29' })).toBe(true);
    expect(dossierContainsArticle(withDay, { ...norma, versione: 'vigente' })).toBe(false);
  });
  it('finds the item the window header built, asked with the article\'s own norma_data', () => {
    const block = { tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', urn: 'urn:x' };
    const own: NormaVisitata = { ...norma, numero_articolo: '1284', allegato: '2', versione: 'vigente', data_versione: '2007-12-29' };
    const built = normaForDossier(block, { article_text: 't', norma_data: own });
    expect(dossierContainsArticle(dossier([item({ data: built })]), own)).toBe(true);
  });
});

describe('normaForDossier', () => {
  const block = { tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', urn: 'urn:x' };
  const article = (over: Partial<NormaVisitata> = {}): ArticleData => ({
    article_text: 'testo',
    norma_data: { ...norma, numero_articolo: '1284', ...over },
  });

  it('keeps the version of a past text, which the window header used to drop', () => {
    expect(normaForDossier(block, article({ versione: 'vigente', data_versione: '2007-12-29' }))).toEqual({
      tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '1284', urn: 'urn:x',
      versione: 'vigente', data_versione: '2007-12-29',
    });
  });

  it('keeps the original text', () => {
    expect(normaForDossier(block, article({ versione: 'originale' }))).toMatchObject({ versione: 'originale' });
    expect(normaForDossier(block, article({ versione: 'originale' }))).not.toHaveProperty('data_versione');
  });

  it('stores no date for the text in force', () => {
    expect(normaForDossier(block, article({ versione: 'vigente', data_versione: '' })))
      .not.toHaveProperty('data_versione');
  });

  it('carries the annex of the article: the key and the id of the item must be the tab\'s', () => {
    const own = { ...norma, numero_articolo: '1284', allegato: '2' };
    const built = normaForDossier(block, { article_text: 't', norma_data: own });
    expect(built).toMatchObject({ allegato: '2' });
    expect(buildItemKey(built)).toBe(buildItemKey(own));
  });

  it('gives no annex key to an article without one', () => {
    expect(normaForDossier(block, article())).not.toHaveProperty('allegato');
  });

  it('reopens the same version it stored', () => {
    const stored = normaForDossier(block, article({ versione: 'vigente', data_versione: '2007-12-29' }));
    expect(searchParamsFromNorma(stored)).toMatchObject({
      article: '1284', version: 'vigente', version_date: '2007-12-29', show_brocardi_info: false,
    });
  });
});

describe('computeNormaGroups — versions', () => {
  const n = (over: Partial<NormaVisitata>): DossierItem => item({ id: `i-${Math.random()}`, data: { ...norma, numero_articolo: '1284', ...over } });

  it('makes a group of its own of a version that is not the text in force, not "1284,1284"', () => {
    const groups = computeNormaGroups([n({}), n({ versione: 'vigente', data_versione: '2007-12-29' })]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.articles)).toEqual([['1284'], ['1284']]);
    expect(groups[0]).toMatchObject({ versione: '', data_versione: '' });
    expect(groups[1]).toMatchObject({ versione: 'vigente', data_versione: '2007-12-29' });
  });

  it('keeps two articles of one act in one version in one group (the control)', () => {
    const groups = computeNormaGroups([n({}), n({ numero_articolo: '1285' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].articles).toEqual(['1284', '1285']);
  });

  it('groups items saved before versions were kept with the text in force', () => {
    const groups = computeNormaGroups([n({}), n({ numero_articolo: '1285', versione: 'vigente', data_versione: '' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].articles).toEqual(['1284', '1285']);
  });
});

describe('computeNormaGroups — annexes', () => {
  const n = (over: Partial<NormaVisitata>): DossierItem => item({ id: `i-${Math.random()}`, data: { ...norma, numero_articolo: '1', ...over } });

  it('makes a group of its own of each annex of one act, not one request "1,1"', () => {
    const groups = computeNormaGroups([n({ allegato: 'A' }), n({ allegato: 'B' }), n({})]);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.allegato)).toEqual(['A', 'B', '']);
    expect(groups.map((g) => g.articles)).toEqual([['1'], ['1'], ['1']]);
  });

  it('keeps two articles of one annex in one group (the control)', () => {
    const groups = computeNormaGroups([n({ allegato: 'A' }), n({ allegato: 'A', numero_articolo: '2' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ allegato: 'A', articles: ['1', '2'] });
  });

  it('groups the items with no annex together as the empty string', () => {
    const groups = computeNormaGroups([n({}), n({ numero_articolo: '2' }), n({ allegato: '', numero_articolo: '3' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ allegato: '', articles: ['1', '2', '3'] });
  });
});

describe('searchParamsFromGroup', () => {
  const group = (over: Partial<ReturnType<typeof computeNormaGroups>[number]> = {}) => ({
    key: 'k', tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16',
    articles: ['1284', '1285'], versione: '', data_versione: '', allegato: '', ...over,
  });

  it('asks for the text in force with Brocardi, as the dossier always did', () => {
    expect(searchParamsFromGroup(group())).toEqual({
      act_type: 'codice civile', act_number: '262', date: '1942-03-16', article: '1284,1285',
      version: 'vigente', version_date: '', show_brocardi_info: true,
    });
  });

  it('asks for the past text a group holds, without Brocardi', () => {
    expect(searchParamsFromGroup(group({ versione: 'vigente', data_versione: '2007-12-29' }))).toMatchObject({
      version: 'vigente', version_date: '2007-12-29', show_brocardi_info: false,
    });
    expect(searchParamsFromGroup(group({ versione: 'originale' }))).toMatchObject({
      version: 'originale', version_date: '', show_brocardi_info: false,
    });
  });

  it('asks for the annex a group holds, and sends no annex key when it holds none', () => {
    expect(searchParamsFromGroup(group({ allegato: 'A' }))).toMatchObject({ annex: 'A' });
    expect(searchParamsFromGroup(group())).not.toHaveProperty('annex');
  });
});

describe('dossierItemPdfTitle', () => {
  it('keeps the title of the text in force byte for byte', () => {
    expect(dossierItemPdfTitle(item({}), 0)).toBe('1. codice civile n. 262 · Art. 2043');
    expect(dossierItemPdfTitle(item({ data: { ...norma, numero_atto: '' } }), 2)).toBe('3. codice civile · Art. 2043');
  });
  it('keeps the title of a note', () => {
    expect(dossierItemPdfTitle({ id: 'n1', type: 'note', data: 'appunto', addedAt: '2026-08-01' } as DossierItem, 1)).toBe('2. Nota personale');
  });
  it('says which day a past item holds', () => {
    expect(dossierItemPdfTitle(item({ data: { ...norma, versione: 'vigente', data_versione: '2007-12-29' } }), 0))
      .toBe('1. codice civile n. 262 · Art. 2043 · Testo al 29/12/2007');
  });
  it('says it is the original text', () => {
    expect(dossierItemPdfTitle(item({ data: { ...norma, versione: 'originale' } }), 0))
      .toBe('1. codice civile n. 262 · Art. 2043 · Testo originale');
  });
});

describe('tabLabelForGroup', () => {
  const group = (over: Partial<ReturnType<typeof computeNormaGroups>[number]> = {}) => ({
    key: 'k', tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16',
    articles: ['1284'], versione: '', data_versione: '', allegato: '', ...over,
  });

  it('is the dossier\'s title for the text in force', () => {
    expect(tabLabelForGroup('Pratica', group())).toBe('Pratica');
    expect(tabLabelForGroup('Pratica', group({ versione: 'vigente', data_versione: '' }))).toBe('Pratica');
  });
  it('adds the day to the title for a group asking for a past text', () => {
    expect(tabLabelForGroup('Pratica', group({ versione: 'vigente', data_versione: '2007-12-29' })))
      .toBe('Pratica — testo al 29/12/2007');
  });
  it('says "testo originale" for the original text', () => {
    expect(tabLabelForGroup('Pratica', group({ versione: 'originale' }))).toBe('Pratica — testo originale');
  });
});

describe('searchesForGroups', () => {
  const g = (over: Partial<ReturnType<typeof computeNormaGroups>[number]>) => ({
    key: `k${Math.random()}`, tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16',
    articles: ['1284'], versione: '', data_versione: '', allegato: '', ...over,
  });
  const PAST = { versione: 'vigente', data_versione: '2007-12-29' };

  function run(groups: ReturnType<typeof g>[]) {
    const created: string[] = [];
    const searches = searchesForGroups('Pratica', groups, (label) => { created.push(label); return `tab-${created.length}`; });
    return { created, searches };
  }

  it('shares one tab among the texts in force and gives a past group a tab of its own', () => {
    const { created, searches } = run([g({}), g({ numero_atto: '1', articles: ['2'] }), g(PAST)]);
    expect(created).toEqual(['Pratica', 'Pratica — testo al 29/12/2007']);
    expect(searches.map((s) => s.targetTabId)).toEqual(['tab-1', 'tab-1', 'tab-2']);
    expect(searches.map((s) => s.tabLabel)).toEqual(['Pratica', 'Pratica', 'Pratica — testo al 29/12/2007']);
    expect(searches[2]).toMatchObject({ version: 'vigente', version_date: '2007-12-29', show_brocardi_info: false });
    expect(searches[0]).toMatchObject({ version: 'vigente', version_date: '', show_brocardi_info: true });
  });

  it('still routes the texts in force of two annexes to the one shared tab', () => {
    const { created, searches } = run([g({ allegato: 'A' }), g({ allegato: 'B' })]);
    expect(created).toEqual(['Pratica']);
    expect(searches.map((x) => x.targetTabId)).toEqual(['tab-1', 'tab-1']);
    expect(searches.map((x) => x.annex)).toEqual(['A', 'B']);
  });

  it('creates no shared tab when every group asks for a past text', () => {
    const { created } = run([g(PAST), g({ versione: 'originale' })]);
    expect(created).toEqual(['Pratica — testo al 29/12/2007', 'Pratica — testo originale']);
  });
});
