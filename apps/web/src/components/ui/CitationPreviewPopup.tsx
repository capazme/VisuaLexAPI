/**
 * CitationPreviewPopup - Popup hover per preview di citazioni normative.
 *
 * Mostra le prime righe dell'articolo citato.
 */

import { Loader2, AlertCircle } from 'lucide-react';
import type { ArticleData } from '../../types';
import type { ParsedCitationData } from '../../utils/citationMatcher';
import { formatCitationLabel } from '../../utils/citationMatcher';
import { PreviewFrame } from './PreviewFrame';

interface CitationPreviewPopupProps {
  isVisible: boolean;
  isLoading: boolean;
  error: string | null;
  citation: ParsedCitationData | null;
  article: ArticleData | null;
  position: { top: number; left: number };
  onClose: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

/**
 * A pure tooltip on hover (LC142, L-74): the cited article's first lines, nothing to press or scroll. The click on the
 * citation opens it beside the text. Its «Apri» button and the NER feedback (dev mode) left it: see the PR's queue.
 */
export function CitationPreviewPopup({
  isVisible,
  isLoading,
  error,
  citation,
  article,
  position,
  onClose,
  onMouseEnter,
  onMouseLeave,
}: CitationPreviewPopupProps) {
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
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 shrink-0">
            ~
          </span>
        ) : null
      }
      onClose={onClose}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
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
          <div className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed line-clamp-6 whitespace-pre-wrap">
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
