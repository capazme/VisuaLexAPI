import { useSyncExternalStore } from 'react';
import type { IslandSource } from './IslandSurface';

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
 * What a confirmation grows from (LC85): the control its caller names, while it is on the page, else the rectangle that
 * control had as the confirmation opened (a menu's entry, gone by the time the card grows). Nothing named: nothing, a
 * fade. Never guessed from the focus: a click from a screen reader, or a script, focuses no button.
 */
export function originOf(el: HTMLElement | null | undefined): IslandSource {
  if (!el?.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return el;
  const saved = { top: r.top, right: r.right, bottom: r.bottom, left: r.left, radius: Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, r.height / 2) };
  return () => {
    if (!el.isConnected) return saved;
    const now = el.getBoundingClientRect();
    return now.width && now.height ? { top: now.top, right: now.right, bottom: now.bottom, left: now.left, radius: saved.radius } : saved;
  };
}
