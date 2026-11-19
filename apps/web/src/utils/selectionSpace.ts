import { scrollParentOf } from './scrollParent';

/** The band of the screen where the text is seen: its scroller's (or the window's), less the fixed bars. */
export interface View {
  top: number;
  bottom: number;
}

/**
 * The view an element is read in. The fixed bars are the scroller's `scroll-padding` (`Layout` gives the phone's top
 * bar its own); with no scroller, the window and the document's.
 */
export function viewOf(el: HTMLElement): View {
  const scroller = scrollParentOf(el);
  const style = getComputedStyle(scroller ?? document.documentElement);
  const pad = (value: string) => parseFloat(value) || 0;
  const box = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  return { top: box.top + pad(style.scrollPaddingTop), bottom: box.bottom - pad(style.scrollPaddingBottom) };
}

/**
 * Whether a selection's actions open under its paragraph (LC142, Luca's option A): when the paragraph ends within about
 * one view of the selected words' end. Further down, they grow from the words as an island (L-74).
 */
export function opensUnder(paragraphBottom: number, wordsBottom: number, view: View): boolean {
  return paragraphBottom - wordsBottom <= view.bottom - view.top;
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
