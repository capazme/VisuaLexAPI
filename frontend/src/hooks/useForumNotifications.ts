import { useEffect, useState, useCallback, useRef } from 'react';
import { notificationService, type ForumUnreadCount } from '../services/notificationService';

const POLL_INTERVAL_MS = 30_000;
const EMPTY: ForumUnreadCount = { pendingSuggestions: 0, newLikes: 0, total: 0 };

/**
 * Polls the forum-unread count every 30s. Pauses when the tab is hidden
 * (Page Visibility API) so background tabs don't burn requests.
 *
 * Returns the count plus a `markRead()` callback the caller can fire when
 * the user lands on /forum to reset the likes cursor server-side. The
 * pending-suggestions count is NOT cleared by markRead — those clear
 * naturally as the owner reviews them.
 */
export function useForumNotifications(enabled: boolean = true) {
  const [internalCount, setInternalCount] = useState<ForumUnreadCount>(EMPTY);
  // Derive at render time — when disabled (e.g. logged out) the badge stays
  // at zero without a setState-in-effect dance (see gotcha #11 in CLAUDE.md).
  const count = enabled ? internalCount : EMPTY;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCount = useCallback(async () => {
    try {
      const data = await notificationService.getForumUnread();
      setInternalCount(data);
    } catch {
      // Network blip; keep last known count instead of zeroing the badge.
    }
  }, []);

  const markRead = useCallback(async () => {
    try {
      await notificationService.markRead();
      // Optimistic local zero of likes; suggestions stay (truth from server).
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

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, fetchCount]);

  return { count, markRead, refetch: fetchCount };
}
