import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArticleData, Norma } from '../../types';

const { legalFetch } = vi.hoisted(() => ({ legalFetch: vi.fn() }));
vi.mock('../../services/legalFetch', () => ({ legalFetch }));

import { useAnnexNavigation } from '../useAnnexNavigation';
import { clearActStructureCache } from '../../utils/actStructureCache';

// LC71: the codice civile opened from its index, with no article on the table yet.
const CC: Norma = { tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', urn: 'urn:nir:stato:regio.decreto:1942-03-16;262' };
const ANNEXES = [
  { number: null, label: 'Dispositivo', article_count: 2, article_numbers: ['1', '2'] },
  { number: '1', label: 'Disposizioni sulla legge in generale', article_count: 2, article_numbers: ['1', '2'] },
  { number: '2', label: 'CODICE CIVILE', article_count: 3, article_numbers: ['1', '2', '2043'] },
];
const answer = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });

beforeEach(() => {
  clearActStructureCache();
  legalFetch.mockReset();
  legalFetch.mockImplementation((path: string) =>
    Promise.resolve(answer(path === '/fetch_tree' ? { articles: [], metadata: { annexes: ANNEXES } } : {})));
});

describe('useAnnexNavigation, the part it starts on (LC71)', () => {
  it('with no article open, is the code’s own text, and the arrows count its articles', async () => {
    const { result } = renderHook(() => useAnnexNavigation({ norma: CC, articles: [], addArticles: vi.fn() }));
    await waitFor(() => expect(result.current.currentAnnex).toBe('2'));
    expect(result.current.allArticleIds).toEqual(['1', '2', '2043']);
  });

  it('with an article open, is that article’s part', async () => {
    const preleggi: ArticleData = { norma_data: { ...CC, numero_articolo: '1', allegato: '1' } };
    const { result } = renderHook(() =>
      useAnnexNavigation({ norma: CC, articles: [preleggi], activeArticle: preleggi, addArticles: vi.fn() }));
    await waitFor(() => expect(result.current.treeMetadata).not.toBeNull());
    expect(result.current.currentAnnex).toBe('1');
  });
});
