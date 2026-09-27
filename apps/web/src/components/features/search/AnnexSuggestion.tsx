import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Sparkles, Loader2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { AnnexMetadata } from '../../../types';

interface AnnexSuggestionProps {
  /** Current article number */
  articleNumber: string;
  /** Current annex (null = main text/dispositivo) */
  currentAnnex: string | null;
  /** All annexes metadata */
  annexes: AnnexMetadata[];
  /** Callback when user wants to switch to a suggested annex */
  onSwitchAnnex: (annexNumber: string | null) => Promise<string | null> | void;
  /** Optional className */
  className?: string;
  /** Loading state from parent */
  isLoading?: boolean;
}

/**
 * Shows a suggestion banner when the loaded article exists in other annexes.
 *
 * Example: User loads "Art. 1" from Dispositivo, but Art. 1 also exists in
 * "Codice Civile" (Allegato 2) - show a suggestion to switch.
 */
export function AnnexSuggestion({
  articleNumber,
  currentAnnex,
  annexes,
  onSwitchAnnex,
  className,
  isLoading: externalLoading
}: AnnexSuggestionProps) {
  const [internalLoading, setInternalLoading] = useState(false);
  const isLoading = externalLoading || internalLoading;

  // Find annexes that contain the same article number (excluding current)
  const alternativeAnnexes = useMemo(() => {
    if (!annexes || annexes.length < 2) return [];

    const normalizedArticle = articleNumber.toLowerCase().trim();

    return annexes.filter(annex => {
      // Skip current annex
      if (annex.number === currentAnnex) return false;
      if (annex.number === null && currentAnnex === null) return false;

      // Check if this annex contains the article
      if (!annex.article_numbers) return false;

      return annex.article_numbers.some(
        num => num.toLowerCase().trim() === normalizedArticle
      );
    });
  }, [annexes, articleNumber, currentAnnex]);

  // Find the "best" alternative (the one with most articles - likely the main content)
  const bestAlternative = useMemo(() => {
    if (alternativeAnnexes.length === 0) return null;

    // Sort by article count descending, pick the largest
    return [...alternativeAnnexes].sort(
      (a, b) => b.article_count - a.article_count
    )[0];
  }, [alternativeAnnexes]);

  // Only show if we're in Dispositivo (null) and there's a better alternative
  // This is the most common case: user searched without annex, got Dispositivo
  const shouldShow = currentAnnex === null && bestAlternative !== null;

  // Get current section name
  const currentSectionName = annexes.find(a => a.number === currentAnnex)?.label || 'Dispositivo';

  const handleSwitch = async () => {
    if (isLoading || !bestAlternative) return;
    setInternalLoading(true);
    try {
      await onSwitchAnnex(bestAlternative.number);
    } finally {
      setInternalLoading(false);
    }
  };

  return (
    <AnimatePresence mode="wait">
      {shouldShow && (
        <motion.div
          initial={{ opacity: 0, y: -10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.98 }}
          transition={{
            type: 'spring',
            damping: 25,
            stiffness: 350,
            duration: 0.3
          }}
          className={cn(
            "flex items-center gap-3 p-3 rounded-xl border overflow-hidden relative",
            "bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 dark:from-amber-900/20 dark:via-orange-900/20 dark:to-amber-900/20",
            "border-amber-200/80 dark:border-amber-700/50",
            "shadow-sm shadow-amber-100/50 dark:shadow-amber-900/20",
            className
          )}
        >
          {/* Subtle animated background */}
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/5"
            initial={{ x: '-100%' }}
            animate={{ x: '200%' }}
            transition={{ duration: 3, repeat: Infinity, ease: 'linear', repeatDelay: 2 }}
          />

          {/* Icon */}
          <motion.div
            className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center flex-shrink-0 shadow-md shadow-amber-500/30"
            initial={{ rotate: -10 }}
            animate={{ rotate: 0 }}
            transition={{ type: 'spring', damping: 10 }}
          >
            <Sparkles size={18} className="text-white" />
          </motion.div>

          {/* Content */}
          <div className="flex-1 min-w-0 relative z-10">
            <p className="text-sm text-amber-900 dark:text-amber-100">
              <span className="font-bold">Art. {articleNumber}</span>
              <span className="text-amber-700 dark:text-amber-300"> caricato da </span>
              <span className="font-semibold text-amber-800 dark:text-amber-200">{currentSectionName}</span>
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
              Cercavi <span className="font-bold">{bestAlternative.label}</span>?
            </p>
          </div>

          {/* Action Button */}
          <motion.button
            onClick={handleSwitch}
            disabled={isLoading}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={cn(
              "relative flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold",
              "bg-gradient-to-r from-amber-500 to-orange-500 text-white",
              "hover:from-amber-600 hover:to-orange-600",
              "shadow-md shadow-amber-500/30 hover:shadow-lg hover:shadow-amber-500/40",
              "transition-all duration-200",
              isLoading && "opacity-80 cursor-wait"
            )}
          >
            {isLoading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Carico...</span>
              </>
            ) : (
              <>
                <span>Vai</span>
                <ArrowRight size={14} />
              </>
            )}
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
