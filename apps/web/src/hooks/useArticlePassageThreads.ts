import { useState, useEffect, useCallback } from 'react';
import { articleDiscussionService } from '../services/articleDiscussionService';
import { isAuthenticated } from '../services/authService';
import type { ArticleDiscussionPassageSummary } from '../types';

/**
 * The passage discussions of one article, for its signs: one light request
 * (GET /article-discussions/passages) when the article is shown, none when the
 * reader is not logged in. `reload` asks again (after a new discussion).
 */
export function useArticlePassageThreads(
  normaKey: string,
  articleId: string,
  enabled = true,
): {
  threads: ArticleDiscussionPassageSummary[];
  isLoading: boolean;
  error: boolean;
  reload: () => void;
} {
  const [reloadCount, setReloadCount] = useState(0);
  const [loadedData, setLoadedData] = useState<{
    requestId: string;
    threads: ArticleDiscussionPassageSummary[];
    error: boolean;
  }>({
    requestId: '',
    threads: [],
    error: false,
  });

  const reload = useCallback(() => {
    setReloadCount((c) => c + 1);
  }, []);

  const currentKey = normaKey && articleId ? JSON.stringify([normaKey, articleId]) : '';
  const currentRequestId = currentKey ? JSON.stringify([currentKey, reloadCount]) : '';
  const shouldLoad = enabled && Boolean(currentKey) && isAuthenticated();

  useEffect(() => {
    if (!enabled || !normaKey || !articleId || !isAuthenticated()) {
      return;
    }

    const requestId = JSON.stringify([currentKey, reloadCount]);
    let cancelled = false;

    articleDiscussionService
      .listPassages({ normaKey, articleId })
      .then((threads) => {
        if (!cancelled) {
          setLoadedData({ requestId, threads, error: false });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('[useArticlePassageThreads] could not load the passage discussions', {
            normaKey,
            articleId,
            error,
          });
          setLoadedData({ requestId, threads: [], error: true });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [normaKey, articleId, currentKey, enabled, reloadCount]);

  const hasCurrentData = loadedData.requestId === currentRequestId;
  const threads = hasCurrentData ? loadedData.threads : [];
  const isLoading = shouldLoad && !hasCurrentData;
  const error = hasCurrentData && loadedData.error;

  return { threads, isLoading, error, reload };
}
