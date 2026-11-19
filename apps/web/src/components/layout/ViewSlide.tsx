import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { PageSlide } from '../ui/PageSlide';
import { focusLanding } from '../../utils/focusPage';
import { PLACE_CHANGE, VIEW_SHIFT } from '../../lib/motion';
import { AtLocation } from './AtLocation';
import { pageFade } from './pageChange';

export interface ViewSlideProps {
  /** The view shown (LC98): a new one slides in. Not the address: a card opened inside «Le mie schede» is the same view. */
  view: string;
  /** The section's views in their order (its tabs, its sidebar's entries): one before the last comes from the left. */
  order: readonly string[];
  /** The two views between which it slides sideways, a list and its detail (Pratiche, the Forum's threads); every other change fades as `PageFade`. */
  drill?: readonly [string, string];
  className?: string;
  /** What a route shows: `useOutlet()`, never `<Outlet/>`, which would draw the coming view in the leaving one too. */
  children: ReactNode;
}

/** Between a list and its detail: sideways by `VIEW_SHIFT` px in `PLACE_CHANGE`; only the fade under reduced motion. */
const sideways = (still: boolean, back: boolean) => ({
  keyframes: [{ opacity: 0, transform: still ? 'none' : `translateX(${(back ? -1 : 1) * VIEW_SHIFT}px)` }, { opacity: 1, transform: 'none' }],
  timing: PLACE_CHANGE,
});

/**
 * A change of view inside a section's page (LC98: Pratiche's list, dossier and trash, Learn's and Opus's views), in
 * 180 ms, a change of place under the frequency rule (LC132; it was `PageSlide`'s 24 px in 280 ms). Between a list and
 * its detail (`drill`) the coming view slides in by 12 px, from the right for a view further along `order`, from the
 * left for one before it; every other change (the sidebar's entries) fades in rising by 5 px, as `PageFade`. The leaving
 * view goes at once and keeps the address it was drawn at. Then the focus lands on the page's title
 * (`data-page-title`), unless the coming view took it itself; not when the page first draws.
 */
export function ViewSlide({ view, order, drill, className, children }: ViewSlideProps) {
  const location = useLocation();
  // The view shown, the way it came and whether it slides, set as the view changes (as `PageSlide` keeps its pages).
  const [shown, setShown] = useState({ view, back: false, side: false });
  if (shown.view !== view) {
    setShown({ view, back: order.indexOf(view) < order.indexOf(shown.view), side: Boolean(drill?.includes(view) && drill.includes(shown.view)) });
  }
  const focused = useRef(view);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focused.current === view) return undefined;
    focused.current = view;
    // The view's own effects ran first: a field or a heading it focused keeps the focus.
    const active = document.activeElement;
    if (active && active !== document.body && box.current?.contains(active) && !active.closest('[inert]')) return undefined;
    // A title that already has it (the drawer's entry put it there) keeps it.
    if (active?.matches('main [data-page-title]') && !active.closest('[inert]')) return undefined;
    return focusLanding(false);
  }, [view]);

  return (
    <div ref={box} className="contents">
      <PageSlide pageKey={view} back={shown.back} entrance={shown.side ? sideways : pageFade} className={className}>
        <AtLocation location={location}>{children}</AtLocation>
      </PageSlide>
    </div>
  );
}
