/**
 * CitationPreviewPopup - Popup hover per preview di citazioni normative.
 *
 * Mostra il contenuto dell'articolo citato con opzione per aprire in nuova tab.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ExternalLink, Loader2, AlertCircle, Check, Ban, Pencil } from 'lucide-react';
import type { ArticleData } from '../../types';
import type { ParsedCitationData } from '../../utils/citationMatcher';
import { formatCitationLabel } from '../../utils/citationMatcher';
import type { NerFeedbackType, NerCorrectReference } from '../../services/merltService';
import { cn } from '../../lib/utils';
import { Z_INDEX } from '../../constants/zIndex';

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
  /** When true (full-consent contributor), show the NER ✓/✗/Correggi bar. */
  nerFeedbackEnabled?: boolean;
  /** Emit a NER correction/confirmation for the previewed citation. */
  onNerFeedback?: (feedbackType: NerFeedbackType, correctReference?: NerCorrectReference) => void;
}

interface CitationNerFeedbackProps {
  citation: ParsedCitationData;
  onSubmit: (feedbackType: NerFeedbackType, correctReference?: NerCorrectReference) => void;
}

/**
 * Inline NER feedback for one detected citation (surface: article_xref — the
 * primary signal). Confirm (✓) / reject (✗) / correct (mini-editor) feeds the
 * RLCF training store. Keyed by citation upstream so each citation gets fresh
 * state (no set-state-in-effect reset). Legal lexicon, no scores/gamification.
 */
function CitationNerFeedback({ citation, onSubmit }: CitationNerFeedbackProps) {
  const [done, setDone] = useState<NerFeedbackType | null>(null);
  const [editing, setEditing] = useState(false);
  const [actType, setActType] = useState(citation.act_type ?? '');
  const [article, setArticle] = useState(citation.article ?? '');

  const submit = (type: NerFeedbackType, correctReference?: NerCorrectReference) => {
    onSubmit(type, correctReference);
    setEditing(false);
    setDone(type);
  };

  if (done) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400" role="status">
        <Check size={13} className="text-emerald-500" />
        {done === 'correction' ? 'Correzione registrata. Grazie.' : 'Grazie per il riscontro.'}
      </p>
    );
  }

  if (editing) {
    const canSave = actType.trim().length > 0 && article.trim().length > 0;
    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-600 dark:text-slate-300">Riferimento corretto</p>
        <div className="flex gap-2">
          <input
            value={actType}
            onChange={(e) => setActType(e.target.value)}
            placeholder="Tipo atto (es. codice civile)"
            aria-label="Tipo atto corretto"
            className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800"
          />
          <input
            value={article}
            onChange={(e) => setArticle(e.target.value)}
            placeholder="Articolo"
            aria-label="Articolo corretto"
            className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-md px-2 py-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            Annulla
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() =>
              submit('correction', {
                actType: actType.trim(),
                article: article.trim(),
                displayText: formatCitationLabel(citation),
              })
            }
            className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700"
          >
            Salva
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-slate-500 dark:text-slate-400">Citazione corretta?</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Conferma la citazione"
          onClick={() => submit('confirmation')}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-emerald-50 hover:text-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:bg-emerald-950/40"
        >
          <Check size={14} />
        </button>
        <button
          type="button"
          aria-label="Segnala citazione errata"
          onClick={() => submit('false_positive')}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-950/40"
        >
          <Ban size={14} />
        </button>
        <button
          type="button"
          aria-label="Correggi la citazione"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        >
          <Pencil size={13} /> Correggi
        </button>
      </div>
    </div>
  );
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
  nerFeedbackEnabled,
  onNerFeedback,
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
          className={cn('fixed w-[400px] max-w-[calc(100vw-24px)]', Z_INDEX.citationPreview)}
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

            {/* Footer - NER feedback (contributors) + Open in Tab button */}
            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
              {nerFeedbackEnabled && onNerFeedback && (
                <div className="mb-3 border-b border-slate-100 pb-3 dark:border-slate-800">
                  <CitationNerFeedback
                    key={`${citation.act_type}-${citation.article}-${citation.act_number ?? ''}`}
                    citation={citation}
                    onSubmit={onNerFeedback}
                  />
                </div>
              )}
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
