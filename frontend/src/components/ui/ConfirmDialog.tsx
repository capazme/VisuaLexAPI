import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Info } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  variant?: 'default' | 'danger';
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  variant = 'default',
  title,
  message,
  confirmLabel = 'Conferma',
  cancelLabel = 'Annulla',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      const timer = setTimeout(() => confirmRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onCancel();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onCancel]);

  const Icon = variant === 'danger' ? AlertTriangle : Info;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50"
          />

          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-title"
              aria-describedby="confirm-message"
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className={cn(
                'w-full max-w-sm pointer-events-auto',
                'bg-white dark:bg-slate-900',
                'rounded-xl shadow-xl',
                'border border-slate-200 dark:border-slate-800',
                'p-6'
              )}
            >
              <div className="flex gap-4">
                <div className={cn(
                  'shrink-0 flex items-center justify-center w-10 h-10 rounded-lg',
                  variant === 'danger'
                    ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                    : 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                )}>
                  <Icon size={20} />
                </div>

                <div className="flex-1 min-w-0">
                  <h3 id="confirm-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {title}
                  </h3>
                  <p id="confirm-message" className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                    {message}
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <Button variant="ghost" size="sm" onClick={onCancel}>
                  {cancelLabel}
                </Button>
                <Button
                  ref={confirmRef}
                  variant={variant === 'danger' ? 'danger' : 'primary'}
                  size="sm"
                  onClick={onConfirm}
                >
                  {confirmLabel}
                </Button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
