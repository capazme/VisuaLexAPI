import { motion, AnimatePresence } from 'framer-motion';
import { FileText, ArrowRight, X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface AnnexSwitchDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  articleNumber: string;
  annexLabel: string;
  annexNumber: string | null;
}

/**
 * Dialog for confirming automatic annex switch.
 * Shows when an article is found in an annex instead of main text.
 *
 * Uses glass aesthetic matching CommandPalette style.
 */
export function AnnexSwitchDialog({
  isOpen,
  onConfirm,
  onCancel,
  articleNumber,
  annexLabel,
  annexNumber: _annexNumber
}: AnnexSwitchDialogProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop - glass aesthetic */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-md z-[100]"
            onClick={onCancel}
          />

          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[100] w-full max-w-md px-4"
          >
            <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl rounded-3xl shadow-2xl shadow-slate-900/10 dark:shadow-black/30 border border-white/50 dark:border-slate-700/50 overflow-hidden">
              {/* Header - minimal, no background color */}
              <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-primary-50 dark:bg-primary-900/20 text-primary-500 dark:text-primary-400 flex items-center justify-center">
                    <FileText size={20} />
                  </div>
                  <div>
                    <h2 className="font-bold text-lg text-slate-900 dark:text-white">
                      Articolo in Allegato
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Struttura documento rilevata
                    </p>
                  </div>
                </div>
                <button
                  onClick={onCancel}
                  className="p-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Content */}
              <div className="p-6">
                <p className="text-slate-600 dark:text-slate-300 text-base leading-relaxed mb-6">
                  L'<span className="font-bold text-slate-900 dark:text-white">Articolo {articleNumber}</span> si trova
                  nell'<span className="font-bold text-primary-600 dark:text-primary-400">{annexLabel}</span>.
                </p>

                {/* Visual representation - modern minimal style */}
                <div className="flex items-center justify-center gap-6 py-5 mb-6 bg-slate-50 dark:bg-slate-800/30 rounded-2xl border border-slate-100 dark:border-slate-700/50">
                  <div className="text-center">
                    <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-2 mx-auto border border-slate-200 dark:border-slate-700">
                      <span className="text-sm font-bold text-slate-400 dark:text-slate-500">Art.</span>
                    </div>
                    <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">Dispositivo</span>
                  </div>

                  <ArrowRight size={24} className="text-primary-400 dark:text-primary-500" />

                  <div className="text-center">
                    <div className="w-14 h-14 rounded-2xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center mb-2 mx-auto border-2 border-primary-400 dark:border-primary-600 shadow-lg shadow-primary-500/10">
                      <span className="text-sm font-bold text-primary-600 dark:text-primary-400">{articleNumber}</span>
                    </div>
                    <span className="text-xs text-primary-600 dark:text-primary-400 font-semibold">
                      {annexLabel}
                    </span>
                  </div>
                </div>

                <p className="text-sm text-slate-500 dark:text-slate-400 text-center font-medium">
                  Vuoi visualizzare l'articolo nell'allegato?
                </p>
              </div>

              {/* Actions - modern button style */}
              <div className="flex gap-3 p-5 bg-slate-50/50 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800">
                <button
                  onClick={onCancel}
                  className={cn(
                    "flex-1 px-5 py-3.5 rounded-xl text-sm font-bold transition-all",
                    "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700",
                    "text-slate-600 dark:text-slate-300",
                    "hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-300 dark:hover:border-slate-600",
                    "active:scale-[0.98]"
                  )}
                >
                  No, resta qui
                </button>
                <button
                  onClick={onConfirm}
                  className={cn(
                    "flex-1 px-5 py-3.5 rounded-xl text-sm font-bold transition-all",
                    "bg-primary-500 hover:bg-primary-600 text-white",
                    "shadow-lg shadow-primary-500/25",
                    "active:scale-[0.98]"
                  )}
                >
                  Sì, vai all'allegato
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
