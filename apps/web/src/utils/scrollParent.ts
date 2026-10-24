/** The nearest ancestor that scrolls: the page's content scroller, or a column or window that scrolls on its own. */
export function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

/**
 * Puts an element in the middle of the scroller it reads in, moving that scroller alone: never through
 * `scrollIntoView`, which moves every ancestor that can scroll — the page and, in the dossier's two columns (D7d), the
 * column beside it (gotcha 34). An element taller than the scroller comes to its top.
 */
export function scrollToMiddle(el: HTMLElement, behavior: ScrollBehavior = 'auto'): void {
  const scroller = scrollParentOf(el);
  if (!scroller) return;
  const box = scroller.getBoundingClientRect();
  const at = el.getBoundingClientRect();
  const offset = Math.max(0, (scroller.clientHeight - at.height) / 2);
  scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + at.top - box.top - offset), behavior });
}
