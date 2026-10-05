import { describe, it, expect, vi } from 'vitest';
import {
  searchParamsFromNorma, packItemContent, unpackItemContent,
  computeItemCounts, dossierRecency, dossierContainsArticle, normaForDossier,
  computeNormaGroups, searchParamsFromGroup, tabLabelForGroup, searchesForGroups,
  dossierItemFromApi,
  parseSentenzaContent, decisionCitationOf, sentenzaFromDecision, serverItemFor, itemContentFor, dossierContainsDecision,
  validateImportedDossier, dossierSuggestionPayload, importReport, importCounts, importToastType,
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
    ])).toEqual({ norme: 3, sentenze: 0, note: 1, important: 1 });
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

describe('dossierItemFromApi', () => {
  const base = { title: 'x', position: 0, status: 'unread' as const, created_at: '2026-10-04T10:00:00Z' };
  it("keeps the server's citations on a norm", () => {
    const item = dossierItemFromApi({
      ...base, id: 'a', item_type: 'norm',
      content: { tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31', numero_articolo: '3', _dossierMeta: { important: true } },
      citation: 'art. 3, l. 31 dicembre 2012, n. 247', act_citation: 'l. 31 dicembre 2012, n. 247',
    });
    expect(item).toMatchObject({
      id: 'a', type: 'norma', status: 'important', addedAt: base.created_at,
      citation: 'art. 3, l. 31 dicembre 2012, n. 247', actCitation: 'l. 31 dicembre 2012, n. 247',
    });
    expect(item.data).not.toHaveProperty('_dossierMeta');
  });
  it("reads the article a note is about and who wrote it", () => {
    const note = dossierItemFromApi({ ...base, id: 'n', item_type: 'note', content: 'Sul danno.', about_item_id: 'a', created_by: { clientName: 'Claude Code' } });
    expect(note).toMatchObject({ type: 'note', data: 'Sul danno.', aboutItemId: 'a', createdBy: { clientName: 'Claude Code' } });
  });
  it('reads a note, and an answer from a server without the fields', () => {
    const note = dossierItemFromApi({ ...base, id: 'n', item_type: 'note', content: 'appunto' });
    expect(note).toEqual({ id: 'n', type: 'note', data: 'appunto', addedAt: base.created_at });
  });
});

const SENTENZA = { corte: 'cassazione', archivio: 'penale', numero: 10787, anno: 2024, sezione: '7',
  tipo: 'sentenza', data_deposito: '2024-03-12', etichetta: 'Cass. pen., sez. VII, sent. dep. 12 marzo 2024, n. 10787' } as const;

describe('decision items', () => {
  const at = '2026-10-01T00:00:00Z';
  const api = { title: 't', position: 0, status: 'unread' as const, created_at: at };

  it('parseSentenzaContent mirrors the server schema', () => {
    expect(parseSentenzaContent(SENTENZA)).toEqual(SENTENZA);
    for (const bad of [
      { ...SENTENZA, corte: 'tar' }, { ...SENTENZA, archivio: undefined }, { ...SENTENZA, numero: 0 },
      { ...SENTENZA, anno: 3000 }, { ...SENTENZA, testo: 'x' }, { ...SENTENZA, etichetta: '' },
      { ...SENTENZA, sezione: '6-3' }, { corte: 'corte_costituzionale', numero: 1, anno: 2014, sezione: '3', etichetta: 'x' },
      'stringa', null, [],
    ]) {
      expect(parseSentenzaContent(bad)).toBeNull();
    }
  });

  it('parseSentenzaContent refuses each bound for its own reason', () => {
    const COST = { corte: 'corte_costituzionale', numero: 1, anno: 2014, etichetta: 'x' } as const;
    expect(parseSentenzaContent(COST)).toEqual(COST);
    for (const bad of [
      { ...COST, anno: 1955 },                         // before the Corte costituzionale's first year
      { ...SENTENZA, anno: 1899 },                     // before the Cassazione's first year
      { ...SENTENZA, numero: 1.5 },                    // not an integer
      { ...SENTENZA, numero: 1_000_000 },              // above the maximum
      { ...SENTENZA, tipo: 'x' },                      // not a known type
      { ...SENTENZA, data_deposito: '12/03/2024' },    // not an ISO date
      { ...SENTENZA, etichetta: 'x'.repeat(201) },     // label too long
      { ...COST, archivio: 'civile' },                 // the Corte costituzionale has no archive
    ]) {
      expect(parseSentenzaContent(bad)).toBeNull();
    }
    // The edges themselves are accepted.
    expect(parseSentenzaContent({ ...COST, anno: 1956 })).not.toBeNull();
    expect(parseSentenzaContent({ ...SENTENZA, anno: 1900 })).not.toBeNull();
    expect(parseSentenzaContent({ ...SENTENZA, numero: 999_999 })).not.toBeNull();
    expect(parseSentenzaContent({ ...SENTENZA, etichetta: 'x'.repeat(200) })).not.toBeNull();
  });

  it('parseSentenzaContent takes the year bound from the clock it is given', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    expect(parseSentenzaContent({ ...SENTENZA, anno: 2026 }, now)).not.toBeNull();
    expect(parseSentenzaContent({ ...SENTENZA, anno: 2027 }, now)).toBeNull();
  });

  it('dossierItemFromApi reads a decision, and the entries a Forum take stored whole before 2026-10', () => {
    expect(dossierItemFromApi({ ...api, id: 's', item_type: 'sentenza', content: { ...SENTENZA, _dossierMeta: { important: true } } }))
      .toEqual({ id: 's', type: 'sentenza', data: SENTENZA, addedAt: at, status: 'important' });
    expect(dossierItemFromApi({ ...api, id: 'n', item_type: 'norm', content: { articleRef: { tipo_atto: 'codice civile' }, status: 'important' } }).data)
      .toEqual({ tipo_atto: 'codice civile' });
    expect(dossierItemFromApi({ ...api, id: 'o', item_type: 'note', content: { note: 'vecchia' } }).data).toBe('vecchia');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = dossierItemFromApi({ ...api, id: 'b', item_type: 'sentenza', content: { corte: 'tar' } });
    expect(broken).toMatchObject({ type: 'note', data: 'Sentenza non leggibile: i dati salvati sono incompleti.' });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('the stored label is a copy: what is shown and written is the citation recomputed (source convention, Q9)', () => {
    const stale = { ...SENTENZA, etichetta: 'Cass. pen. n. 10787/2024 (vecchia forma)' };
    const item = { id: '1', type: 'sentenza' as const, data: stale, addedAt: '', status: 'important' as const };
    expect(decisionCitationOf(stale)).toBe(SENTENZA.etichetta);
    expect(serverItemFor(item)).toEqual({ itemType: 'sentenza', title: SENTENZA.etichetta });
    expect(itemContentFor(item)).toEqual({ ...SENTENZA, _dossierMeta: { important: true } });
    expect(itemContentFor(item, 'unread')).toEqual(SENTENZA);
  });

  it('counts decisions apart, and tells a kept decision from the other archive\'s', () => {
    const item = { id: '1', type: 'sentenza' as const, data: { ...SENTENZA }, addedAt: '' };
    expect(computeItemCounts([item, { id: '2', type: 'note', data: 'x', addedAt: '' }]))
      .toEqual({ norme: 0, sentenze: 1, note: 1, important: 0 });
    const kept = { id: 'd', title: 'D', createdAt: '', items: [item] };
    expect(dossierContainsDecision(kept, { corte: 'cassazione', archivio: 'penale', numero: 10787, anno: 2024 })).toBe(true);
    expect(dossierContainsDecision(kept, { corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 })).toBe(false);
  });

  it('sentenzaFromDecision keeps only what the item schema accepts, and labels it from that', () => {
    expect(sentenzaFromDecision({ corte: 'cassazione', archivio: 'civile', numero: 5, anno: 2022 },
      { sezione: '6-3', tipo: 'provvedimento', data_deposito: '2022-01-10', relatore: 'X' }))
      .toEqual({ corte: 'cassazione', archivio: 'civile', numero: 5, anno: 2022, data_deposito: '2022-01-10',
        etichetta: 'Cass. civ., 10 gennaio 2022, n. 5' });
    expect(sentenzaFromDecision({ corte: 'cassazione', archivio: 'penale', numero: 10787, anno: 2024 },
      { sezione: '7', tipo: 'sentenza', data_deposito: '2024-03-12' })).toEqual(SENTENZA);
  });

  it('sentenzaFromDecision leaves out a date that is not a plain day', () => {
    const kept = sentenzaFromDecision({ corte: 'cassazione', archivio: 'civile', numero: 5, anno: 2022 },
      { data_deposito: '2022-01-10T00:00:00Z' });
    expect(kept).not.toHaveProperty('data_deposito');
    expect(parseSentenzaContent(kept)).not.toBeNull();
  });
});

describe('an imported dossier', () => {
  it('keeps valid items, and lists what it cannot import with the reason', () => {
    const check = validateImportedDossier({ title: 'Da link', items: [
      { id: '1', type: 'norma', data: { tipo_atto: 'codice civile' }, addedAt: '' },
      { id: '2', type: 'sentenza', data: { ...SENTENZA }, addedAt: '' },
      { id: '3', type: 'sentenza', data: { ...SENTENZA, etichetta: '<img src=x onerror=alert(1)>', corte: 'tar' }, addedAt: '' },
      { id: '4', type: 'script', data: 'x', addedAt: '' },
    ] });
    expect(check?.dossier.items.map((i) => i.id)).toEqual(['1', '2']);
    expect(check?.discarded).toEqual([
      { index: 2, reason: 'sentenza con dati non validi' }, { index: 3, reason: 'tipo di voce sconosciuto' }]);
  });

  it('refuses what is not a dossier', () => {
    expect(validateImportedDossier({ items: [] })).toBeNull();
    expect(validateImportedDossier({ title: 'x', items: 'no' })).toBeNull();
    expect(validateImportedDossier('x')).toBeNull();
  });

  it('says whether everything came in', () => {
    expect(importReport(3, 0)).toBe('Dossier importato');
    expect(importReport(1, 1)).toBe('Dossier importato in parte: 1 voce importata, 1 scartata');
    expect(importReport(4, 2)).toBe('Dossier importato in parte: 4 voci importate, 2 scartate');
  });

  it('a Forum suggestion carries decisions as sentenzaRef, with the citation recomputed', () => {
    const payload = dossierSuggestionPayload({ id: 'd', title: 'D', createdAt: '', items: [
      { id: '1', type: 'sentenza', data: { ...SENTENZA, etichetta: 'Cass. pen. 10787/2024' }, addedAt: '', status: 'important' },
      { id: '2', type: 'note', data: 'n', addedAt: '' },
    ] });
    expect(payload.entries).toEqual([
      { articleRef: undefined, sentenzaRef: SENTENZA, note: undefined, status: 'important' },
      { articleRef: undefined, sentenzaRef: undefined, note: 'n', status: undefined },
    ]);
  });
});

describe('an imported dossier is rebuilt from what was checked', () => {
  const check = (items: unknown[], extra: Record<string, unknown> = {}) => validateImportedDossier({ title: 'T', items, ...extra });

  it('accepts a decision with a valid identity and a markup label, and stores the recomputed citation', () => {
    const out = check([{ id: 's', type: 'sentenza', addedAt: '2026-10-01T00:00:00Z',
      data: { ...SENTENZA, etichetta: '<img src=x onerror=alert(1)>' } }]);
    expect(out?.discarded).toEqual([]);
    expect(out?.dossier.items).toEqual([
      { id: 's', type: 'sentenza', addedAt: '2026-10-01T00:00:00Z', data: SENTENZA },
    ]);
  });

  it('refuses an entry that is not an object, with a reason', () => {
    const proto = JSON.parse('{"__proto__": {"type": "sentenza"}}');
    const out = check([null, 42, 'x', proto]);
    expect(out?.dossier.items).toEqual([]);
    expect(out?.discarded).toEqual([0, 1, 2, 3].map((index) => ({ index, reason: 'tipo di voce sconosciuto' })));
  });

  it('carries over no status, citation or foreign key of a decision, only the whitelisted fields', () => {
    const out = check([{ id: 's', type: 'sentenza', addedAt: '', status: 'x', citation: '<b>x</b>', actCitation: 'y',
      isAdmin: true, data: { ...SENTENZA } }]);
    expect(out?.dossier.items[0]).toEqual({ id: 's', type: 'sentenza', addedAt: expect.any(String), data: SENTENZA });
    expect(Object.keys(out?.dossier.items[0] ?? {}).sort()).toEqual(['addedAt', 'data', 'id', 'type']);
    const starred = check([{ id: 's', type: 'sentenza', status: 'important', data: { ...SENTENZA } }]);
    expect(starred?.dossier.items[0].status).toBe('important');
  });

  it('gives a decision without a usable id or date a new id and the time of the import', () => {
    const out = check([{ id: 7, type: 'sentenza', addedAt: 3, data: { ...SENTENZA } }]);
    const item = out?.dossier.items[0];
    expect(typeof item?.id).toBe('string');
    expect(item?.id).not.toBe('');
    expect(Number.isNaN(Date.parse(item?.addedAt ?? ''))).toBe(false);
  });

  it('refuses a dossier with an empty or blank title', () => {
    expect(validateImportedDossier({ title: '', items: [] })).toBeNull();
    expect(validateImportedDossier({ title: '   ', items: [] })).toBeNull();
  });

  it('drops a description that is not a string and tags that are not a list of strings', () => {
    const bad = check([], { description: { a: 1 }, tags: 'uno,due' });
    expect(bad?.dossier).not.toHaveProperty('description');
    expect(bad?.dossier).not.toHaveProperty('tags');
    expect(check([], { tags: ['a', 3] })?.dossier).not.toHaveProperty('tags');
    const good = check([], { description: 'd', tags: ['a', 'b'] });
    expect(good?.dossier).toMatchObject({ description: 'd', tags: ['a', 'b'] });
  });

  it('words the counts, and picks the toast type from what came in and what was lost', () => {
    expect(importCounts(1, 2)).toBe('1 voce importata, 2 scartate');
    expect(importToastType(3, 0)).toBe('success');
    expect(importToastType(0, 0)).toBe('success');
    expect(importToastType(2, 1)).toBe('info');
    expect(importToastType(0, 2)).toBe('warning');
  });
});
