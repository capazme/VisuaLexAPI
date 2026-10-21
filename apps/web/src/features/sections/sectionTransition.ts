import type { SectionId } from './sections';

/**
 * A section's home marks its heading `data-section-title="<section id>"` (with `tabIndex={-1}`): the focus goes there.
 * The id says whose title it is: the dossier list stays mounted from Gymnasium to Opus, and its heading changes
 * section without changing element.
 */
const titleOf = (section: SectionId) => `[data-section-title="${section}"]`;

/**
 * How long the old page's picture waits for the new page's title (the router renders it in a transition; a lazy
 * page's code may be on its way). Past it the change plays with what is there, and the title takes the focus later.
 */
export const HOLD_MAX = 150;
/** How long the focus waits for the new page's title. */
const TITLE_WAIT = 1500;

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Calls `found` with `section`'s title as soon as it is in the page, or gives up after `TITLE_WAIT`. A mutation
 * observer, not animation frames: the browser draws no frame while a View Transition waits for its update. Returns
 * the way to stop.
 */
function watchTitle(section: SectionId, found: (title: HTMLElement) => void): () => void {
  let observer: MutationObserver | null = null;
  let timer = 0;
  const stop = () => {
    observer?.disconnect();
    observer = null;
    window.clearTimeout(timer);
  };
  const look = () => {
    const title = document.querySelector<HTMLElement>(titleOf(section));
    if (!title) return false;
    stop();
    found(title);
    return true;
  };
  if (!look()) {
    observer = new MutationObserver(() => void look());
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-section-title'] });
    timer = window.setTimeout(stop, TITLE_WAIT);
  }
  return stop;
}

/**
 * The focus goes to the title only if nobody moved it meanwhile: it is still where the choice left it (the switcher)
 * or nowhere. A click into a field, or a Tab, while a lazy page's title was on its way keeps its focus.
 */
function focusTitleUnlessMoved(title: HTMLElement, leftOn: Element | null) {
  const active = document.activeElement;
  if (active === leftOn || active === null || active === document.body) title.focus({ preventScroll: true });
}

export interface SectionTransition {
  /** The section chosen: its home's title is what the change waits for, and what takes the focus. */
  section: SectionId;
  /**
   * Changes the page: called once, at once without a View Transition. The router renders the new page in a
   * transition, so it may come a frame or more later: its title says when it is there.
   */
  swap: () => void;
}

/**
 * The section change (T1): the page's content fades out, the new one fades in rising by a few pixels — 240 ms in all,
 * through the browser's View Transition on `vlx-page` (`index.css`); nothing covers the screen. The switcher's mark
 * changes colour and the sidebar's new entries fade in on their own (`SectionSwitcher`, `useEntriesEntrance`). A tap
 * or a key during it brings it to its end. The focus goes to the new page's title. Under reduced motion, or without
 * View Transitions, the page changes at once. Returns the way to finish it.
 */
export function playSectionTransition({ section, swap }: SectionTransition): () => void {
  const leftOn = document.activeElement;

  // Typed as always there; older browsers lack it.
  if (prefersReducedMotion() || typeof document.startViewTransition !== 'function') {
    swap();
    const stop = watchTitle(section, (title) => focusTitleUnlessMoved(title, leftOn));
    return stop;
  }

  let stopWatching = () => {};
  // The browser keeps the old page's picture until the update settles: settle it when the new title is there.
  const transition = document.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        swap();
        const timer = window.setTimeout(resolve, HOLD_MAX);
        stopWatching = watchTitle(section, (title) => {
          window.clearTimeout(timer);
          resolve();
          focusTitleUnlessMoved(title, leftOn);
        });
      }),
  );

  const finish = () => transition.skipTransition();
  const end = () => {
    window.removeEventListener('pointerdown', finish, true);
    window.removeEventListener('keydown', finish, true);
  };
  window.addEventListener('pointerdown', finish, true);
  window.addEventListener('keydown', finish, true);
  // A skipped transition rejects `finished` only when its update threw; either way the listeners go.
  transition.finished.then(end, end);

  return () => {
    finish();
    end();
    stopWatching();
  };
}
