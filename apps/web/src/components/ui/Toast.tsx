import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useIsPresent, useReducedMotion } from 'framer-motion';
import { CheckCircle2, XCircle, Info, AlertCircle, X, Undo2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { registerUndoToastListener, type UndoToast } from '../../hooks/useUndoableAction';
import { spring } from '../../lib/motion';

// A toast enters from the edge it lives on and leaves the same way (Sonner's rule); under reduced
// motion it only fades. Full transform strings, so Framer does not rebuild them per frame.
function edgeMotion(edge: 'top' | 'bottom', still: boolean | null) {
  const away = still ? { opacity: 0 } : { opacity: 0, transform: `translateY(${edge === 'top' ? '-100%' : '100%'})` };
  return {
    initial: away,
    animate: still ? { opacity: 1 } : { opacity: 1, transform: 'translateY(0%)' },
    exit: away,
    transition: spring.snappy,
  };
}

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
  /**
   * aria-live politeness. Defaults to 'polite', but errors are announced
   * with 'assertive' so screen readers interrupt.
   */
  ariaLive?: 'polite' | 'assertive' | 'off';
  /** Extra classes, last: a band of `constants/zIndex.ts` (`Z_INDEX.toast`) replaces the default. */
  className?: string;
}

export function Toast({
  message,
  type,
  isVisible,
  onClose,
  duration = 3000,
  position = 'bottom',
  action,
  ariaLive,
  className,
}: ToastProps) {
  const still = useReducedMotion();

  // The time to read runs only while the tab is on screen: a toast that fired in a hidden tab
  // is still there when the reader comes back.
  useEffect(() => {
    if (!isVisible || duration <= 0) return;
    let remaining = duration;
    let startedAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      startedAt = Date.now();
      timer = setTimeout(onClose, remaining);
    };
    const onVisibility = () => {
      if (document.hidden && timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
        remaining -= Date.now() - startedAt;
      } else if (!document.hidden && timer === undefined) {
        run();
      }
    };
    if (!document.hidden) run();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isVisible, duration, onClose]);

  const icons = {
    success: <CheckCircle2 size={18} className="text-emerald-500" />,
    error: <XCircle size={18} className="text-red-500" />,
    info: <Info size={18} className="text-blue-500" />,
    warning: <AlertCircle size={18} className="text-amber-500" />,
  };

  const styles = {
    success: 'bg-white dark:bg-slate-900 border-emerald-200 dark:border-emerald-900/30 text-slate-800 dark:text-slate-100 shadow-lg',
    error: 'bg-white dark:bg-slate-900 border-red-200 dark:border-red-900/30 text-slate-800 dark:text-slate-100 shadow-lg',
    info: 'bg-white dark:bg-slate-900 border-blue-200 dark:border-blue-900/30 text-slate-800 dark:text-slate-100 shadow-lg',
    warning: 'bg-white dark:bg-slate-900 border-amber-200 dark:border-amber-900/30 text-slate-800 dark:text-slate-100 shadow-lg',
  };

  // On a phone the width less a 16px gutter: a centring translate would be overwritten by the
  // motion's own transform, and `left-1/2` alone squeezed a message into half the screen.
  const positionStyles = position === 'top'
    ? 'top-4 inset-x-4 md:inset-x-auto md:top-4 md:right-4'
    : 'bottom-4 inset-x-4 md:inset-x-auto md:bottom-8 md:right-8';

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          {...edgeMotion(position, still)}
          className={cn(
            'fixed z-[60] flex items-center gap-3 px-4 py-3 rounded-xl border md:max-w-md',
            positionStyles,
            styles[type],
            className
          )}
          role="alert"
          aria-live={ariaLive ?? (type === 'error' ? 'assertive' : 'polite')}
          aria-atomic="true"
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
  const still = useReducedMotion();

  useEffect(() => {
    return registerUndoToastListener(setToast);
  }, []);

  return (
    <AnimatePresence>
      {toast && <UndoToastCard toast={toast} still={still} />}
    </AnimatePresence>
  );
}

/**
 * One undo toast. Once its countdown resolves (undone, dismissed or run out) AnimatePresence keeps it
 * on screen for its exit; while it leaves nothing in it answers, so a last-moment «Annulla» is not
 * taken for a restore that did not happen.
 */
function UndoToastCard({ toast, still }: { toast: UndoToast; still: boolean | null }) {
  const present = useIsPresent();
  // The share of the time left, drawn as a scale so the bar stays on the compositor.
  const progress = toast.timeRemaining / 5000;

  return (
    <motion.div
      {...edgeMotion('bottom', still)}
      inert={!present}
      className={cn(
        // The same placement as the plain toast's (above).
        'fixed z-[60] flex items-center gap-3 px-4 py-3 rounded-xl border md:max-w-md',
        'bottom-4 inset-x-4 md:inset-x-auto md:bottom-8 md:right-8',
        'bg-slate-900 dark:bg-white border-slate-700 dark:border-slate-200',
        'text-white dark:text-slate-900 shadow-lg',
        !present && 'pointer-events-none'
      )}
      role="alert"
    >
      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-700 dark:bg-slate-300 rounded-b-xl overflow-hidden">
        <motion.div
          className="h-full w-full origin-left bg-blue-500"
          initial={{ scaleX: 1 }}
          animate={{ scaleX: progress }}
          transition={{ duration: 0.1, ease: 'linear' }}
        />
      </div>

      <div className="shrink-0">
        <CheckCircle2 size={18} className="text-emerald-400 dark:text-emerald-600" />
      </div>
      <p className="flex-1 font-medium text-sm leading-tight">{toast.message}</p>
      <button
        onClick={toast.onUndo}
        disabled={!present}
        className="shrink-0 px-3 py-1.5 text-sm font-medium bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors flex items-center gap-1.5"
      >
        <Undo2 size={14} />
        Annulla
      </button>
      <button
        onClick={toast.onDismiss}
        disabled={!present}
        className="shrink-0 hover:bg-slate-800 dark:hover:bg-slate-200 p-1 rounded-md transition-colors text-slate-400 dark:text-slate-500"
        aria-label="Chiudi notifica"
      >
        <X size={16} />
      </button>
    </motion.div>
  );
}
