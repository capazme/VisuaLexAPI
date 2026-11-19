import { useEffect, useRef, type RefObject } from 'react';

const SPACE_OPENED = 'vlx-space-opened';

/**
 * One space at a time in a text: an opening says so, and the others open in the same text close (`rootRef` holds them).
 * `el` names this one: a `BlockSpace`'s element, or the selection's island.
 */
export function useOneSpaceAtATime(open: boolean, rootRef: RefObject<HTMLElement | null>, el: HTMLElement | null, onClose: () => void) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    if (!open || !el) return undefined;
    document.dispatchEvent(new CustomEvent(SPACE_OPENED, { detail: el }));
    const onOther = (event: Event) => {
      const other = (event as CustomEvent<HTMLElement>).detail;
      if (other !== el && rootRef.current?.contains(other)) closeRef.current();
    };
    document.addEventListener(SPACE_OPENED, onOther);
    return () => document.removeEventListener(SPACE_OPENED, onOther);
  }, [open, rootRef, el]);
}

/** Focuses an element of the text (a paragraph takes `tabindex="-1"` for it), without scrolling; returns it. */
export function focusOn(to: HTMLElement | null): HTMLElement | null {
  if (!to) return null;
  if (!to.hasAttribute('tabindex')) to.setAttribute('tabindex', '-1');
  to.focus({ preventScroll: true });
  return to;
}
