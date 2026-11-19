import { scrollParentOf } from './scrollParent';

/** The band of the screen where the text is seen: its scroller's (or the window's), less the fixed bars. */
export interface View {
  top: number;
  bottom: number;
}

/**
 * The view an element is read in, measured now: its scroller (or the window), less its `scroll-padding` (`Layout` gives
 * the phone's top bar its own), less every sticky or fixed bar found over the text's column at the top and at the foot
 * (the reader's own toolbar, «In vigore dal…»: Papiniano on #717, 390×300), one under the other.
 */
export function viewOf(el: HTMLElement): View {
  const scroller = scrollParentOf(el);
  const style = getComputedStyle(scroller ?? document.documentElement);
  const pad = (value: string) => parseFloat(value) || 0;
  const box = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  let top = box.top + pad(style.scrollPaddingTop);
  let bottom = box.bottom - pad(style.scrollPaddingBottom);
  const column = el.getBoundingClientRect();
  const x = column.left + column.width / 2;
  // A few bars at most, stacked: each found moves the edge past it, and the next is looked for there.
  for (let i = 0; i < 4; i += 1) {
    const bar = barAt(x, top + 1, el);
    const edge = bar?.getBoundingClientRect().bottom ?? top;
    if (edge <= top) break;
    top = edge;
  }
  for (let i = 0; i < 4; i += 1) {
    const bar = barAt(x, bottom - 1, el);
    const edge = bar?.getBoundingClientRect().top ?? bottom;
    if (edge >= bottom) break;
    bottom = edge;
  }
  return { top, bottom: Math.max(top, bottom) };
}

/** The sticky or fixed element drawn at a point over the text, or null where the text itself (or nothing) is there. */
function barAt(x: number, y: number, text: HTMLElement): HTMLElement | null {
  const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
  if (!hit || text.contains(hit) || hit.closest('[data-reader-slot]')) return null;
  for (let at: Element | null = hit; at && at !== document.body; at = at.parentElement) {
    // What holds the text (a column that sticks as a whole) is not a bar over it.
    if (at.contains(text)) return null;
    const { position } = getComputedStyle(at);
    if (position === 'sticky' || position === 'fixed') return at as HTMLElement;
  }
  return null;
}

/**
 * About how tall a selection's space is: its title line and its buttons, wrapped on a phone.
 * shortcut: an estimate, not a measure (the space is not drawn yet when the place is chosen); measure it if the actions grow.
 */
export const SPACE_ESTIMATE = 180;

/**
 * Whether a selection's actions open under its paragraph (LC142, Luca's option A): when the selected words and the space
 * after the paragraph's end fit in the view together. Otherwise they grow from the words as an island (L-74): a long
 * paragraph, or a low window.
 */
export function opensUnder(paragraphBottom: number, wordsTop: number, view: View, space = SPACE_ESTIMATE): boolean {
  return paragraphBottom - wordsTop + space <= view.bottom - view.top;
}

/**
 * How far to scroll to bring a space opened under the words into view without taking the words out of it: at most what
 * the words have above them, so they stay at the top of the view at worst. Zero when the space is in view already.
 */
export function revealBy(spaceBottom: number, wordsTop: number, view: View): number {
  const need = spaceBottom - view.bottom;
  if (need <= 0) return 0;
  return Math.max(0, Math.min(need, wordsTop - view.top));
}

/** Scrolls an element's scroller (or the window) by `by` pixels, at once. */
export function scrollViewBy(el: HTMLElement, by: number): void {
  if (by <= 0) return;
  const scroller = scrollParentOf(el);
  if (scroller) scroller.scrollBy({ top: by, behavior: 'auto' });
  else window.scrollBy({ top: by, behavior: 'auto' });
}
