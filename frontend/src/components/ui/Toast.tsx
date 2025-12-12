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
    success: <CheckCircle2 size={20} className="text-green-600 dark:text-green-400" />,
    error: <XCircle size={20} className="text-red-600 dark:text-red-400" />,
    info: <Info size={20} className="text-blue-600 dark:text-blue-400" />,
    warning: <AlertCircle size={20} className="text-yellow-600 dark:text-yellow-400" />,
  };

  const styles = {
    success: 'bg-green-50/90 dark:bg-green-900/40 border-green-200 dark:border-green-800 text-green-900 dark:text-green-100',
    error: 'bg-red-50/90 dark:bg-red-900/40 border-red-200 dark:border-red-800 text-red-900 dark:text-red-100',
    info: 'bg-blue-50/90 dark:bg-blue-900/40 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100',
    warning: 'bg-yellow-50/90 dark:bg-yellow-900/40 border-yellow-200 dark:border-yellow-800 text-yellow-900 dark:text-yellow-100',
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
            'fixed z-[200] flex items-center gap-4 px-5 py-4 rounded-xl shadow-2xl border backdrop-blur-md max-w-[90vw] md:max-w-md',
            positionStyles,
            styles[type]
          )}
          role="alert"
        >
          <div className="shrink-0">{icons[type]}</div>
          <p className="flex-1 font-medium text-sm">{message}</p>
          <button
            onClick={onClose}
            className="shrink-0 hover:opacity-70 transition-opacity p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="Chiudi notifica"
          >
            <X size={16} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}


