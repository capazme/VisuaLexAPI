/** The id of the results area: the practice's table and the windows beside it are laid out in it. */
export const WORKSPACE_AREA_ID = 'tour-results-area';

/** The results area's rectangle (what the find window and the row of windows are placed against).
 *  Absent (tests, phone): the viewport corner. */
export function workspaceOrigin(): { left: number; top: number; width: number } {
  const el = typeof document === 'undefined' ? null : document.getElementById(WORKSPACE_AREA_ID);
  if (el) {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width };
  }
  return { left: 0, top: 0, width: typeof window === 'undefined' ? 1280 : window.innerWidth };
}
