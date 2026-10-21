import { canTransitionPage, startPageTransition } from '../../lib/pageTransition';
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
 * it is still there after `HOLD_MAX` (the page did not change: the same address). The browser's Back (or Forward)
 * stops it: the user went elsewhere, and the title of the section they left must not take the focus. Returns the way
 * to start and the way to stop.
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
    window.removeEventListener('popstate', stop);
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
    window.addEventListener('popstate', stop);
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
 * or nowhere. A click into a field, or a Tab, while a lazy page's title was on its way keeps its focus. Chosen with a
 * pointer, the title shows no ring (`data-pointer-focus`, `index.css`) until it loses the focus; from the keyboard it
 * does, so the user sees where the focus went.
 */
function focusTitleUnlessMoved(title: HTMLElement, leftOn: Element | null, byPointer: boolean) {
  const active = document.activeElement;
  // The shell's own parking place is not a move by the user: the phone's drawer, closing over the choice, leaves the
  // focus on the bar's menu button (`data-focus-parked`, M1).
  const parked = active instanceof HTMLElement && active.hasAttribute('data-focus-parked');
  if (active !== leftOn && active !== null && active !== document.body && !parked) return;
  if (byPointer) {
    title.setAttribute('data-pointer-focus', '');
    title.addEventListener('blur', () => title.removeAttribute('data-pointer-focus'), { once: true });
  } else {
    title.removeAttribute('data-pointer-focus');
  }
  title.focus({ preventScroll: true });
  // A title that could not take the focus keeps no mark, or a later focus from the keyboard would show no ring.
  if (document.activeElement !== title) title.removeAttribute('data-pointer-focus');
}

export interface SectionTransition {
  /** The section chosen: its home's title is what the change waits for, and what takes the focus. */
  section: SectionId;
  /**
   * Changes the page: called once, at once without a View Transition. The router renders the new page in a
   * transition, so it may come a frame or more later: its title says when it is there.
   */
  swap: () => void;
  /**
   * No transition of its own: the phone's drawer, which closes over the change, is the transition. The content's
   * picture would be drawn over the drawer and its veil while they slide away.
   */
  still?: boolean;
  /** Chosen with a pointer (a click whose `detail` is not 0): the title takes the focus without its ring. */
  byPointer?: boolean;
}

/**
 * The section change (T1): the page's content fades out, the new one fades in rising by a few pixels — 240 ms once
 * the new page is there, through the browser's View Transition on `vlx-page`, the layout's content area (`index.css`,
 * `lib/pageTransition`); nothing covers the screen, and a tap goes through to the page. The switcher's mark changes
 * colour and the sidebar's new entries fade in on their own (`SectionSwitcher`, `useEntriesEntrance`). A tap or a key
 * during it brings it to its end; the browser's Back drops it, with no swap if the page had not changed yet. The focus
 * goes to the new page's title. Under reduced motion, without View Transitions, or `still`, the page changes at once.
 * Returns the way to finish it.
 */
export function playSectionTransition({ section, swap, still = false, byPointer = false }: SectionTransition): () => void {
  const leftOn = document.activeElement;

  if (still || prefersReducedMotion() || !canTransitionPage()) {
    const title = watchTitle(section, (found) => focusTitleUnlessMoved(found, leftOn, byPointer));
    swap();
    title.start();
    return title.stop;
  }

  /** Ended by the next choice: the update still swaps, and nothing waits for this title. */
  let ended = false;
  /** Ended by Back: the update does not even swap, which would navigate over where the user went. */
  let abandoned = false;
  let resolveUpdate = () => {};
  const title = watchTitle(section, (found) => {
    resolveUpdate();
    focusTitleUnlessMoved(found, leftOn, byPointer);
  });
  // The browser keeps the old page's picture until the update settles: settle it when the new title is there. The
  // update runs a frame later: a change the next choice already ended only swaps, one Back dropped does not.
  const transition = startPageTransition(
    () =>
      new Promise<void>((resolve) => {
        if (abandoned) return resolve();
        swap();
        if (ended) return resolve();
        resolveUpdate = resolve;
        window.setTimeout(resolve, HOLD_MAX);
        title.start();
      }),
  );

  const release = () => {
    window.removeEventListener('pointerdown', finish, true);
    window.removeEventListener('keydown', finish, true);
  };
  /**
   * A tap or a key: the change is over at once, and lets go of the keys. The keys that end it are its own: they do not
   * press the switcher again.
   */
  function finish(event?: Event) {
    if (event instanceof KeyboardEvent && KEYS_TAKEN.has(event.key)) {
      event.preventDefault();
      event.stopPropagation();
    }
    release();
    transition.skipTransition();
  }
  function abandon() {
    abandoned = true;
    finish();
    title.stop();
  }
  window.addEventListener('pointerdown', finish, true);
  window.addEventListener('keydown', finish, true);
  window.addEventListener('popstate', abandon);
  const end = () => {
    release();
    window.removeEventListener('popstate', abandon);
  };
  transition.finished.then(end, end);
  // A change ended before it drew rejects these: nothing to report.
  transition.ready.catch(() => {});
  transition.updateCallbackDone.catch(() => {});

  return () => {
    ended = true;
    finish();
    title.stop();
  };
}
