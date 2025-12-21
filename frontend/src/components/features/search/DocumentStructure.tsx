import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, FileText, Check, Loader2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { AnnexMetadata } from '../../../types';

interface DocumentStructureProps {
  annexes: AnnexMetadata[];
  currentAnnex: string | null;
  onAnnexSelect: (annex: string | null) => void;
  /** Optional: show loading state when switching annexes */
  isLoading?: boolean;
  /** Optional: number of loaded articles in current annex */
  loadedCount?: number;
}

export function DocumentStructure({
  annexes,
  currentAnnex,
  onAnnexSelect,
  isLoading = false,
  loadedCount
}: DocumentStructureProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  if (!annexes || annexes.length === 0) {
    return null;
  }

  // Only show if there are multiple sections (main + at least one annex)
  if (annexes.length < 2) {
    return null;
  }

  const handleSelect = (annexNumber: string | null) => {
    if (annexNumber === currentAnnex) return;
    setSwitchingTo(annexNumber);
    onAnnexSelect(annexNumber);
    // Reset after a delay (in case loading doesn't complete)
    setTimeout(() => setSwitchingTo(null), 3000);
  };

  // Find current annex info for showing loaded progress
  const currentAnnexInfo = annexes.find(a =>
    a.number === currentAnnex || (a.number === null && currentAnnex === null)
  );

  return (
    <div className="bg-slate-50 dark:bg-slate-800/30 rounded-2xl border border-slate-200 dark:border-slate-700/50 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-100/50 dark:hover:bg-slate-700/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/20 text-primary-500 dark:text-primary-400 flex items-center justify-center relative">
            {isLoading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <FileText size={18} />
            )}
          </div>
          <div className="text-left">
            <span className="block text-sm font-bold text-slate-900 dark:text-white">
              Struttura del Documento
            </span>
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
              {annexes.length} sezioni disponibili
              {loadedCount !== undefined && currentAnnexInfo && (
                <> · {loadedCount}/{currentAnnexInfo.article_count} articoli caricati</>
              )}
            </span>
          </div>
        </div>
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown size={16} className="text-slate-400 dark:text-slate-500" />
        </motion.div>
      </button>

      {/* Annexes List */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-4 pt-0 space-y-2">
              {annexes.map((annex, idx) => {
                const isActive = currentAnnex === annex.number ||
                  (currentAnnex === null && annex.number === null);
                const isSwitchingToThis = switchingTo === annex.number ||
                  (switchingTo === null && annex.number === null && switchingTo !== undefined);
                const isCurrentlyLoading = isSwitchingToThis && isLoading;

                return (
                  <button
                    key={`annex-${annex.number || 'main'}-${idx}`}
                    type="button"
                    onClick={() => handleSelect(annex.number)}
                    disabled={isLoading}
                    className={cn(
                      "w-full flex items-center justify-between p-3.5 rounded-xl border transition-all text-left relative overflow-hidden",
                      isActive
                        ? "bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800/50 shadow-lg shadow-primary-500/5"
                        : "bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/50 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-md",
                      isLoading && !isActive && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {/* Loading overlay for the item being switched to */}
                    {isCurrentlyLoading && (
                      <div className="absolute inset-0 bg-slate-50/80 dark:bg-slate-900/50 flex items-center justify-center backdrop-blur-sm">
                        <Loader2 size={20} className="animate-spin text-primary-500 dark:text-primary-400" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5">
                        {isActive ? (
                          <div className="w-6 h-6 rounded-lg bg-primary-500 dark:bg-primary-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                            <Check size={14} strokeWidth={3} />
                          </div>
                        ) : (
                          <div className="w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 shrink-0" />
                        )}
                        <span className={cn(
                          "font-semibold text-sm truncate",
                          isActive
                            ? "text-primary-700 dark:text-primary-300"
                            : "text-slate-700 dark:text-slate-300"
                        )}>
                          {annex.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 ml-8">
                        <span className={cn(
                          "text-xs font-medium",
                          isActive
                            ? "text-primary-600 dark:text-primary-400"
                            : "text-slate-500 dark:text-slate-400"
                        )}>
                          {annex.article_count} {annex.article_count === 1 ? 'articolo' : 'articoli'}
                        </span>
                        {annex.article_numbers && annex.article_numbers.length > 0 && (
                          <>
                            <span className="text-xs text-slate-300 dark:text-slate-600">•</span>
                            <span className={cn(
                              "text-xs",
                              isActive
                                ? "text-primary-500 dark:text-primary-400"
                                : "text-slate-400 dark:text-slate-500"
                            )}>
                              Art. {annex.article_numbers.slice(0, 3).join(', ')}
                              {annex.article_numbers.length > 3 && '...'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Current indicator badge */}
                    {isActive && (
                      <span className="px-2.5 py-1 bg-primary-500 text-white text-[10px] font-bold rounded-lg uppercase tracking-wide shrink-0">
                        Attivo
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Helper Text */}
            <div className="px-4 pb-4">
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                Clicca su una sezione per visualizzare i suoi articoli
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
