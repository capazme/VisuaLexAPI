import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, Info, AlertCircle, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  isVisible: boolean;
  onClose: () => void;
  duration?: number;
  position?: 'top' | 'bottom';
}

export function Toast({
  message,
  type,
  isVisible,
  onClose,
  duration = 3000,
  position = 'bottom'
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
            'fixed z-[60] flex items-center gap-3 px-4 py-3 rounded-xl border max-w-[90vw] md:max-w-sm',
            positionStyles,
            styles[type]
          )}
          role="alert"
        >
          <div className="shrink-0">{icons[type]}</div>
          <p className="flex-1 font-medium text-sm leading-tight">{message}</p>
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


