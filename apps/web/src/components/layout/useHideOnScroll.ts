import { useCallback, useEffect, useRef, useState } from 'react';

/** The bar stays while the page is within its own height of the top. */
const SHOWN_NEAR_TOP = 56;
/** A move shorter than this decides nothing: a finger's tremble, a bounce at the end of the page. */
const DECIDES_AFTER = 8;

/**
 * Whether the phone's bar (M1) is out of the way: hidden while the reader scrolls down, back as soon as they scroll up
 * or come near the top. `scroller` is the layout's content area, the one element that scrolls (gotcha 22). A new
 * `resetKey` (the page's address) shows the bar again; with `enabled` false it is always shown. `reveal` brings it back
 * on demand: the keyboard's focus landing in it.
 */
export function useHideOnScroll(scroller: HTMLElement | null, { enabled, resetKey }: { enabled: boolean; resetKey: string }) {
  const [state, setState] = useState({ key: resetKey, hidden: false });
  if (state.key !== resetKey) setState({ key: resetKey, hidden: false });
  const anchor = useRef(0);

  useEffect(() => {
    if (!scroller || !enabled) return;
    anchor.current = scroller.scrollTop;
    const onScroll = () => {
      const top = scroller.scrollTop;
      if (top <= SHOWN_NEAR_TOP) {
        anchor.current = top;
        setState((s) => (s.hidden ? { ...s, hidden: false } : s));
        return;
      }
      const moved = top - anchor.current;
      if (Math.abs(moved) < DECIDES_AFTER) return;
      anchor.current = top;
      const hidden = moved > 0;
      setState((s) => (s.hidden === hidden ? s : { ...s, hidden }));
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [scroller, enabled]);

  const reveal = useCallback(() => setState((s) => (s.hidden ? { ...s, hidden: false } : s)), []);
  return { hidden: enabled && state.key === resetKey && state.hidden, reveal };
}
