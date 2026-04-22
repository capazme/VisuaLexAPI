import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

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

  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose, closeOnEscape]);

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
      previouslyFocusedRef.current?.focus?.();
    };
  }, [isOpen, initialFocusRef]);

  const hasHeader = Boolean(title || icon || showCloseButton);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeOnBackdrop ? onClose : undefined}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[1100]"
            aria-hidden="true"
          />

          <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              role={role}
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
              initial={{ opacity: 0, scale: 0.98, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 10 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'w-full pointer-events-auto',
                'bg-white dark:bg-slate-900',
                'rounded-xl shadow-2xl',
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
                        'p-1.5 rounded-lg ml-auto shrink-0',
                        'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300',
                        'hover:bg-slate-100 dark:hover:bg-slate-800',
                        'transition-colors duration-200',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background'
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
                    'bg-slate-50/50 dark:bg-slate-900/50 rounded-b-xl'
                  )}
                >
                  {footer}
                </div>
              )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
