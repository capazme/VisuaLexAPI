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
