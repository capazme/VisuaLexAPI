import { useEffect, type ReactNode, type RefObject } from 'react';
import { FloatingFocusManager, FloatingPortal, useFloating, useInteractions, useRole } from '@floating-ui/react';
import { motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { Z_INDEX } from '../../constants/zIndex';
import { dur, ease } from '../../lib/motion';
import { cn } from '../../lib/utils';

export interface SheetProps {
  title: string;
  onClose: () => void;
  /** Where focus goes when the sheet opens; the first control when absent. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Esc closes it. Off by default: a form must not lose what was typed to a stray key. */
  closeOnEscape?: boolean;
  /** A press on the backdrop closes it. Off by default, for the same reason; a preview, which holds nothing typed, turns it on. */
  closeOnBackdrop?: boolean;
  /** Classes for the sheet (a capped width centred on a computer). */
  className?: string;
  children: ReactNode;
}

/**
 * A phone's bottom sheet, after `AddToDossierPopover`'s: a backdrop, the sheet, the focus kept
 * inside. It is not `aria-modal`, so it carries `data-find-overlay`: Cmd/Ctrl+F is left to the
 * browser while it covers the workspace. A press outside dismisses it only with `closeOnBackdrop`:
 * otherwise closing is the X (or Esc, when allowed) and what the content offers.
 */
export function Sheet({ title, onClose, initialFocusRef, closeOnEscape = false, closeOnBackdrop = false, className, children }: SheetProps) {
  const { refs, context } = useFloating({ open: true });
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([role]);
  // `Modal`'s timing (spec §6.2), rising from the edge it lives on; under reduced motion a fade.
  const still = useReducedMotion();
  const panel = { duration: dur.panel, ease: ease.drawer };

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
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={panel}
        className={cn('fixed inset-0 bg-ink-950/40', Z_INDEX.modal)}
        aria-hidden
        onClick={closeOnBackdrop ? onClose : undefined}
      />
      <FloatingFocusManager context={context} modal initialFocus={initialFocusRef ?? 0}>
        <motion.div
          // eslint-disable-next-line react-hooks/refs -- floating-ui exposes a stable setter, not a ref.current read
          ref={refs.setFloating}
          {...getFloatingProps()}
          initial={still ? { opacity: 0 } : { transform: 'translateY(100%)' }}
          animate={still ? { opacity: 1 } : { transform: 'translateY(0%)' }}
          transition={panel}
          aria-label={title}
          data-find-overlay=""
          className={cn(
            'fixed inset-x-0 bottom-0 flex max-h-[92vh] flex-col rounded-t-2xl border border-b-0',
            'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
            Z_INDEX.modal,
            className,
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
        </motion.div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
