import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { ISLAND_OPEN } from '../../lib/motion';
import { prefersReducedMotion } from '../../features/sections/sectionTransition';

/** How far the coming page travels: a nudge, not a whole screen. */
const SHIFT = 24;

export interface PageSlideProps {
  /** The page shown, usually the route's path: a new key is a new page. */
  pageKey: string;
  /** Going back (LC84, leaving Impostazioni): the same movement the other way, the page coming from the left. */
  back?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * «Una pagina vera» (LC77, the plan's third form): the leaving page goes at once and the new one comes in sliding from
 * the right, on the island's opening (`ISLAND_OPEN`); never two pages on screen (LC127, the rule of #573). Under reduced
 * motion only the fade; without Web Animations the page changes at once. The page is mounted anew on a new key, so a
 * `PageFade` inside it starts there and plays nothing: one movement per change (LC126).
 */
export function PageSlide({ pageKey, back = false, className, children }: PageSlideProps) {
  const ref = useRef<HTMLDivElement>(null);
  // The key last moved in: a commit with the same key (StrictMode's second run, a new child) plays nothing.
  const shown = useRef(pageKey);

  useLayoutEffect(() => {
    if (shown.current === pageKey) return undefined;
    shown.current = pageKey;
    const place = ref.current;
    if (!place || typeof place.animate !== 'function') return undefined;
    const still = prefersReducedMotion();
    const coming = place.animate(
      [{ opacity: 0, transform: still ? 'none' : `translateX(${(back ? -1 : 1) * SHIFT}px)` }, { opacity: 1, transform: 'none' }],
      ISLAND_OPEN,
    );
    return () => coming.cancel();
    // `back` is read with the key that brought it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey]);

  return (
    <div className={cn('relative grid', className)}>
      <div ref={ref} key={pageKey} className="[grid-area:1/1] min-w-0">
        {children}
      </div>
    </div>
  );
}
