import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, Info, AlertCircle, X, Undo2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { registerUndoToastListener, type UndoToast } from '../../hooks/useUndoableAction';

export interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  isVisible: boolean;
  onClose: () => void;
  duration?: number;
  position?: 'top' | 'bottom';
  /** Optional action button */
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function Toast({
  message,
  type,
  isVisible,
  onClose,
  duration = 3000,
  position = 'bottom',
  action,
}: ToastProps) {
  useEffect(() => {
    if (isVisible && duration > 0) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [isVisible, duration, onClose]);

  const icons = {
    success: <CheckCircle2 size={18} className="text-emerald-500" />,
    error: <XCircle size={18} className="text-red-500" />,
    info: <Info size={18} className="text-blue-500" />,
    warning: <AlertCircle size={18} className="text-amber-500" />,
  };

  const styles = {
    success: 'bg-white dark:bg-slate-900 border-emerald-200 dark:border-emerald-900/30 text-slate-800 dark:text-slate-100 shadow-lg shadow-emerald-500/5',
    error: 'bg-white dark:bg-slate-900 border-red-200 dark:border-red-900/30 text-slate-800 dark:text-slate-100 shadow-lg shadow-red-500/5',
    info: 'bg-white dark:bg-slate-900 border-blue-200 dark:border-blue-900/30 text-slate-800 dark:text-slate-100 shadow-lg shadow-blue-500/5',
    warning: 'bg-white dark:bg-slate-900 border-amber-200 dark:border-amber-900/30 text-slate-800 dark:text-slate-100 shadow-lg shadow-amber-500/5',
  };

  const positionStyles = position === 'top'
    ? 'top-4 left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0 md:top-4 md:right-4'
    : 'bottom-4 left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0 md:bottom-8 md:right-8';

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: position === 'top' ? -20 : 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: position === 'top' ? -20 : 20, scale: 0.95 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className={cn(
            'fixed z-[60] flex items-center gap-3 px-4 py-3 rounded-xl border max-w-[90vw] md:max-w-md',
            positionStyles,
            styles[type]
          )}
          role="alert"
        >
          <div className="shrink-0">{icons[type]}</div>
          <p className="flex-1 font-medium text-sm leading-tight">{message}</p>
          {action && (
            <button
              onClick={action.onClick}
              className="shrink-0 px-3 py-1 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-md transition-colors"
            >
              {action.label}
            </button>
          )}
          <button
            onClick={onClose}
            className="shrink-0 hover:bg-slate-100 dark:hover:bg-slate-800 p-1 rounded-md transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            aria-label="Chiudi notifica"
          >
            <X size={16} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Global Undo Toast Container
 * Place this component once at the app root level to enable global undo toasts.
 */
export function UndoToastContainer() {
  const [toast, setToast] = useState<UndoToast | null>(null);

  useEffect(() => {
    return registerUndoToastListener(setToast);
  }, []);

  if (!toast) return null;

  // Calculate progress percentage
  const progress = (toast.timeRemaining / 5000) * 100;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className={cn(
          'fixed z-[60] flex items-center gap-3 px-4 py-3 rounded-xl border max-w-[90vw] md:max-w-md',
          'bottom-4 left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0 md:bottom-8 md:right-8',
          'bg-slate-900 dark:bg-white border-slate-700 dark:border-slate-200',
          'text-white dark:text-slate-900 shadow-lg'
        )}
        role="alert"
      >
        {/* Progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-700 dark:bg-slate-300 rounded-b-xl overflow-hidden">
          <motion.div
            className="h-full bg-blue-500"
            initial={{ width: '100%' }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.1, ease: 'linear' }}
          />
        </div>

        <div className="shrink-0">
          <CheckCircle2 size={18} className="text-emerald-400 dark:text-emerald-600" />
        </div>
        <p className="flex-1 font-medium text-sm leading-tight">{toast.message}</p>
        <button
          onClick={toast.onUndo}
          className="shrink-0 px-3 py-1.5 text-sm font-medium bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors flex items-center gap-1.5"
        >
          <Undo2 size={14} />
          Annulla
        </button>
        <button
          onClick={toast.onDismiss}
          className="shrink-0 hover:bg-slate-800 dark:hover:bg-slate-200 p-1 rounded-md transition-colors text-slate-400 dark:text-slate-500"
          aria-label="Chiudi notifica"
        >
          <X size={16} />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}


