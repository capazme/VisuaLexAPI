import { describe, it, expect } from 'vitest';
import {
  searchParamsFromNorma, packItemContent, unpackItemContent,
  computeItemCounts, dossierRecency, dossierContainsArticle, normaForDossier,
} from './dossierUtils';
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

  it('reopens the same version it stored', () => {
    const stored = normaForDossier(block, article({ versione: 'vigente', data_versione: '2007-12-29' }));
    expect(searchParamsFromNorma(stored)).toMatchObject({
      article: '1284', version: 'vigente', version_date: '2007-12-29', show_brocardi_info: false,
    });
  });
});
