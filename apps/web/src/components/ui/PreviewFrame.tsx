/**
 * PreviewFrame - the frame of the hover popups on citations: portal, animation, header with its close
 * button, body and footer. Whoever uses it writes the body (a norm: `CitationPreviewPopup`; a decision:
 * `DecisionPreviewPopup`); the position is computed by the preview's hook.
 */

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Z_INDEX } from '../../constants/zIndex';

interface PreviewFrameProps {
  visible: boolean;
  position: { top: number; left: number };
  title: ReactNode;
  /** Beside the title in the header (the norm popup's «~» for a doubtful reading). */
  badge?: ReactNode;
  onClose: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  children: ReactNode;
  footer: ReactNode;
}

export function PreviewFrame({ visible, position, title, badge, onClose, onMouseEnter, onMouseLeave, children, footer }: PreviewFrameProps) {
  // Escape closes it
  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose]);

  return createPortal(
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -4 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className={cn('fixed w-[400px] max-w-[calc(100vw-24px)]', Z_INDEX.citationPreview)}
          style={{ top: position.top, left: position.left }}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          role="tooltip"
          // Holds links: a press in it is not a click away from a practice's folded-table overlay.
          data-floating-tool
          aria-live="polite"
        >
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-semibold text-blue-700 dark:text-blue-300 truncate">{title}</span>
                {badge}
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded-lg hover:bg-slate-200/50 dark:hover:bg-slate-700/50 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors shrink-0"
                aria-label="Chiudi"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4">{children}</div>

            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">{footer}</div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
