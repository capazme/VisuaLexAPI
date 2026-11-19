import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { PAGE_CHANGING } from '../../lib/pageTransition';
import { prefersReducedMotion } from '../../features/sections/sectionTransition';
import { pageFade } from './pageChange';

/**
 * A change of page (LC126): the one place every page change through the router passes — the sidebar's entries, the
 * phone's drawer, ⌘K, a link, Back. The leaving page goes at once and the coming one fades in rising by 5 px, in the
 * content area alone; nothing is drawn twice. The levels above and below keep theirs, one movement per change: a section
 * change has its View Transition (`PAGE_CHANGING` while it runs), Impostazioni and Amministrazione `PageSlide` (which
 * mounts this anew, so it plays nothing), a view inside a page `ViewSlide` (the same page key). The focus is not this
 * layer's: the callers' `focusLanding` gives it, and the page is never mounted again.
 */
export function PageFade({ pageKey, children }: { pageKey: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef(pageKey);

  useLayoutEffect(() => {
    if (shown.current === pageKey) return undefined;
    shown.current = pageKey;
    const place = ref.current;
    if (!place || typeof place.animate !== 'function') return undefined;
    if (document.documentElement.classList.contains(PAGE_CHANGING)) return undefined;
    const { keyframes, timing } = pageFade(prefersReducedMotion());
    const fade = place.animate(keyframes, timing);
    return () => fade.cancel();
  }, [pageKey]);

  return (
    <div ref={ref} data-page-place>
      {children}
    </div>
  );
}
