import { useEffect, useRef } from 'react';
import { sendArticleViewedEvent } from '../../../services/merltService';
import { useConsent } from '../consent/useConsent';

/**
 * Hook that emits an `article:viewed` event to the BFF when the article
 * has been "effectively read":
 *   viewport-visible ≥ DWELL_THRESHOLD_MS  OR  scroll ≥ SCROLL_THRESHOLD_PCT
 *
 * Slice 1 design — see docs/superpowers/specs/2026-05-22-merlt-integration-slice1-design.md
 * section "Trigger frontend".
 *
 * Fire-and-forget: the network call never blocks the UI, errors are
 * swallowed (BFF logs to dead-letter file).
 */

const DWELL_THRESHOLD_MS = 3000;
const SCROLL_THRESHOLD_PCT = 30;

export interface UseArticleViewedTrackerOptions {
  articleUrn: string | undefined;
  normaVisitataId?: string;
  /** Required: a ref to the scrollable article container. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Optional override for stable session identification. */
  sessionId?: string;
  /** Disable tracking entirely (e.g. feature flag off). Default: false. */
  disabled?: boolean;
}

function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: should never hit in modern browsers
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useArticleViewedTracker({
  articleUrn,
  normaVisitataId,
  containerRef,
  sessionId,
  disabled = false,
}: UseArticleViewedTrackerOptions): void {
  const { canTrack } = useConsent();
  const stateRef = useRef({
    dwellMs: 0,
    scrollMaxPct: 0,
    isVisible: false,
    lastVisibleAt: 0,
    emitted: false,
    sessionId: sessionId ?? generateSessionId(),
  });

  // Re-use the same session id across re-renders unless override changes
  useEffect(() => {
    if (sessionId) stateRef.current.sessionId = sessionId;
  }, [sessionId]);

  // Keep the latest consent value reachable from the cleanup-path emission,
  // so revoking consent mid-read suppresses the event instead of dead-lettering.
  const canTrackRef = useRef(canTrack);
  useEffect(() => {
    canTrackRef.current = canTrack;
  }, [canTrack]);

  useEffect(() => {
    if (disabled || !articleUrn || !containerRef.current) return;
    if (!canTrackRef.current) return;

    const el = containerRef.current;
    const state = stateRef.current;
    state.dwellMs = 0;
    state.scrollMaxPct = 0;
    state.emitted = false;

    // ---- IntersectionObserver: track viewport visibility (≥50% visible) ----
    let lastEntry: IntersectionObserverEntry | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        lastEntry = entry;
        if (entry.isIntersecting) {
          if (!state.isVisible) {
            state.isVisible = true;
            state.lastVisibleAt = performance.now();
          }
        } else {
          if (state.isVisible) {
            state.dwellMs += performance.now() - state.lastVisibleAt;
            state.isVisible = false;
          }
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);

    // ---- Scroll tracking on the container ----
    const onScroll = (): void => {
      const maxScroll = el.scrollHeight - el.clientHeight;
      if (maxScroll <= 0) return;
      const pct = Math.min(100, Math.max(0, (el.scrollTop / maxScroll) * 100));
      if (pct > state.scrollMaxPct) state.scrollMaxPct = pct;
    };
    el.addEventListener('scroll', onScroll, { passive: true });

    // ---- Pause-on-blur (tab hidden) so we don't count time when away ----
    const onVisibilityChange = (): void => {
      if (document.hidden && state.isVisible) {
        state.dwellMs += performance.now() - state.lastVisibleAt;
        state.isVisible = false;
      } else if (!document.hidden && lastEntry?.isIntersecting) {
        state.isVisible = true;
        state.lastVisibleAt = performance.now();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // ---- Cleanup → emit event if threshold met ----
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibilityChange);

      if (state.isVisible) {
        state.dwellMs += performance.now() - state.lastVisibleAt;
        state.isVisible = false;
      }

      const meetsDwell = state.dwellMs >= DWELL_THRESHOLD_MS;
      const meetsScroll = state.scrollMaxPct >= SCROLL_THRESHOLD_PCT;
      if (state.emitted) return;
      // Consent may have been revoked mid-read (effect re-ran with canTrack
      // false → this cleanup): honour the live value, don't dead-letter a 403.
      if (!canTrackRef.current) return;
      if (!(meetsDwell || meetsScroll)) return;

      state.emitted = true;
      void sendArticleViewedEvent({
        articleUrn,
        normaVisitataId,
        dwellMs: Math.round(state.dwellMs),
        scrollMaxPct: Math.round(state.scrollMaxPct * 100) / 100,
        sessionId: state.sessionId,
      }).catch((err) => {
        // Fire-and-forget: BFF dead-letter handles persistence
        console.warn('[merlt] article:viewed emit failed:', err);
      });
    };
    // canTrack is intentionally NOT a dependency: re-running on revoke would
    // fire this cleanup while the ref still held the stale (true) value (effect
    // cleanup runs before the ref-sync effect). Gating on canTrackRef.current
    // (synced separately) makes unmount/article-change honour the live value.
  }, [articleUrn, normaVisitataId, containerRef, disabled]);
}
