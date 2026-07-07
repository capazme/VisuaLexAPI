import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, X } from 'lucide-react';

/**
 * Mobile (<768px) presentation for the deliberation column (Wave 2, review
 * "mobile dead-end"): below `md` the page wraps the docked column in
 * `hidden md:block`, so asking was possible but the answers were unreachable.
 * This gives the SAME column content the side-rail's bottom-sheet treatment
 * (useRailPresentation §3.4): closed → a floating "Dibattito" trigger pill
 * carrying the Wave-1 pulse badge; open → scrim + ~55vh sheet. Rendered
 * through a PORTAL to document.body: `display:none` on the page wrapper would
 * swallow even fixed-position descendants.
 */
export interface MobileDeliberationSheetProps {
  /** Wave-1 badge from the page (a turn settled while the Nodo tab was active). */
  badge: boolean;
  /**
   * Count of settled turns: a settle while the sheet is CLOSED pulses the pill
   * even when the page-level badge stays off (on mobile "closed sheet" is the
   * unseen state, not the Nodo tab).
   */
  settledCount: number;
  /** Notified when the sheet opens (the page clears the Dibattito badge). */
  onOpen?: () => void;
  children: React.ReactNode;
}

export function MobileDeliberationSheet({
  badge,
  settledCount,
  onOpen,
  children,
}: MobileDeliberationSheetProps): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  // Derived during render (react-hooks/set-state-in-effect): when the settled
  // count grows while the sheet is closed, light the pill badge. Same tracker
  // pattern as the page's dibattitoBadge.
  const [seenSettled, setSeenSettled] = useState(settledCount);
  const [pillBadge, setPillBadge] = useState(false);
  if (settledCount !== seenSettled) {
    setSeenSettled(settledCount);
    if (settledCount > seenSettled && !open) setPillBadge(true);
  }

  // Esc dismisses the sheet — parity with the scrim tap.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const handleOpen = (): void => {
    setOpen(true);
    setPillBadge(false);
    onOpen?.();
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    open ? (
      <>
        <button
          type="button"
          aria-label="Chiudi dibattito"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px] transition-opacity duration-200"
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Dibattito sul grafo"
          className="fixed inset-x-0 bottom-0 z-50 flex h-[55vh] flex-col rounded-t-2xl border-t border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="relative flex shrink-0 items-center justify-center px-3 pt-2 pb-1">
            <span className="h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-600" aria-hidden="true" />
            <button
              type="button"
              aria-label="Chiudi"
              onClick={() => setOpen(false)}
              className="absolute right-2 top-1.5 rounded p-1 text-slate-400 transition-colors hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:text-slate-200"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </div>
      </>
    ) : (
      <button
        type="button"
        onClick={handleOpen}
        className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-primary-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
      >
        <MessageSquare size={16} aria-hidden="true" />
        Dibattito
        {(badge || pillBadge) && (
          <span className="relative flex h-2 w-2">
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/80"
              aria-hidden="true"
            />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-white" aria-hidden="true" />
            <span className="sr-only">nuova risposta</span>
          </span>
        )}
      </button>
    ),
    document.body,
  );
}
