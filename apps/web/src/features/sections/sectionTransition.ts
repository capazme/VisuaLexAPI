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
/** The keys that end the change are the change's: they do not also press the switcher they were typed on. */
const KEYS_TAKEN = new Set(['Enter', ' ', 'Escape']);

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Calls `found` with `section`'s title as soon as the new page has it, or gives up after `TITLE_WAIT`. A mutation
 * observer, not animation frames: the browser draws no frame while a View Transition waits for its update.
 *
 * A heading that already said `section` before the swap is not taken at once: the dossier list's says the kind it
 * last listed, so from the Forum it may read `gymnasium` while Gymnasium's own page is on its way. It is taken only if
 * it is still there after `HOLD_MAX` (the page did not change: the same address). Returns the way to stop.
 */
function watchTitle(section: SectionId, found: (title: HTMLElement) => void): { start: () => void; stop: () => void } {
  const selector = titleOf(section);
  const before = new Set(document.querySelectorAll(selector));
  let observer: MutationObserver | null = null;
  let lingering = 0;
  let giveUp = 0;
  const stop = () => {
    observer?.disconnect();
    observer = null;
    window.clearTimeout(lingering);
    window.clearTimeout(giveUp);
  };
  const take = (title: HTMLElement) => {
    stop();
    found(title);
  };
  const look = () => {
    const title = [...document.querySelectorAll<HTMLElement>(selector)].find((el) => !before.has(el));
    if (title) take(title);
    return Boolean(title);
  };
  const start = () => {
    if (look()) return;
    observer = new MutationObserver(() => void look());
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-section-title'] });
    lingering = window.setTimeout(() => {
      const same = document.querySelector<HTMLElement>(selector);
      if (same) take(same);
    }, HOLD_MAX);
    giveUp = window.setTimeout(stop, TITLE_WAIT);
  };
  return { start, stop };
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
 * The section change (T1): the page's content fades out, the new one fades in rising by a few pixels — 240 ms once
 * the new page is there, through the browser's View Transition on `vlx-page` (`index.css`); nothing covers the
 * screen, and a tap goes through to the page. The switcher's mark changes colour and the sidebar's new entries fade
 * in on their own (`SectionSwitcher`, `useEntriesEntrance`). A tap or a key during it brings it to its end. The focus
 * goes to the new page's title. Under reduced motion, or without View Transitions, the page changes at once. Returns
 * the way to finish it.
 */
export function playSectionTransition({ section, swap }: SectionTransition): () => void {
  const leftOn = document.activeElement;

  // Typed as always there; older browsers lack it.
  if (prefersReducedMotion() || typeof document.startViewTransition !== 'function') {
    const title = watchTitle(section, (found) => focusTitleUnlessMoved(found, leftOn));
    swap();
    title.start();
    return title.stop;
  }

  let ended = false;
  let resolveUpdate = () => {};
  const title = watchTitle(section, (found) => {
    resolveUpdate();
    focusTitleUnlessMoved(found, leftOn);
  });
  // The browser keeps the old page's picture until the update settles: settle it when the new title is there. The
  // update runs a frame later, so a change already ended by then only swaps.
  const transition = document.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        swap();
        if (ended) return resolve();
        resolveUpdate = resolve;
        window.setTimeout(resolve, HOLD_MAX);
        title.start();
      }),
  );

  /** A tap or a key: the change is over at once. The keys that end it are its own: they do not press the switcher again. */
  const finish = (event?: Event) => {
    if (event instanceof KeyboardEvent && KEYS_TAKEN.has(event.key)) {
      event.preventDefault();
      event.stopPropagation();
    }
    transition.skipTransition();
  };
  const end = () => {
    window.removeEventListener('pointerdown', finish, true);
    window.removeEventListener('keydown', finish, true);
  };
  window.addEventListener('pointerdown', finish, true);
  window.addEventListener('keydown', finish, true);
  transition.finished.then(end, end);
  // A change ended before it drew rejects these: nothing to report.
  transition.ready.catch(() => {});
  transition.updateCallbackDone.catch(() => {});

  return () => {
    ended = true;
    finish();
    end();
    title.stop();
  };
}
