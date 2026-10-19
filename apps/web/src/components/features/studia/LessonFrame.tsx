import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A dialog or sheet over the lesson keeps its own focus. */
const coveredByOverlay = () => document.querySelector('[aria-modal="true"], [data-find-overlay]') !== null;

/**
 * The lesson's frame (Gymnasium spec §5.4): the review session as a screen of its own, over the shell.
 * The shell's Focus mode is a saved setting that leaves its own button, the feedback button and the
 * services pill on screen, so the frame does not use it: it is portalled to the body (a fixed layer
 * inside the page would be held by `<main>`'s stacking context, gotchas 22 and 26) in the `lesson`
 * band, over the sidebar and the floating buttons, under the overlay band. `Layout` is not touched.
 *
 * The shell behind stays in the document, so Tab is kept inside the frame: past its last control it
 * comes back to the first, before the first to the last, and a Tab from outside (the body, after a click
 * on nothing) enters it. A dialog or sheet open over it keeps its own focus.
 */
export function LessonFrame({ children }: { children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const root = frame.current;
      if (event.key !== 'Tab' || !root || coveredByOverlay()) return;
      const tabbable = [...root.querySelectorAll<HTMLElement>(TABBABLE)];
      if (tabbable.length === 0) return;
      const first = tabbable[0];
      const last = tabbable[tabbable.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && root.contains(active);
      if (!inside || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return createPortal(
    <div
      ref={frame}
      data-testid="lesson-frame"
      className={cn('fixed inset-0 flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100', Z_INDEX.lesson)}
    >
      {children}
    </div>,
    document.body,
  );
}
