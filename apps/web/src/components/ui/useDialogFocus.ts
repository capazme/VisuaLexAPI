import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { isTopmostDialog, openDialog } from './dialogStack';

/**
 * A modal dialog's focus (`Modal`, `CompareView`): registered in `dialogStack` while open, Tab kept inside it (past
 * the last control back to the first, before the first to the last), the focus given to `initialFocus()` 50 ms after
 * it opens and back to what had it once it closes. Returns whether this dialog is the top-most one, the one the keys
 * are for: a dialog opened from it keeps its own Tab and Esc.
 */
export function useDialogFocus(
  isOpen: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  initialFocus: () => HTMLElement | null | undefined,
): () => boolean {
  const tokenRef = useRef<symbol>(Symbol('dialog'));
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  // The latest target, read when the timer fires: a new function each render must not reopen the dialog's focus.
  const initialFocusRef = useRef(initialFocus);
  useEffect(() => {
    initialFocusRef.current = initialFocus;
  });

  const isTopmost = useCallback(() => isTopmostDialog(tokenRef.current), []);

  useEffect(() => (isOpen ? openDialog(tokenRef.current) : undefined), [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !isTopmost()) return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const active = document.activeElement;
      // A popover portalled inside the dialog (floating-ui's, the comparison's update note) keeps its own Tab: its guards
      // take the focus back next to its reference, which is inside the dialog too.
      if (active instanceof Element && dialog.contains(active) && active.closest('[data-floating-ui-portal]')) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        // From an element outside the list (the dialog itself, a wrapper focused with tabIndex -1) the browser would
        // step out of the dialog backwards: the last element takes it.
        if (active === first || !focusable.includes(active as HTMLElement)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [isOpen, isTopmost, dialogRef]);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => {
      initialFocusRef.current()?.focus();
    }, 50);
    return () => {
      window.clearTimeout(timer);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [isOpen]);

  return isTopmost;
}
