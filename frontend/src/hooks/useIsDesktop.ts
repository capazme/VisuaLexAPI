import { useState, useEffect } from 'react';

/** Matches Tailwind's `md` breakpoint, which is where the app splits layouts. */
const DESKTOP_QUERY = '(min-width: 768px)';

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
