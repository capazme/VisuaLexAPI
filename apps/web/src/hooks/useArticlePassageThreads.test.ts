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

    const { result } = renderHook(() => useArticlePassageThreads({ normaKey: 'k1', articleId: 'art1' }));

    await waitFor(() => {
      expect(result.current.threads).toEqual(dummyThreads);
    });

    expect(articleDiscussionService.listPassages).toHaveBeenCalledTimes(1);
    expect(articleDiscussionService.listPassages).toHaveBeenCalledWith({ normaKey: 'k1', articleId: 'art1' });
  });

  it('returns [] and does not call the service when not authenticated or disabled', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false);

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled?: boolean }) => useArticlePassageThreads({ normaKey: 'k1', articleId: 'art1' }, { enabled }),
      { initialProps: { enabled: true } },
    );

    expect(result.current.threads).toEqual([]);
    expect(articleDiscussionService.listPassages).not.toHaveBeenCalled();

    // Authenticated but disabled
    vi.mocked(isAuthenticated).mockReturnValue(true);
    rerender({ enabled: false });

    expect(result.current.threads).toEqual([]);
    expect(articleDiscussionService.listPassages).not.toHaveBeenCalled();

    // Empty normaKey (an empty articleId is a decision's anchor; the article guards it with enabled)
    renderHook(() => useArticlePassageThreads({ normaKey: '', articleId: 'art1' }));
    expect(articleDiscussionService.listPassages).not.toHaveBeenCalled();
  });

  it('distinguishes a failed passage request from an empty result and retries successfully', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new Error('Network error');
    vi.mocked(articleDiscussionService.listPassages)
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(dummyThreads);

    const { result } = renderHook(() => useArticlePassageThreads({ normaKey: 'k1', articleId: 'art1' }));

    await waitFor(() => {
      expect(result.current.error).toBe(true);
    });
    expect(result.current.threads).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      '[useArticlePassageThreads] could not load the passage discussions',
      { normaKey: 'k1', articleId: 'art1', error },
    );

    act(() => result.current.reload());
    await waitFor(() => {
      expect(result.current.error).toBe(false);
      expect(result.current.threads).toEqual([]);
    });

    act(() => result.current.reload());
    await waitFor(() => {
      expect(result.current.error).toBe(false);
      expect(result.current.threads).toEqual(dummyThreads);
    });
    expect(articleDiscussionService.listPassages).toHaveBeenCalledTimes(3);
    warnSpy.mockRestore();
  });

  it('returns an empty list without an error when the request succeeds with no discussions', async () => {
    vi.mocked(articleDiscussionService.listPassages).mockResolvedValue([]);

    const { result } = renderHook(() => useArticlePassageThreads({ normaKey: 'k1', articleId: 'art1' }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.threads).toEqual([]);
    expect(result.current.error).toBe(false);
  });

  it('clears a previous error while retrying', async () => {
    vi.mocked(articleDiscussionService.listPassages)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(dummyThreads);

    const { result } = renderHook(() => useArticlePassageThreads({ normaKey: 'k1', articleId: 'art1' }));

    await waitFor(() => expect(result.current.error).toBe(true));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(result.current.error).toBe(false);
    await waitFor(() => expect(result.current.threads).toEqual(dummyThreads));
  });

  it('does not expose a previous key\'s error on a new article key', async () => {
    vi.mocked(articleDiscussionService.listPassages)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(dummyThreads);

    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useArticlePassageThreads({ normaKey: key, articleId: 'art1' }),
      { initialProps: { key: 'k1' } },
    );
    await waitFor(() => expect(result.current.error).toBe(true));

    rerender({ key: 'k2' });
    expect(result.current.error).toBe(false);
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.threads).toEqual(dummyThreads));
  });

  it('after the key changes, the old key\'s threads and error are not returned', async () => {
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
      ({ k, a }: { k: string; a: string }) => useArticlePassageThreads({ normaKey: k, articleId: a }),
      { initialProps: { k: 'k1', a: 'art1' } },
    );

    // Initial state is [] and the request starts in the effect.
    expect(result.current.threads).toEqual([]);

    // Key changes immediately before k1 resolves
    rerender({ k: 'k2', a: 'art1' });

    // Must be [] while k2 is loading, even if k1 resolved later
    expect(result.current.threads).toEqual([]);
    expect(result.current.error).toBe(false);
    expect(result.current.isLoading).toBe(true);

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

    const { result } = renderHook(() => useArticlePassageThreads({ normaKey: 'k1', articleId: 'art1' }));

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

  it('keeps the previous threads while it reloads, and reloads every mounted copy of the subject', async () => {
    const second = [{ ...dummyThreads[0], id: 't-new' }];
    let release!: (value: ArticleDiscussionPassageSummary[]) => void;
    vi.mocked(articleDiscussionService.listPassages)
      .mockResolvedValueOnce(dummyThreads)
      .mockResolvedValueOnce(dummyThreads)
      .mockReturnValue(new Promise((resolve) => { release = resolve; }));

    const visible = renderHook(() => useArticlePassageThreads({ normaKey: 'k1', articleId: 'art1' }));
    const hidden = renderHook(() => useArticlePassageThreads({ normaKey: 'k1', articleId: 'art1' }));
    await waitFor(() => expect(visible.result.current.threads).toEqual(dummyThreads));
    await waitFor(() => expect(hidden.result.current.threads).toEqual(dummyThreads));

    act(() => visible.result.current.reload());
    await waitFor(() => expect(hidden.result.current.isLoading).toBe(true));
    // no flicker: the list stays while the new one is on its way
    expect(visible.result.current.threads).toEqual(dummyThreads);
    expect(hidden.result.current.threads).toEqual(dummyThreads);

    await act(async () => { release(second); });
    await waitFor(() => expect(hidden.result.current.threads).toEqual(second));
    expect(visible.result.current.threads).toEqual(second);
  });

  describe('anchored on a decision', () => {
    const decisionKey = 'cassazione:civile:99999:2024';
    const plainText = 'Premesso che il ricorso e inammissibile. Il giudice ha deciso.';
    const decisionThreads: ArticleDiscussionPassageSummary[] = [
      { ...dummyThreads[0], id: 'd-exact', articleUrn: null, passage: { quote: 'ricorso e inammissibile', start: 16, prefix: 'Premesso che il ', suffix: '. Il giudice ha ' } },
      { ...dummyThreads[0], id: 'd-gone', articleUrn: null, passage: { quote: 'parole che non esistono piu', start: 3, prefix: '', suffix: '' } },
    ];

    it('loads with an empty articleId, because the key is the whole identity', async () => {
      vi.mocked(articleDiscussionService.listPassages).mockResolvedValue(decisionThreads);

      const { result } = renderHook(() => useArticlePassageThreads({ normaKey: decisionKey, articleId: '' }));

      await waitFor(() => expect(result.current.threads).toEqual(decisionThreads));
      expect(articleDiscussionService.listPassages).toHaveBeenCalledWith({ normaKey: decisionKey, articleId: '' });
      expect(result.current.locations.size).toBe(0);
    });

    it('locates each passage on the projection it is given', async () => {
      vi.mocked(articleDiscussionService.listPassages).mockResolvedValue(decisionThreads);

      const { result } = renderHook(() =>
        useArticlePassageThreads({ normaKey: decisionKey, articleId: '' }, { plainText }),
      );

      await waitFor(() => expect(result.current.threads).toHaveLength(2));
      expect(result.current.locations.get('d-exact')?.state).toBe('exact');
      expect(result.current.locations.get('d-gone')?.state).toBe('detached');
    });

    it('does not load without a key, or when disabled', () => {
      renderHook(() => useArticlePassageThreads({ normaKey: '', articleId: '' }));
      renderHook(() => useArticlePassageThreads({ normaKey: decisionKey, articleId: '' }, { enabled: false }));
      expect(articleDiscussionService.listPassages).not.toHaveBeenCalled();
    });
  });
});
