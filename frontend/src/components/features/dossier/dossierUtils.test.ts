import { describe, it, expect } from 'vitest';
import {
  searchParamsFromNorma, packItemContent, unpackItemContent,
  computeItemCounts, dossierRecency, dossierContainsArticle,
} from './dossierUtils';
import type { Dossier, DossierItem, NormaVisitata } from '../../../types';

const norma: NormaVisitata = {
  tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '2043',
};
const item = (over: Partial<DossierItem>): DossierItem => ({
  id: 'i1', type: 'norma', data: norma, addedAt: '2026-08-01T10:00:00.000Z', ...over,
});
const dossier = (items: DossierItem[]): Dossier => ({
  id: 'd1', title: 'Pratica', createdAt: '2026-07-01T09:00:00.000Z', items,
});

describe('searchParamsFromNorma', () => {
  it('maps NormaVisitata to SearchParams honoring stored version', () => {
    expect(searchParamsFromNorma({ ...norma, versione: 'originale', data_versione: '1990-01-01', allegato: '2' }))
      .toEqual({
        act_type: 'codice civile', act_number: '262', date: '1942-03-16', article: '2043',
        version: 'originale', version_date: '1990-01-01', show_brocardi_info: true, annex: '2',
      });
  });
  it('defaults to vigente and empty version_date', () => {
    const p = searchParamsFromNorma(norma);
    expect(p.version).toBe('vigente');
    expect(p.version_date).toBe('');
    expect(p).not.toHaveProperty('annex');
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
});
