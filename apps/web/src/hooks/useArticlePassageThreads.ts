import { useState, useEffect, useCallback, useMemo } from 'react';
import { articleDiscussionService } from '../services/articleDiscussionService';
import { isAuthenticated } from '../services/authService';
import { locatePassage, type PassageLocation } from '../utils/threadPassages';
import type { ArticleDiscussionPassageSummary } from '../types';

// Every mounted copy of one subject (the phone view and the desktop panel are both mounted, one
// hidden) listens to the same key: a reload asked by one reaches all of them, and their requests
// share the service's in-flight list.
const reloadListeners = new Map<string, Set<() => void>>();

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
}

export interface PassageThreadsOptions {
  /** False: no request (the caller's own guard, e.g. no text yet). Default true. */
  enabled?: boolean;
  /** The plain text (the projection, for a decision) the passages are located against. */
  plainText?: string;
}

/**
 * The passage discussions of one article or decision, for its signs: one light
 * request (GET /article-discussions/passages) when it is shown, none when the
 * reader is not logged in. `reload` asks again (after a new discussion), in every mounted copy
 * of the same subject. While it reloads, the previous list stays (the signs do not flicker).
 *
 * The anchor comes from the caller, who decides what identifies the subject: an
 * article passes its key and article id (and folds `Boolean(articleId)` into
 * `enabled`), a decision passes `articleId: ''`. With `plainText`, `locations`
 * says where each passage is in it (`locatePassage`): the one place "detached"
 * is computed.
 */
export function useArticlePassageThreads(
  anchor: PassageThreadsAnchor,
  { enabled = true, plainText: plain }: PassageThreadsOptions = {},
): PassageThreadsResult {
  const { normaKey, articleId } = anchor;
  const hasIdentity = Boolean(normaKey);
  const [reloadCount, setReloadCount] = useState(0);
  const [loadedData, setLoadedData] = useState<{
    requestId: string;
    key: string;
    threads: ArticleDiscussionPassageSummary[];
    error: boolean;
  }>({
    requestId: '',
    key: '',
    threads: [],
    error: false,
  });

  const currentKey = hasIdentity ? JSON.stringify([normaKey, articleId]) : '';

  useEffect(() => {
    if (!currentKey) return;
    const bump = () => setReloadCount((c) => c + 1);
    const set = reloadListeners.get(currentKey) ?? new Set<() => void>();
    set.add(bump);
    reloadListeners.set(currentKey, set);
    return () => {
      set.delete(bump);
      if (set.size === 0) reloadListeners.delete(currentKey);
    };
  }, [currentKey]);

  const reload = useCallback(() => {
    const listeners = reloadListeners.get(currentKey);
    if (listeners && listeners.size > 0) listeners.forEach((bump) => bump());
    else setReloadCount((c) => c + 1);
  }, [currentKey]);
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
          setLoadedData({ requestId, key: currentKey, threads, error: false });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('[useArticlePassageThreads] could not load the passage discussions', {
            normaKey,
            articleId,
            error,
          });
          setLoadedData({ requestId, key: currentKey, threads: [], error: true });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [normaKey, articleId, currentKey, enabled, hasIdentity, reloadCount]);

  const hasCurrentData = loadedData.requestId === currentRequestId;
  const threads = useMemo(
    () => (hasCurrentData || loadedData.key === currentKey ? loadedData.threads : []),
    [hasCurrentData, loadedData.key, loadedData.threads, currentKey],
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
