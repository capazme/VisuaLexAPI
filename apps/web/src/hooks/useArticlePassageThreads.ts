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
  reload: () => void;
} {
  const [reloadCount, setReloadCount] = useState(0);
  const [loadedData, setLoadedData] = useState<{
    key: string;
    threads: ArticleDiscussionPassageSummary[];
  }>({
    key: '',
    threads: [],
  });

  const reload = useCallback(() => {
    setReloadCount((c) => c + 1);
  }, []);

  const currentKey = normaKey && articleId ? `${normaKey}:${articleId}` : '';

  useEffect(() => {
    if (!enabled || !normaKey || !articleId || !isAuthenticated()) {
      return;
    }

    const requestKey = `${normaKey}:${articleId}`;
    let cancelled = false;

    articleDiscussionService
      .listPassages({ normaKey, articleId })
      .then((threads) => {
        if (!cancelled) {
          setLoadedData({ key: requestKey, threads });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('[useArticlePassageThreads] could not load the passage discussions', {
            normaKey,
            articleId,
            error,
          });
          setLoadedData({ key: requestKey, threads: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [normaKey, articleId, enabled, reloadCount]);

  const threads = loadedData.key === currentKey ? loadedData.threads : [];

  return { threads, reload };
}
