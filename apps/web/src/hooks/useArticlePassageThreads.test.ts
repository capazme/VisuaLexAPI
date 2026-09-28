import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useArticlePassageThreads } from './useArticlePassageThreads';
import { articleDiscussionService } from '../services/articleDiscussionService';
import { isAuthenticated } from '../services/authService';
import type { ArticleDiscussionPassageSummary } from '../types';

vi.mock('../services/articleDiscussionService', () => ({
  articleDiscussionService: {
    listPassages: vi.fn(),
  },
}));

vi.mock('../services/authService', () => ({
  isAuthenticated: vi.fn(),
}));

describe('useArticlePassageThreads', () => {
  const dummyThreads: ArticleDiscussionPassageSummary[] = [
    {
      id: 't1',
      title: 'Discussione 1',
      passage: { quote: 'inadempimento', start: 10, prefix: '', suffix: '' },
      articleUrn: 'urn:nir:stato:legge:1942;262~art1453',
      textHash: 'abc',
      commentCount: 2,
      createdAt: '2026-09-28',
      user: { id: 'u1', username: 'marta' },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAuthenticated).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads once for a key and returns the threads', async () => {
    vi.mocked(articleDiscussionService.listPassages).mockResolvedValue(dummyThreads);

    const { result } = renderHook(() => useArticlePassageThreads('k1', 'art1'));

    await waitFor(() => {
      expect(result.current.threads).toEqual(dummyThreads);
    });

    expect(articleDiscussionService.listPassages).toHaveBeenCalledTimes(1);
    expect(articleDiscussionService.listPassages).toHaveBeenCalledWith({ normaKey: 'k1', articleId: 'art1' });
  });

  it('returns [] and does not call the service when not authenticated or disabled', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false);

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled?: boolean }) => useArticlePassageThreads('k1', 'art1', enabled),
      { initialProps: { enabled: true } },
    );

    expect(result.current.threads).toEqual([]);
    expect(articleDiscussionService.listPassages).not.toHaveBeenCalled();

    // Authenticated but disabled
    vi.mocked(isAuthenticated).mockReturnValue(true);
    rerender({ enabled: false });

    expect(result.current.threads).toEqual([]);
    expect(articleDiscussionService.listPassages).not.toHaveBeenCalled();

    // Empty normaKey or articleId
    renderHook(() => useArticlePassageThreads('', 'art1'));
    renderHook(() => useArticlePassageThreads('k1', ''));
    expect(articleDiscussionService.listPassages).not.toHaveBeenCalled();
  });

  it('on a rejected request, returns [] and logs with console.warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new Error('Network error');
    vi.mocked(articleDiscussionService.listPassages).mockRejectedValue(error);

    const { result } = renderHook(() => useArticlePassageThreads('k1', 'art1'));

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        '[useArticlePassageThreads] could not load the passage discussions',
        { normaKey: 'k1', articleId: 'art1', error },
      );
    });

    expect(result.current.threads).toEqual([]);
    warnSpy.mockRestore();
  });

  it('after the key changes, the old key\'s threads are not returned', async () => {
    let resolveFirst: (v: ArticleDiscussionPassageSummary[]) => void;
    const firstPromise = new Promise<ArticleDiscussionPassageSummary[]>((res) => {
      resolveFirst = res;
    });

    vi.mocked(articleDiscussionService.listPassages).mockImplementation(({ normaKey }) => {
      if (normaKey === 'k1') return firstPromise;
      return Promise.resolve([
        {
          ...dummyThreads[0],
          id: 't2',
          title: 'Discussione 2',
        },
      ]);
    });

    const { result, rerender } = renderHook(
      ({ k, a }: { k: string; a: string }) => useArticlePassageThreads(k, a),
      { initialProps: { k: 'k1', a: 'art1' } },
    );

    // Initial state is []
    expect(result.current.threads).toEqual([]);

    // Key changes immediately before k1 resolves
    rerender({ k: 'k2', a: 'art1' });

    // Must be [] while k2 is loading, even if k1 resolved later
    expect(result.current.threads).toEqual([]);

    await waitFor(() => {
      expect(result.current.threads).toHaveLength(1);
      expect(result.current.threads[0].id).toBe('t2');
    });

    // Now resolve first promise
    resolveFirst!(dummyThreads);
    // Should still be k2's thread
    expect(result.current.threads[0].id).toBe('t2');
  });

  it('reload() fetches again', async () => {
    vi.mocked(articleDiscussionService.listPassages).mockResolvedValue(dummyThreads);

    const { result } = renderHook(() => useArticlePassageThreads('k1', 'art1'));

    await waitFor(() => {
      expect(result.current.threads).toEqual(dummyThreads);
    });

    expect(articleDiscussionService.listPassages).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.reload();
    });

    await waitFor(() => {
      expect(articleDiscussionService.listPassages).toHaveBeenCalledTimes(2);
    });
  });
});
