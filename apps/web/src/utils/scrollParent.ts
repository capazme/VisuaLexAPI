/** The nearest ancestor that scrolls: the page's content scroller, or a column or window that scrolls on its own. */
export function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

/**
 * The nearest ancestor that scrolls and has something to scroll (its content taller than it): a panel or a window
 * set to `overflow-y: auto` whose content fits is passed over, on the way up to the one that moves.
 */
function overflowingParentOf(el: HTMLElement): HTMLElement | null {
  for (let node = scrollParentOf(el); node; node = scrollParentOf(node)) {
    if (node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/**
 * Puts an element in the middle of the scroller it reads in, moving that scroller alone: never through
 * `scrollIntoView`, which moves every ancestor that can scroll — the page and, in the dossier's two columns (D7d), the
 * column beside it (gotcha 34). The scroller is the nearest that has something to scroll; with none, `scrollIntoView`
 * after all, as every reader did before, so a text never stops moving to its passage. An element taller than the
 * scroller comes to its top.
 */
export function scrollToMiddle(el: HTMLElement, behavior: ScrollBehavior = 'auto'): void {
  const scroller = overflowingParentOf(el);
  if (!scroller) {
    el.scrollIntoView({ block: 'center', behavior });
    return;
  }
  const box = scroller.getBoundingClientRect();
  const at = el.getBoundingClientRect();
  const offset = Math.max(0, (scroller.clientHeight - at.height) / 2);
  scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + at.top - box.top - offset), behavior });
}
