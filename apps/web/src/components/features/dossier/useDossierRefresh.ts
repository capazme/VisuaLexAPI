import { useEffect, useRef } from 'react';
import { useAppStore } from '../../../store/useAppStore';

/** At most one background read in this window, whatever triggered it. */
export const REFRESH_MIN_INTERVAL_MS = 15_000;
/** The light poll while the page is open and visible. */
export const REFRESH_POLL_MS = 60_000;

/**
 * Keeps the dossier page in step with what a connected application (Claude, LibreLex) adds or
 * deletes from elsewhere: read again when the window comes back into focus or into view, and every
 * minute while it is visible. One open dossier is read alone, the list as a whole; the reads are
 * quiet (`refreshDossier`'s rules: a failure is logged, an answer older than an edit made here is
 * dropped) and `onRefresh` runs with them (the page's trash). No websockets, by decision.
 */
export function useDossierRefresh(dossierId: string | null, onRefresh?: () => void) {
  const refreshDossier = useAppStore((s) => s.refreshDossier);
  const refreshDossiers = useAppStore((s) => s.refreshDossiers);
  const lastRef = useRef(0);
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);

  useEffect(() => {
    // What is on screen was just read: the first background read waits its window.
    lastRef.current = Date.now();
    const refresh = (event?: Event) => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastRef.current < REFRESH_MIN_INTERVAL_MS) return;
      lastRef.current = now;
      void (dossierId ? refreshDossier(dossierId, { quiet: true }) : refreshDossiers());
      // The trash reads itself on coming into view: only the focus and the poll call it here.
      if (event?.type !== 'visibilitychange') onRefreshRef.current?.();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const poll = window.setInterval(() => refresh(), REFRESH_POLL_MS);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.clearInterval(poll);
    };
  }, [dossierId, refreshDossier, refreshDossiers]);
}
