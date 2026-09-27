import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import {
  focusRail,
  isRailWinner,
  registerRail,
  subscribeRailFocus,
  unregisterRail,
} from './railFocus';

/**
 * Responsive presentation mode for the rail (design §3.4):
 *  - `reflow`      desktop ≥1280px: opening pushes the reading column, no overlay
 *  - `overlay`     768–1279px: slides in from the right over a scrim
 *  - `bottom-sheet` <768px: ~55% height sheet from the bottom, scrim to dismiss
 */
export type RailMode = 'reflow' | 'overlay' | 'bottom-sheet';

const REFLOW_MIN = 1280;
const OVERLAY_MIN = 768;

function modeForWidth(width: number): RailMode {
  if (width >= REFLOW_MIN) return 'reflow';
  if (width >= OVERLAY_MIN) return 'overlay';
  return 'bottom-sheet';
}

function subscribeViewport(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('resize', callback);
  return () => window.removeEventListener('resize', callback);
}

function getViewportWidth(): number {
  return typeof window === 'undefined' ? REFLOW_MIN : window.innerWidth;
}

/** Current responsive rail mode, recomputed on viewport resize. */
export function useRailMode(): RailMode {
  const width = useSyncExternalStore(subscribeViewport, getViewportWidth, () => REFLOW_MIN);
  return modeForWidth(width);
}

/**
 * Registers this rail with the single-instance coordinator and reports whether
 * it is the current winner. Rebinding to a new `articleUrn` (the article the
 * user just navigated to) pulls focus to this instance, so exactly one rail —
 * the focused article's — renders its UI.
 *
 * Registration must NOT run during render: registerRail() synchronously
 * notifies every other mounted rail's useSyncExternalStore, which schedules a
 * setState in a sibling component — illegal mid-render ("Cannot update a
 * component while rendering a different component"). So the useState initializer
 * only mints a stable id (pure); registration happens in a layout effect, which
 * runs after render but before paint — no flash, no cross-component render churn.
 * The cleanup unregisters on unmount so the next-highest live rail wins.
 *
 * Only a DISPLAYED copy registers. Some containers render the same article
 * twice for responsive layout (NormaCard: `md:hidden` + `hidden md:block`), so
 * two rails mount for one article; registering the copy that is `display:none`
 * at the current width would elect a winner the user cannot see (on mobile the
 * bottom-sheet would be unreachable). `anchorEl` is a zero-size in-flow probe;
 * we walk its ancestors for `display:none`. In jsdom (no Tailwind stylesheet)
 * the walk never finds `none`, so unit tests treat every rail as displayed.
 */
function isDisplayed(el: HTMLElement | null): boolean {
  if (!el || typeof window === 'undefined') return true;
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (window.getComputedStyle(node).display === 'none') return false;
  }
  return true;
}

export function useRailFocus(
  articleUrn: string | undefined,
  anchorEl: HTMLElement | null,
): boolean {
  // Stable per-instance id. PURE — no side effect in the initializer.
  const [id] = useState<symbol>(() => Symbol('merlt-rail'));

  // Coarse breakpoint signal: re-evaluate visibility only when the md (768px)
  // boundary is crossed, not on every resize pixel (avoids register churn).
  const viewportWidth = useSyncExternalStore(subscribeViewport, getViewportWidth, () => REFLOW_MIN);
  const mdUp = viewportWidth >= OVERLAY_MIN;

  const isWinner = useSyncExternalStore(
    subscribeRailFocus,
    () => isRailWinner(id),
    () => false,
  );

  // Register while displayed / unregister when hidden or unmounted, in a layout
  // effect (pre-paint, post-render) so the winner is settled before paint
  // without notifying sibling rails during render.
  useLayoutEffect(() => {
    if (isDisplayed(anchorEl)) {
      registerRail(id);
      return () => unregisterRail(id);
    }
    unregisterRail(id);
    return undefined;
  }, [id, anchorEl, mdUp]);

  // Pull focus whenever the bound article changes (fresh navigation wins).
  // No-op while unregistered (hidden copy); layout effect so switching articles
  // never paints the old winner first.
  useLayoutEffect(() => {
    focusRail(id);
  }, [id, articleUrn, mdUp]);

  return isWinner;
}
