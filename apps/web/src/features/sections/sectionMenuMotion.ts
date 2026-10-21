import { ease } from '../../lib/motion';
import { prefersReducedMotion } from './sectionTransition';

/**
 * The split button's motions (S6), inspired by Animorio's «pulsante diviso», written from scratch on the Web
 * Animations API. Each is a contour of the change, never a wait: the page changes on the click, and the menu goes
 * after it. Under reduced motion none plays (the callers draw the end at once), and where the API is missing (a test's
 * DOM) neither.
 */
export const SECTION_MENU_MS = {
  /** The menu unrolls from the top, and the arrow turns, in this time. */
  open: 260,
  /** Between one entry's entrance and the next. */
  stagger: 40,
  /** One entry's entrance: it fades in rising by 4 px. */
  entry: 180,
  /** The check slides to the entry chosen. */
  check: 180,
  /** After a choice the menu waits this long, the time to see the check arrive, then closes. */
  closeAfter: 200,
  /** The menu rolls back up. */
  close: 180,
  /** The button's name rolls to the new one, and the button takes the new name's width. */
  name: 220,
} as const;

/** `--ease-out` (`index.css`, mirrored in `lib/motion.ts`), a strong ease-out close to expo.out. */
const EASE_OUT = `cubic-bezier(${ease.out.join(', ')})`;

/**
 * The menu's clip, open and closed: the same four lengths, so the browser interpolates them (a `none` at either end
 * would snap). Open, it reaches past the menu's edges far enough to keep its shadow (the theme's `shadow-lg`, 0 12px
 * 32px -8px: 12 px above, 24 at the sides, 36 below), so nothing jumps when the clip is let go; closed, its bottom
 * edge is the menu's top.
 */
const CLIP_OPEN = 'inset(-12px -24px -36px -24px)';
const CLIP_SHUT = 'inset(0px -24px 100% -24px)';

export function canAnimate(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && typeof element.animate === 'function' && !prefersReducedMotion();
}

/**
 * The menu unrolls from the top, growing from 0.97; its entries come in one after the other, and the check with the
 * entry it sits on (`checkedAt`, its index), or it would float over a row still empty.
 */
export function unrollMenu(menu: HTMLElement, entries: HTMLElement[], check?: HTMLElement | null, checkedAt = 0) {
  if (!canAnimate(menu)) return;
  menu.animate(
    [
      { clipPath: CLIP_SHUT, transform: 'scale(0.97)' },
      { clipPath: CLIP_OPEN, transform: 'scale(1)' },
    ],
    { duration: SECTION_MENU_MS.open, easing: EASE_OUT },
  );
  const entrance = (index: number) => ({ duration: SECTION_MENU_MS.entry, delay: index * SECTION_MENU_MS.stagger, easing: EASE_OUT, fill: 'backwards' as const });
  entries.forEach((entry, index) => entry.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], entrance(index)));
  check?.animate([{ opacity: 0 }, { opacity: 1 }], entrance(checkedAt));
}

/** A roll-up on its way: a new opening turns it back, from where it is drawn, and `done` is then never called. */
export interface RollingUp {
  turnBack: () => void;
}

/** The menu rolls back up; `done` once it is out of sight (at once without the motion). */
export function rollUpMenu(menu: HTMLElement | null, done: () => void): RollingUp | null {
  if (!canAnimate(menu)) {
    done();
    return null;
  }
  const animation = menu.animate(
    [
      { clipPath: CLIP_OPEN, transform: 'scale(1)' },
      { clipPath: CLIP_SHUT, transform: 'scale(0.97)' },
    ],
    { duration: SECTION_MENU_MS.close, easing: EASE_OUT, fill: 'forwards' },
  );
  animation.addEventListener('finish', done, { once: true });
  return {
    turnBack: () => {
      animation.removeEventListener('finish', done);
      // Back to open, then let go: the open state is the menu's own style.
      animation.addEventListener('finish', () => animation.cancel(), { once: true });
      animation.reverse();
    },
  };
}

/** The check slides from where it was to `to` (a `translateY`, px); the first placement does not move. */
export function slideCheck(check: HTMLElement, from: number | null, to: number) {
  check.style.transform = `translateY(${to}px)`;
  if (from === null || from === to || !canAnimate(check)) return;
  check.animate([{ transform: `translateY(${from}px)` }, { transform: `translateY(${to}px)` }], {
    duration: SECTION_MENU_MS.check,
    easing: EASE_OUT,
  });
}

/**
 * The name rolls: the old one rises and goes, the new one comes from below, and the box passes from the old width to
 * the new one. `done` when it is over (at once without the motion).
 */
export function rollName(box: HTMLElement, leaving: HTMLElement | null, coming: HTMLElement, fromWidth: number, done: () => void) {
  if (!leaving || !canAnimate(box)) return done();
  const timing = { duration: SECTION_MENU_MS.name, easing: EASE_OUT };
  box.animate([{ width: `${fromWidth}px` }, { width: `${coming.offsetWidth}px` }], timing);
  coming.animate([{ opacity: 0, transform: 'translateY(100%)' }, { opacity: 1, transform: 'none' }], timing);
  const out = leaving.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-100%)' }], { ...timing, fill: 'forwards' });
  out.finished.then(done, done);
}
