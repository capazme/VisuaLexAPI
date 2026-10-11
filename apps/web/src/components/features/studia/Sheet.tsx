import { useEffect, type ReactNode, type RefObject } from 'react';
import { FloatingFocusManager, FloatingPortal, useFloating, useInteractions, useRole } from '@floating-ui/react';
import { X } from 'lucide-react';
import { Z_INDEX } from '../../../constants/zIndex';
import { cn } from '../../../lib/utils';

export interface SheetProps {
  title: string;
  onClose: () => void;
  /** Where focus goes when the sheet opens; the first control when absent. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Esc closes it. Off by default: a form must not lose what was typed to a stray key. */
  closeOnEscape?: boolean;
  children: ReactNode;
}

/**
 * A phone's bottom sheet, after `AddToDossierPopover`'s: a backdrop, the sheet, the focus kept
 * inside. It is not `aria-modal`, so it carries `data-find-overlay`: Cmd/Ctrl+F is left to the
 * browser while it covers the workspace. A press outside never dismisses it: closing is the X (or
 * Esc, when allowed) and what the content offers.
 */
export function Sheet({ title, onClose, initialFocusRef, closeOnEscape = false, children }: SheetProps) {
  const { refs, context } = useFloating({ open: true });
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([role]);

  // The page behind does not scroll under the sheet, as under `Modal`.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  useEffect(() => {
    if (!closeOnEscape) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeOnEscape, onClose]);

  return (
    <FloatingPortal>
      <div className={cn('fixed inset-0 bg-slate-900/40 motion-safe:animate-in motion-safe:fade-in duration-150', Z_INDEX.modal)} aria-hidden />
      <FloatingFocusManager context={context} modal initialFocus={initialFocusRef ?? 0}>
        <div
          // eslint-disable-next-line react-hooks/refs -- floating-ui exposes a stable setter, not a ref.current read
          ref={refs.setFloating}
          {...getFloatingProps()}
          aria-label={title}
          data-find-overlay=""
          className={cn(
            'fixed inset-x-0 bottom-0 flex max-h-[92vh] flex-col rounded-t-2xl border border-b-0',
            'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
            'motion-safe:animate-in motion-safe:slide-in-from-bottom duration-200',
            Z_INDEX.modal,
          )}
        >
          <header className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-2 dark:border-slate-800">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Chiudi"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </header>
          {children}
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
