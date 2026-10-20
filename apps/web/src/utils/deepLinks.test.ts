import { describe, expect, it, vi } from 'vitest';
import { buildSearchDeepLink, parseSearchDeepLink } from './deepLinks';
import { matchesSearchFilters } from './searchFilters';
import type { SearchParams } from '../types';

const params: SearchParams = {
  act_type: 'regolamento UE',
  act_number: '679',
  date: '2016-04-27',
  article: '5',
  version: 'vigente',
  version_date: '',
  filters: { source: 'eurlex', onlyHistorical: false },
};

describe('legal deep links', () => {
  it('round trips unicode parameters and an article anchor', () => {
    vi.stubGlobal('location', { href: 'http://localhost:5173/' });
    const link = buildSearchDeepLink(params, '5');
    const value = new URL(link).searchParams.get('norma');
    expect(value).toBeTruthy();
    expect(parseSearchDeepLink(value!)).toEqual({ params, articleId: '5' });
    vi.unstubAllGlobals();
  });

  it('opens a link made before D-078: its Brocardi flags ride along and nothing reads them', () => {
    vi.stubGlobal('location', { href: 'http://localhost:5173/' });
    const old = { ...params, show_brocardi_info: true, filters: { ...params.filters, hasBrocardi: true } } as unknown as SearchParams;
    const value = new URL(buildSearchDeepLink(old, '5')).searchParams.get('norma');
    const parsed = parseSearchDeepLink(value!);
    expect(parsed?.params.act_type).toBe('regolamento UE');
    // «Solo articoli con dottrina» no longer narrows anything: an article with no Brocardi passes
    const article = { article_text: 'Art. 5', norma_data: { tipo_atto: 'regolamento UE', data: '2016-04-27', numero_articolo: '5' } };
    expect(matchesSearchFilters(article, parsed?.params.filters)).toBe(true);
    vi.unstubAllGlobals();
  });

  it('rejects malformed values', () => {
    expect(parseSearchDeepLink('not-valid')).toBeNull();
  });
});
