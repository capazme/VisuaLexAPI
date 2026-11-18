import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { PageSlide } from '../ui/PageSlide';
import { focusLanding } from '../../utils/focusPage';
import { AtLocation } from './AtLocation';

export interface ViewSlideProps {
  /** The view shown (LC98): a new one slides in. Not the address: a card opened inside «Le mie schede» is the same view. */
  view: string;
  /** The section's views in their order (its tabs, its sidebar's entries): one before the last comes from the left. */
  order: readonly string[];
  className?: string;
  /** What a route shows: `useOutlet()`, never `<Outlet/>`, which would draw the coming view in the leaving one too. */
  children: ReactNode;
}

/**
 * A change of view inside a section's page (LC98: Pratiche's list, dossier and trash, Learn's and Opus's views): the
 * movement of `PageSlide` — the same 24 px, `ISLAND_OPEN` in and `ISLAND_CLOSE` out, only the fade under reduced
 * motion —, toward the left for a view further along `order`, the other way for one before it. The leaving view keeps
 * the address it was drawn at. Then the focus lands on the page's title (`data-page-title`), unless the coming view
 * took it itself; not when the page first draws.
 */
export function ViewSlide({ view, order, className, children }: ViewSlideProps) {
  const location = useLocation();
  // The view shown and the way it came, set as the view changes (as `PageSlide` keeps its pages).
  const [shown, setShown] = useState({ view, back: false });
  if (shown.view !== view) setShown({ view, back: order.indexOf(view) < order.indexOf(shown.view) });
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
      <PageSlide pageKey={view} back={shown.back} className={className}>
        <AtLocation location={location}>{children}</AtLocation>
      </PageSlide>
    </div>
  );
}
