import { describe, expect, it, vi } from 'vitest';
import { buildSearchDeepLink, parseSearchDeepLink } from './deepLinks';
import type { SearchParams } from '../types';

const params: SearchParams = {
  act_type: 'regolamento UE',
  act_number: '679',
  date: '2016-04-27',
  article: '5',
  version: 'vigente',
  version_date: '',
  show_brocardi_info: true,
  filters: { source: 'eurlex', hasBrocardi: true, onlyHistorical: false },
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

  it('rejects malformed values', () => {
    expect(parseSearchDeepLink('not-valid')).toBeNull();
  });
});
