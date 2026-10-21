import { useCallback, useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '../../hooks/useIsDesktop';

/** The bar stays while the page is within its own height of the top. */
const SHOWN_NEAR_TOP = 56;
/** A move shorter than this decides nothing: a finger's tremble, a bounce at the end of the page. */
const DECIDES_AFTER = 8;

/** Where the bar moves: a phone, below `md`. From `md` it stays, and nothing listens. */
const PHONE = '(max-width: 767.98px)';

/**
 * Whether the phone's bar (M1) is out of the way: hidden while the reader scrolls down, back as soon as they scroll up
 * or come near the top. `scroller` is the layout's content area, the one element that scrolls (gotcha 22); it is
 * listened to only below `md`. A new `resetKey` (the page's address) shows the bar again; with `enabled` false it is
 * always shown. It never hides while the focus is inside `bar` (WCAG 2.4.11), and `reveal` brings it back when the
 * focus lands there.
 */
export function useHideOnScroll(
  scroller: HTMLElement | null,
  { enabled, resetKey, bar }: { enabled: boolean; resetKey: string; bar: HTMLElement | null },
) {
  const [state, setState] = useState({ key: resetKey, hidden: false });
  if (state.key !== resetKey) setState({ key: resetKey, hidden: false });
  const anchor = useRef(0);
  const phone = useMediaQuery(PHONE);
  const active = enabled && phone;

  useEffect(() => {
    if (!scroller || !active) return;
    // iOS bounces past the end: a scroll top held to the last real one, so the bounce back is no move up.
    const position = () => Math.max(0, Math.min(scroller.scrollTop, scroller.scrollHeight - scroller.clientHeight));
    anchor.current = position();
    const onScroll = () => {
      const top = position();
      if (top <= SHOWN_NEAR_TOP) {
        anchor.current = top;
        setState((s) => (s.hidden ? { ...s, hidden: false } : s));
        return;
      }
      const moved = top - anchor.current;
      if (Math.abs(moved) < DECIDES_AFTER) return;
      anchor.current = top;
      const hidden = moved > 0 && !(bar && bar.contains(document.activeElement));
      setState((s) => (s.hidden === hidden ? s : { ...s, hidden }));
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [scroller, active, bar]);

  const reveal = useCallback(() => setState((s) => (s.hidden ? { ...s, hidden: false } : s)), []);
  return { hidden: active && state.key === resetKey && state.hidden, reveal };
}
