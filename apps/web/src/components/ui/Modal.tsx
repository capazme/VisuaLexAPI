import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Z_INDEX } from '../../constants/zIndex';
import { dur, ease } from '../../lib/motion';

export type ModalVariant = 'default' | 'danger' | 'info' | 'success';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  icon?: ReactNode;
  variant?: ModalVariant;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  role?: 'dialog' | 'alertdialog';
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Called as the dialog closes when what had the focus before it opened is no longer on the page (the toast that
   *  opened it has gone), to put the focus somewhere: without it the focus falls to the body. */
  onReturnFocusLost?: () => void;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
  className?: string;
  contentClassName?: string;
  children?: ReactNode;
}

const sizeStyles: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-full m-4',
};

const variantIconStyles: Record<ModalVariant, string> = {
  default: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
  danger: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
  info: 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400',
  success: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
};

// Open modals, oldest first. Each one registers its Tab trap and Esc handler on
// `document`; with a dialog opened from another dialog, only the last one opened
// may act, or the parent would pull the focus back from its child.
const openModals: symbol[] = [];

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  icon,
  variant = 'default',
  size = 'md',
  role = 'dialog',
  footer,
  initialFocusRef,
  onReturnFocusLost,
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = true,
  className,
  contentClassName,
  children,
}: ModalProps) {
  const reactId = useId();
  const titleId = title ? `modal-title-${reactId}` : undefined;
  const descriptionId = description ? `modal-desc-${reactId}` : undefined;
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onReturnFocusLostRef = useRef(onReturnFocusLost);
  useEffect(() => {
    onReturnFocusLostRef.current = onReturnFocusLost;
  });
  const dialogRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef<symbol>(Symbol('modal'));
  // Spec §6.2: 240 ms on the drawer curve, growing from 0.97 where it stands; under reduced motion a fade.
  const still = useReducedMotion();
  const hidden = still ? { opacity: 0 } : { opacity: 0, scale: 0.97 };
  const panel = { duration: dur.panel, ease: ease.drawer };

  useEffect(() => {
    if (!isOpen) return;
    const token = tokenRef.current;
    openModals.push(token);
    return () => {
      const at = openModals.indexOf(token);
      if (at !== -1) openModals.splice(at, 1);
    };
  }, [isOpen]);

  const isTopmost = () => openModals[openModals.length - 1] === tokenRef.current;

  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;
    const handleEscape = (e: KeyboardEvent) => {
      // An Esc something inside already took (a menu closing, an edit cancelled) is not the dialog's.
      if (e.key === 'Escape' && !e.defaultPrevented && isTopmost()) onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose, closeOnEscape]);

  useEffect(() => {
    if (!isOpen) return;
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !isTopmost()) return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
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
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => {
      const target = initialFocusRef?.current ?? closeButtonRef.current;
      target?.focus();
    }, 50);
    return () => {
      window.clearTimeout(timer);
      const previous = previouslyFocusedRef.current;
      if (previous?.isConnected) previous.focus?.();
      else onReturnFocusLostRef.current?.();
    };
  }, [isOpen, initialFocusRef]);

  const hasHeader = Boolean(title || icon || showCloseButton);

  // Portaled: inside a reading window (transformed, stacked) the dialog would be
  // confined to it, with the dock or another window above.
  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={panel}
            onClick={closeOnBackdrop ? onClose : undefined}
            className={cn('fixed inset-0 bg-ink-950/40', Z_INDEX.modal)}
            aria-hidden="true"
          />

          <div className={cn('fixed inset-0 flex items-center justify-center p-4 pointer-events-none', Z_INDEX.modal)}>
            <motion.div
              ref={dialogRef}
              role={role}
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
              initial={hidden}
              animate={{ opacity: 1, scale: 1 }}
              exit={hidden}
              transition={panel}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'w-full pointer-events-auto',
                'bg-white dark:bg-slate-900',
                'rounded-2xl shadow-2xl',
                'border border-slate-200 dark:border-slate-800',
                'max-h-[90vh] flex flex-col',
                sizeStyles[size],
                className
              )}
            >
              {hasHeader && (
                <div
                  className={cn(
                    'flex items-start gap-4 px-6 py-4 shrink-0',
                    'border-b border-slate-100 dark:border-slate-800'
                  )}
                >
                  {icon && (
                    <div
                      className={cn(
                        'shrink-0 flex items-center justify-center w-10 h-10 rounded-lg',
                        variantIconStyles[variant]
                      )}
                      aria-hidden="true"
                    >
                      {icon}
                    </div>
                  )}

                  {(title || description) && (
                    <div className="flex-1 min-w-0">
                      {title && (
                        <h2
                          id={titleId}
                          className="text-lg font-semibold text-slate-900 dark:text-slate-100"
                        >
                          {title}
                        </h2>
                      )}
                      {description && (
                        <p
                          id={descriptionId}
                          className="mt-1 text-sm text-slate-500 dark:text-slate-400 leading-relaxed"
                        >
                          {description}
                        </p>
                      )}
                    </div>
                  )}

                  {showCloseButton && (
                    <button
                      ref={closeButtonRef}
                      onClick={onClose}
                      aria-label="Chiudi"
                      className={cn(
                        'inline-flex min-h-[44px] min-w-[44px] items-center justify-center md:min-h-0 md:min-w-0 p-1.5 rounded-lg ml-auto shrink-0',
                        'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300',
                        'hover:bg-slate-100 dark:hover:bg-slate-800',
                        'transition-colors duration-150',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-toga-500 focus-visible:ring-offset-2 ring-offset-background'
                      )}
                    >
                      <X size={20} />
                    </button>
                  )}
                </div>
              )}

              {children != null && children !== false && (
                <div className={cn('flex-1 overflow-y-auto p-6', contentClassName)}>
                  {children}
                </div>
              )}

              {footer && (
                <div
                  className={cn(
                    'flex items-center justify-end gap-3 px-6 py-4 shrink-0',
                    'border-t border-slate-100 dark:border-slate-800',
                    'bg-slate-50/50 dark:bg-slate-900/50 rounded-b-2xl'
                  )}
                >
                  {footer}
                </div>
              )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
