import { useEffect } from 'react';

/**
 * Desktop reflow (design §3.4): when the rail is open in `reflow` mode it must
 * NOT overlay the article text — it pushes the reading column aside instead.
 *
 * The reading column lives in a scroll container the rail feature does not own
 * (`Layout` renders `<main><div class="…overflow-y-auto…">`). Rather than reach
 * into Layout, we locate that scroll container from the rail's own DOM position
 * (`anchor.closest('main') → its overflow-y-auto child`) and apply a transitioned
 * `padding-right` imperatively. This keeps the change inside the side-rail files
 * and works even with several `<main>` elements on other routes, because we walk
 * up from THIS rail's anchor. The scroll anchor is preserved (only padding
 * changes; scrollTop is untouched), satisfying the §7 mitigation.
 *
 * Everything is restored on cleanup / when the rail closes or leaves reflow mode.
 */
export function useReflowReadingColumn(
  anchor: HTMLElement | null,
  active: boolean,
  railWidthPx: number,
): void {
  useEffect(() => {
    if (!active || !anchor) return;
    const main = anchor.closest('main');
    const scroller = main?.querySelector<HTMLElement>(':scope > .overflow-y-auto');
    if (!scroller) return;

    const prevPadding = scroller.style.paddingRight;
    const prevTransition = scroller.style.transition;
    scroller.style.transition = 'padding-right 200ms ease';
    scroller.style.paddingRight = `${railWidthPx}px`;

    return () => {
      scroller.style.paddingRight = prevPadding;
      scroller.style.transition = prevTransition;
    };
  }, [anchor, active, railWidthPx]);
}
