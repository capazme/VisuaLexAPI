/**
 * CitationPreviewPopup - Popup hover per preview di citazioni normative.
 *
 * Mostra il contenuto dell'articolo citato con opzione per aprirlo nella pratica.
 */

import { useCallback } from 'react';
import { ExternalLink, Loader2, AlertCircle } from 'lucide-react';
import type { ArticleData } from '../../types';
import type { ParsedCitationData } from '../../utils/citationMatcher';
import { formatCitationLabel } from '../../utils/citationMatcher';
import type { NerFeedbackType, NerCorrectReference } from '../../services/merltService';
import { CitationNerFeedback } from '../../features/merlt/ner/CitationNerFeedback';
import { cn } from '../../lib/utils';
import { PreviewFrame } from './PreviewFrame';

interface CitationPreviewPopupProps {
  isVisible: boolean;
  isLoading: boolean;
  error: string | null;
  citation: ParsedCitationData | null;
  article: ArticleData | null;
  position: { top: number; left: number };
  onClose: () => void;
  onOpenCitation: (citation: ParsedCitationData) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** When true (full-consent contributor), show the NER ✓/✗/Correggi bar. */
  nerFeedbackEnabled?: boolean;
  /** Emit a NER correction/confirmation for the previewed citation. */
  onNerFeedback?: (feedbackType: NerFeedbackType, correctReference?: NerCorrectReference) => void;
}

export function CitationPreviewPopup({
  isVisible,
  isLoading,
  error,
  citation,
  article,
  position,
  onClose,
  onOpenCitation,
  onMouseEnter,
  onMouseLeave,
  nerFeedbackEnabled,
  onNerFeedback,
}: CitationPreviewPopupProps) {
  const handleOpen = useCallback(() => {
    if (citation) {
      onOpenCitation(citation);
      onClose();
    }
  }, [citation, onOpenCitation, onClose]);

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

  return (
    <PreviewFrame
      visible={isVisible && Boolean(citation)}
      position={position}
      title={citation ? formatCitationLabel(citation) : null}
      badge={
        citation && citation.confidence < 0.8 ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 shrink-0">
            ~
          </span>
        ) : null
      }
      onClose={onClose}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      footer={
        /* Open button (primary) + NER feedback below it (design §3.7) */
        <>
          <button
            onClick={handleOpen}
            disabled={isLoading}
            className={cn(
              "w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              "bg-primary-600 hover:bg-primary-700 text-white",
              "disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed",
              "dark:disabled:bg-slate-700 dark:disabled:text-slate-500"
            )}
          >
            <ExternalLink size={14} />
            Apri nella pratica
          </button>
          {citation && nerFeedbackEnabled && onNerFeedback && (
            <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
              <CitationNerFeedback
                key={`${citation.act_type}-${citation.article}-${citation.act_number ?? ''}`}
                citation={citation}
                onSubmit={onNerFeedback}
              />
            </div>
          )}
        </>
      }
    >
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
    </PreviewFrame>
  );
}
