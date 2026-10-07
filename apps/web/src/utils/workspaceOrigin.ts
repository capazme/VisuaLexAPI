/** Where a workspace tab's (0, 0) is on screen. The tab panels are `position: fixed` with no
 *  `top`/`left`, so a tab's x/y are offsets from the static position of the results area, not
 *  from the viewport corner; every saved tab uses that meaning. Absent (tests, phone): the
 *  viewport corner. */
export const WORKSPACE_AREA_ID = 'tour-results-area';

export function workspaceOrigin(): { left: number; top: number; width: number } {
  const el = typeof document === 'undefined' ? null : document.getElementById(WORKSPACE_AREA_ID);
  if (el) {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width };
  }
  return { left: 0, top: 0, width: typeof window === 'undefined' ? 1280 : window.innerWidth };
}

/** Drag limits for a tab whose (0, 0) is at `origin` on screen: the top edge never above the
 *  viewport, and at least `minVisible` pixels of the tab inside it on every other side. */
export function dragLimits(
  origin: { left: number; top: number },
  viewport: { width: number; height: number },
  tabWidth: number,
  minVisible: number,
) {
  return {
    left: minVisible - tabWidth - origin.left,
    top: 0 - origin.top,
    right: viewport.width - minVisible - origin.left,
    bottom: viewport.height - minVisible - origin.top,
  };
}
