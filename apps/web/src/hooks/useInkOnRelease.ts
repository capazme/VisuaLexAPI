import { useEffect, useRef, type RefObject } from 'react';

/**
 * How long a selection made by touch must stand still before the highlighter takes it (A4): its handles move it with no
 * event the page sees, and taking it as the long press lets go would take one word only.
 */
export const TOUCH_SETTLE_MS = 700;

/**
 * With the highlighter on (`active`), the words selected in `containerRef` as the selection is released: at a mouse's
 * (or a pen's) `mouseup`, or — begun by a finger — once the finger has lifted and the selection has stood still for
 * `TOUCH_SETTLE_MS` (a finger still on the glass, holding a long press or a handle, keeps it waiting). A press that
 * selects nothing (a click on a link, a sign) is not a selection and goes its own way.
 */
export function useInkOnRelease(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  onRelease: (selection: Selection) => void,
) {
  const latest = useRef(onRelease);
  useEffect(() => {
    latest.current = onRelease;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;
    let touch = false;
    let fingerDown = false;
    let timer = 0;
    const take = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !selection.toString().trim()) return;
      if (!container.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
      latest.current(selection);
    };
    const onPointerDown = (event: PointerEvent) => {
      touch = event.pointerType === 'touch';
      window.clearTimeout(timer);
    };
    // A beat after the release, as the selection bar does: the selection is final then.
    const onMouseUp = (event: MouseEvent) => {
      if (touch || event.button !== 0) return;
      window.setTimeout(take, 10);
    };
    const settle = () => {
      if (fingerDown) timer = window.setTimeout(settle, TOUCH_SETTLE_MS);
      else take();
    };
    const restart = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, TOUCH_SETTLE_MS);
    };
    const onSelectionChange = () => {
      if (touch) restart();
    };
    const onTouchStart = () => {
      fingerDown = true;
    };
    // The last finger lifted: the wait starts again from here.
    const onTouchEnd = (event: TouchEvent) => {
      if ((event.touches?.length ?? 0) > 0) return;
      fingerDown = false;
      if (touch) restart();
    };
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchend', onTouchEnd);
    document.addEventListener('touchcancel', onTouchEnd);
    return () => {
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchEnd);
      window.clearTimeout(timer);
    };
  }, [containerRef, active]);
}
