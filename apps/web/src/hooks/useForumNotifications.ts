import { useEffect, useState, useCallback, useRef } from 'react';
import { notificationService, type ForumUnreadCount } from '../services/notificationService';

const POLL_INTERVAL_MS = 30_000;

/**
 * Dispatched on `window` by the surface that marks the norma-change
 * notifications read (`NormaChangesSection` on Cronologia), so the badge
 * drops at once instead of on the next 30s poll. The hook and that page
 * share no state, and a store slice for one counter would be overkill.
 */
export const NORMA_NOTIFICATIONS_CHANGED_EVENT = 'visualex:norma-notifications-changed';

const EMPTY: ForumUnreadCount = { pendingSuggestions: 0, newLikes: 0, normaChanges: 0, total: 0 };

/**
 * Polls the unread counters every 30s. Pauses when the tab is hidden
 * (Page Visibility API) so background tabs don't burn requests.
 *
 * Two independent counters ride the same poll:
 * - `total` is the Forum's own (pending suggestions + new likes) and badges
 *   the Forum entry. `markRead()` resets the likes cursor server-side when
 *   the user lands on /forum; pending suggestions are NOT cleared by it —
 *   those clear naturally as the owner reviews them.
 * - `normaChanges` counts the unread "a saved norm changed" notifications
 *   and badges Cronologia, where they are listed and marked read. It is
 *   deliberately kept out of `total`: folded into the Forum badge it once
 *   made a count nothing on that page could clear.
 */
export function useForumNotifications(enabled: boolean = true) {
  const [internalCount, setInternalCount] = useState<ForumUnreadCount>(EMPTY);
  // Derive at render time — when disabled (e.g. logged out) the badge stays
  // at zero without a setState-in-effect dance (see gotcha #11 in CLAUDE.md).
  const count = enabled ? internalCount : EMPTY;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCount = useCallback(async () => {
    // Each counter fails on its own: a blip on one keeps the other's last
    // known value instead of zeroing the badge.
    const [forumResult, normaResult] = await Promise.allSettled([
      notificationService.getForumUnread(),
      notificationService.getUnreadNormaChangeCount(),
    ]);
    setInternalCount(prev => {
      const forum = forumResult.status === 'fulfilled' ? forumResult.value : prev;
      const normaChanges = normaResult.status === 'fulfilled' ? normaResult.value : prev.normaChanges;
      return {
        pendingSuggestions: forum.pendingSuggestions,
        newLikes: forum.newLikes,
        total: forum.pendingSuggestions + forum.newLikes,
        normaChanges,
      };
    });
  }, []);

  const markRead = useCallback(async () => {
    try {
      await notificationService.markRead();
      // Optimistic local zero of likes; suggestions stay.
      setInternalCount(prev => ({ ...prev, newLikes: 0, total: prev.pendingSuggestions }));
    } catch {
      // Non-fatal; next poll will reconcile.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const tick = () => { if (!cancelled) void fetchCount(); };

    tick(); // immediate fetch on mount
    intervalRef.current = setInterval(tick, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(NORMA_NOTIFICATIONS_CHANGED_EVENT, tick);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(NORMA_NOTIFICATIONS_CHANGED_EVENT, tick);
    };
  }, [enabled, fetchCount]);

  return { count, markRead, refetch: fetchCount };
}
