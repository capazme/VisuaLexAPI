/**
 * CitationPreviewPopup - Popup hover per preview di citazioni normative.
 *
 * Mostra il contenuto dell'articolo citato con opzione per aprire in nuova tab.
 */

import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ExternalLink, Loader2, AlertCircle } from 'lucide-react';
import type { ArticleData } from '../../types';
import type { ParsedCitationData } from '../../utils/citationMatcher';
import { formatCitationLabel } from '../../utils/citationMatcher';
import { cn } from '../../lib/utils';

interface CitationPreviewPopupProps {
  isVisible: boolean;
  isLoading: boolean;
  error: string | null;
  citation: ParsedCitationData | null;
  article: ArticleData | null;
  position: { top: number; left: number };
  onClose: () => void;
  onOpenInTab: (citation: ParsedCitationData) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export function CitationPreviewPopup({
  isVisible,
  isLoading,
  error,
  citation,
  article,
  position,
  onClose,
  onOpenInTab,
  onMouseEnter,
  onMouseLeave,
}: CitationPreviewPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null);

  // Chiudi con Escape
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, onClose]);

  // Aggiorna posizione su scroll/resize
  useEffect(() => {
    if (!isVisible) return;

    const handleScroll = () => {
      // La posizione viene aggiornata dal parent hook
    };

    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);

    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [isVisible]);

  const handleOpenInTab = useCallback(() => {
    if (citation) {
      onOpenInTab(citation);
      onClose();
    }
  }, [citation, onOpenInTab, onClose]);

  // Formatta il testo dell'articolo per l'anteprima (senza troncamento)
  const getPreviewText = () => {
    if (!article?.article_text) return null;

    // Rimuovi tag HTML ma mantieni i paragrafi
    const plainText = article.article_text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return plainText;
  };

  return createPortal(
    <AnimatePresence>
      {isVisible && citation && (
        <motion.div
          ref={popupRef}
          initial={{ opacity: 0, scale: 0.95, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -4 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="fixed z-[200] w-[400px] max-w-[calc(100vw-24px)]"
          style={{
            top: position.top,
            left: position.left,
          }}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          role="tooltip"
          aria-live="polite"
        >
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-semibold text-blue-700 dark:text-blue-300 truncate">
                  {formatCitationLabel(citation)}
                </span>
                {citation.confidence < 0.8 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 shrink-0">
                    ~
                  </span>
                )}
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded-lg hover:bg-slate-200/50 dark:hover:bg-slate-700/50 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors shrink-0"
                aria-label="Chiudi"
              >
                <X size={16} />
              </button>
            </div>

            {/* Content */}
            <div className="p-4">
              {isLoading && (
                <div className="flex items-center justify-center gap-2 py-8 text-slate-500 dark:text-slate-400">
                  <Loader2 size={18} className="animate-spin" />
                  <span className="text-sm">Caricamento...</span>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 py-6 text-red-500 dark:text-red-400 justify-center">
                  <AlertCircle size={18} />
                  <span className="text-sm">{error}</span>
                </div>
              )}

              {!isLoading && !error && article && (
                <div className="space-y-3">
                  {/* Article preview - scrollable without truncation */}
                  <div className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed max-h-[300px] overflow-y-auto custom-scrollbar whitespace-pre-wrap">
                    {getPreviewText() || (
                      <span className="text-slate-400 italic">Nessun contenuto disponibile</span>
                    )}
                  </div>

                  {/* Source info */}
                  {article.url && (
                    <div className="text-xs text-slate-400 dark:text-slate-500 truncate">
                      Fonte: Normattiva
                    </div>
                  )}
                </div>
              )}

              {!isLoading && !error && !article && (
                <div className="text-sm text-slate-500 dark:text-slate-400 text-center py-6">
                  Articolo non trovato
                </div>
              )}
            </div>

            {/* Footer - Open in Tab button */}
            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={handleOpenInTab}
                disabled={isLoading}
                className={cn(
                  "w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                  "bg-blue-600 hover:bg-blue-700 text-white",
                  "disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed",
                  "dark:disabled:bg-slate-700 dark:disabled:text-slate-500"
                )}
              >
                <ExternalLink size={14} />
                Apri in nuova tab
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
