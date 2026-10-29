import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { FOCUS_RING } from './progress/tokens';

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A dialog or sheet over the lesson keeps its own focus. */
const coveredByOverlay = () => document.querySelector('[aria-modal="true"], [data-find-overlay]') !== null;

/**
 * The lesson's frame (Gymnasium spec §5.4): the review session as a screen of its own, over the shell.
 * The shell's Focus mode is a saved setting that leaves its own button and the feedback button on
 * screen, so the frame does not use it: it is portalled to the body (a fixed layer
 * inside the page would be held by `<main>`'s stacking context, gotchas 22 and 26) in the `lesson`
 * band, over the sidebar and the floating buttons, under the overlay band. `Layout` is not touched.
 *
 * The shell behind stays in the document, so Tab is kept inside the frame: past its last control it
 * comes back to the first, before the first to the last, and a Tab from the shell (`#root`) or the body
 * enters it. A dialog or sheet open over it, and a popover portalled to the body, keep their own focus.
 * The shell is not made `inert`: the command palette (⌘K) is drawn inside it, and would be dead.
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
      // Only the shell behind is fenced off: a popover the article portals to the body (a note being typed)
      // keeps its own Tab, or its composer would close on the focus leaving it.
      const shell = document.getElementById('root');
      const inShell = active === null || active === document.body || (shell !== null && active instanceof Node && shell.contains(active));
      if (!inside && !inShell) return;
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

/** Where a lesson loading goes back to: a course's module to its course, the review to Oggi. */
function lessonHome(pathname: string): string {
  const course = /^(\/studia\/percorsi\/[^/]+)\/moduli\//.exec(pathname);
  return course ? course[1] : '/studia/ripasso';
}

/**
 * What the frame shows while the session's code loads (the route is lazy): the close button and the card's
 * place, so the screen is never blank with no way out. Esc leaves too.
 */
export function LessonLoading() {
  const navigate = useNavigate();
  const home = lessonHome(useLocation().pathname);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') navigate(home);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [navigate, home]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={() => navigate(home)}
          aria-label="Chiudi"
          className={cn('inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-600 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800', FOCUS_RING)}
        >
          <X size={20} aria-hidden />
        </button>
        <div aria-hidden className="h-3 flex-1 rounded-full bg-slate-200 dark:bg-slate-800" />
      </div>
      <p className="sr-only">{home === '/studia/ripasso' ? 'Carico il ripasso…' : 'Carico il modulo…'}</p>
    </div>
  );
}
