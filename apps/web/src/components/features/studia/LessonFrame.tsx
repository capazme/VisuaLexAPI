import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { IconButton } from '../../ui/IconButton';

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
  const course = /^(\/learn\/percorsi\/[^/]+)\/moduli\//.exec(pathname);
  return course ? course[1] : '/learn/ripasso';
}

/**
 * What the frame shows while the session's code loads (the route is lazy): the close button and the card's
 * place, so the screen is never blank with no way out. Esc leaves too. `children` take the card's place: a module's
 * session waiting for the courses' switch says so there.
 */
export function LessonLoading({ children }: { children?: ReactNode }) {
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
        <IconButton size="lg" onClick={() => navigate(home)} aria-label="Chiudi" icon={<X size={20} aria-hidden />} />
        <div aria-hidden className="h-3 flex-1 rounded-full bg-slate-200 dark:bg-slate-800" />
      </div>
      {children && <div className="mx-auto w-full max-w-3xl px-4 py-6">{children}</div>}
      <p className="sr-only">{home === '/learn/ripasso' ? 'Carico il ripasso…' : 'Carico il modulo…'}</p>
    </div>
  );
}

/** Under this, a wait says nothing (LC112): Learn opened by its address came in some 210 ms, «Caricamento…» a flash. */
const LEARN_WAIT_SAID_MS = 300;

/** What Learn shows while its page's code loads: nothing for 300 ms, then «Caricamento…». */
export function LearnLoading() {
  const [said, setSaid] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSaid(true), LEARN_WAIT_SAID_MS);
    return () => clearTimeout(timer);
  }, []);
  return said ? <div className="p-6 text-sm text-slate-500">Caricamento…</div> : null;
}
