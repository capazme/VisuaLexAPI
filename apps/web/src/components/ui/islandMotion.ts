import { useSyncExternalStore } from 'react';

/** What `IslandSurface` shares with its neighbours (the search's veil, the confirmations). */

/** The values an element shows now (an animation running included), to go on from there. */
export function now(el: HTMLElement, keys: string[]): Keyframe {
  const style = getComputedStyle(el) as unknown as Record<string, string>;
  return Object.fromEntries(keys.map((key) => [key, style[key]]));
}

const REDUCE = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (change: () => void) => {
  const query = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCE) : null;
  query?.addEventListener?.('change', change);
  return () => query?.removeEventListener?.('change', change);
};
const reducedNow = () => typeof window.matchMedia === 'function' && Boolean(window.matchMedia(REDUCE)?.matches);
/** «Riduci movimento», followed while the page is open (`matchMedia`'s `change`): Framer's hook reads it once. */
export function useReducedMotionLive(): boolean {
  return useSyncExternalStore(subscribeMotion, reducedNow, () => false);
}

/**
 * The last control pressed, for a surface opened from one that a click did not focus (Safari, a tap): what the
 * confirmations grow from when their caller names nothing.
 */
let lastPressed: HTMLElement | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (event) => {
    lastPressed = (event.target as Element | null)?.closest?.<HTMLElement>('button, a, [role="menuitem"], [role="button"]') ?? null;
  }, true);
  // A key since: what opens now was not opened by that press (an Esc, a shortcut).
  document.addEventListener('keydown', () => {
    lastPressed = null;
  }, true);
}
/** What opened a surface now: the focused control, else the last one pressed, if still on the page. */
export function openerNow(): HTMLElement | null {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) return active;
  return lastPressed?.isConnected ? lastPressed : null;
}
