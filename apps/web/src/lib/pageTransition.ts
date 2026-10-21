/**
 * `vlx-page` (the layout's content area) takes its View Transition name only while a transition runs: a name makes
 * its element a stacking context (gotcha 22), and at rest that would put the content's own overlays under the
 * layout's floating buttons and search bar. `index.css` names it under this class on the root.
 */
export const PAGE_CHANGING = 'vlx-page-changing';

/** How many page transitions are running: the class goes when the last one ends. */
let running = 0;

/** Whether the browser has View Transitions (typed as always there; older browsers lack it). */
export function canTransitionPage(): boolean {
  return typeof document.startViewTransition === 'function';
}

/** Starts a View Transition with the content area named for it. The caller checks `canTransitionPage` first. */
export function startPageTransition(update: () => Promise<void> | void): ViewTransition {
  const root = document.documentElement;
  running += 1;
  root.classList.add(PAGE_CHANGING);
  const transition = document.startViewTransition(update);
  const done = () => {
    running = Math.max(0, running - 1);
    if (running === 0) root.classList.remove(PAGE_CHANGING);
  };
  transition.finished.then(done, done);
  return transition;
}
