import { useState, useEffect, useSyncExternalStore } from 'react';

/** Matches Tailwind's `md` breakpoint, which is where the app splits layouts. */
const DESKTOP_QUERY = '(min-width: 768px)';

/**
 * Whether the viewport is desktop-sized, read once: for a store action, which has no component to
 * hold `useIsDesktop`. Without `matchMedia` (a test environment) the desktop is assumed, as the
 * hook's own initial state does outside a window.
 */
export function isDesktopViewport(): boolean {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? true
    : window.matchMedia(DESKTOP_QUERY).matches;
}

/**
 * `true` when the viewport is desktop-sized.
 *
 * Deliberately minimal — no SSR handling, no configurable breakpoint. Use it
 * when a component must render *structurally* different markup per viewport
 * (a floating window vs. a bottom sheet, a portal vs. an inline panel), which
 * a CSS `hidden md:block` wrapper cannot express: a portal escapes
 * `display: none`, so the hidden branch would leak onto the visible one.
 *
 * For anything a CSS breakpoint can handle, use the CSS breakpoint.
 */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(DESKTOP_QUERY).matches : true,
  );

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const handler = (e: MediaQueryListEvent) => setDesktop(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return desktop;
}

/**
 * Whether `query` matches, following the window: for a breakpoint other than `md` that must change
 * markup or state, not only classes (the sidebar's words from `xl`). Read through
 * `useSyncExternalStore`, so a change between the render and the subscription is not missed. Without
 * `matchMedia` (a test environment) it is false.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  );
}
