import { useState, useEffect, useCallback, useMemo } from 'react';
import { articleDiscussionService } from '../services/articleDiscussionService';
import { isAuthenticated } from '../services/authService';
import { locatePassage, type PassageLocation } from '../utils/threadPassages';
import type { ArticleDiscussionPassageSummary } from '../types';

export interface PassageThreadsResult {
  threads: ArticleDiscussionPassageSummary[];
  isLoading: boolean;
  error: boolean;
  reload: () => void;
  /** Where each thread's passage is in `plainText` (empty without it). */
  locations: Map<string, PassageLocation>;
}

export interface PassageThreadsAnchor {
  normaKey: string;
  /** '' for a court decision (its key is the whole identity). */
  articleId: string;
  /** The plain text (the projection, for a decision) the passages are located against. */
  plainText?: string;
}

/**
 * The passage discussions of one article or decision, for its signs: one light
 * request (GET /article-discussions/passages) when it is shown, none when the
 * reader is not logged in. `reload` asks again (after a new discussion).
 *
 * Called with `(normaKey, articleId, enabled)` an article needs both parts; called
 * with an anchor object the caller decides: a decision passes `articleId: ''`.
 * With `plainText` in the anchor, `locations` says where each passage is in it.
 */
export function useArticlePassageThreads(
  normaKey: string,
  articleId: string,
  enabled?: boolean,
): PassageThreadsResult;
export function useArticlePassageThreads(anchor: PassageThreadsAnchor, enabled?: boolean): PassageThreadsResult;
export function useArticlePassageThreads(
  first: string | PassageThreadsAnchor,
  second?: string | boolean,
  third = true,
): PassageThreadsResult {
  const fromAnchor = typeof first !== 'string';
  const normaKey = fromAnchor ? first.normaKey : first;
  const articleId = fromAnchor ? first.articleId : (second as string);
  const plain = fromAnchor ? first.plainText : undefined;
  const enabled = fromAnchor ? (second as boolean | undefined) ?? true : third;
  const hasIdentity = Boolean(normaKey) && (fromAnchor || Boolean(articleId));
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

  const currentKey = hasIdentity ? JSON.stringify([normaKey, articleId]) : '';
  const currentRequestId = currentKey ? JSON.stringify([currentKey, reloadCount]) : '';
  const shouldLoad = enabled && Boolean(currentKey) && isAuthenticated();

  useEffect(() => {
    if (!enabled || !hasIdentity || !isAuthenticated()) {
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
  }, [normaKey, articleId, currentKey, enabled, hasIdentity, reloadCount]);

  const hasCurrentData = loadedData.requestId === currentRequestId;
  const threads = useMemo(
    () => (hasCurrentData ? loadedData.threads : []),
    [hasCurrentData, loadedData.threads],
  );
  const isLoading = shouldLoad && !hasCurrentData;
  const error = hasCurrentData && loadedData.error;

  const locations = useMemo(
    () => new Map<string, PassageLocation>(
      plain === undefined ? [] : threads.map((t) => [t.id, locatePassage(plain, t.passage)]),
    ),
    [threads, plain],
  );

  return { threads, isLoading, error, reload, locations };
}
