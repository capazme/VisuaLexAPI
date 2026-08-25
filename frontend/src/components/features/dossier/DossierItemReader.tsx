import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { RefreshCw, Copy, ExternalLink } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { useArticleMarkers } from '../../../hooks/useArticleMarkers';
import { ArticleBody } from '../search/ArticleBody';
import { InlineNoteComposer } from '../search/InlineNoteComposer';
import { buildItemKey, uniqueArticleIdFromNorma } from '../../../utils/normaKeys';
import { formatCitation } from '../../../utils/normaMeta';
import { fetchArticleForNorma } from '../../../utils/articleFetchCache';
import type { ArticleData, NormaVisitata } from '../../../types';

interface Props {
  norma: NormaVisitata;
  onOpenOnDashboard: () => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

type FetchState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; article: ArticleData };

/** A settled fetch, tagged with the request identity that produced it. */
type FetchResult = { key: string; state: Exclude<FetchState, { phase: 'loading' }> };

/**
 * In-row reading surface for a dossier norma item. Mirrors the minimal
 * annotate/highlight subset of ArticleTabContent, reusing the very same
 * `buildItemKey` / `uniqueArticleIdFromNorma` pair so notes and highlights
 * created here and on the dashboard land on the same store rows.
 */
export function DossierItemReader({ norma, onOpenOnDashboard, showToast }: Props) {
  const [result, setResult] = useState<FetchResult | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const [composer, setComposer] = useState<{
    rect: { x: number; y: number; width: number; height: number };
    anchorText: string; startOffset: number;
  } | null>(null);

  const itemKey = useMemo(() => buildItemKey(norma), [norma]);
  const uniqueArticleId = useMemo(() => uniqueArticleIdFromNorma(norma), [norma]);

  const {
    annotations, highlights,
    addAnnotation, addHighlight, removeHighlight,
    loadAnnotationsForArticle, loadHighlightsForArticle,
  } = useAppStore(useShallow((s) => ({
    annotations: s.annotations, highlights: s.highlights,
    addAnnotation: s.addAnnotation, addHighlight: s.addHighlight,
    removeHighlight: s.removeHighlight,
    loadAnnotationsForArticle: s.loadAnnotationsForArticle,
    loadHighlightsForArticle: s.loadHighlightsForArticle,
  })));

  // Identity of the request currently on screen. A retry bumps it so the
  // previous (failed) result goes stale and the row falls back to loading.
  const fetchKey = `${itemKey}#${retryTick}`;

  useEffect(() => {
    let cancelled = false;
    fetchArticleForNorma(norma)
      .then((article) => { if (!cancelled) setResult({ key: fetchKey, state: { phase: 'ready', article } }); })
      .catch((err: unknown) => {
        if (!cancelled) {
          setResult({
            key: fetchKey,
            state: { phase: 'error', message: err instanceof Error ? err.message : 'Errore di caricamento' },
          });
        }
      });
    return () => { cancelled = true; };
  }, [norma, fetchKey]);

  // Derived during render rather than reset via setState inside the effect —
  // any result that doesn't match the live request is stale, which IS the
  // loading state (see CLAUDE.md gotcha #11 on set-state-in-effect).
  const state: FetchState = result?.key === fetchKey ? result.state : { phase: 'loading' };

  useEffect(() => {
    void loadAnnotationsForArticle(itemKey, uniqueArticleId);
    void loadHighlightsForArticle(itemKey, uniqueArticleId);
  }, [itemKey, uniqueArticleId, loadAnnotationsForArticle, loadHighlightsForArticle]);

  const itemAnnotations = useMemo(
    () => annotations.filter(a => a.normaKey === itemKey && a.articleId === uniqueArticleId),
    [annotations, itemKey, uniqueArticleId],
  );
  const articleHighlights = useMemo(
    () => highlights.filter(h => h.normaKey === itemKey && h.articleId === uniqueArticleId),
    [highlights, itemKey, uniqueArticleId],
  );

  const rawText = state.phase === 'ready' ? (state.article.article_text || '') : '';
  const markedHtml = useArticleMarkers({ rawText, highlights: articleHighlights, annotations: itemAnnotations });

  // Same duplicate-anchor guard as ArticleTabContent.handlePopupHighlight:
  // re-highlighting the exact same span at the same offset is a no-op with
  // an explanatory toast, not a second overlapping <mark>.
  const handlePopupHighlight = (text: string, color: 'yellow' | 'green' | 'red' | 'blue', startOffset: number) => {
    const alreadyHighlighted = articleHighlights.some(h =>
      h.text.toLowerCase() === text.toLowerCase() && h.startOffset === startOffset
    );
    if (alreadyHighlighted) {
      showToast('Questa occorrenza è già evidenziata', 'info');
      return;
    }
    addHighlight(itemKey, uniqueArticleId, text, '', color, startOffset);
    showToast(`Testo evidenziato in ${color}`, 'success');
  };

  const handlePopupCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(`${text}\n\n---\nTratto da: ${formatCitation(norma)}`);
      showToast('Testo copiato con citazione', 'success');
    } catch {
      showToast('Errore durante la copia', 'error');
    }
  };

  const handleCopyCitation = async () => {
    try {
      await navigator.clipboard.writeText(formatCitation(norma));
      showToast('Citazione copiata', 'success');
    } catch {
      showToast('Errore durante la copia', 'error');
    }
  };

  if (state.phase === 'loading') {
    return (
      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 flex items-center gap-2 text-sm text-slate-400">
        <RefreshCw size={14} className="animate-spin" /> Recupero del testo…
      </div>
    );
  }
  if (state.phase === 'error') {
    return (
      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 text-sm text-red-600 dark:text-red-400 flex items-center gap-3">
        <span>{state.message}</span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setRetryTick(t => t + 1); }}
          className="font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded"
        >
          Riprova
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700" onClick={(e) => e.stopPropagation()}>
      <ArticleBody
        contentRef={contentRef}
        itemKey={itemKey}
        processedContent={markedHtml}
        panelHighlights={articleHighlights}
        onPopupHighlight={handlePopupHighlight}
        onPopupAddNote={(text, startOffset, rect) => {
          setComposer({ rect, anchorText: text, startOffset });
        }}
        onPopupCopy={handlePopupCopy}
        onRemoveHighlight={removeHighlight}
      />
      {composer && (
        <InlineNoteComposer
          anchorRect={composer.rect}
          anchorText={composer.anchorText}
          onSave={(text) => {
            addAnnotation(itemKey, uniqueArticleId, text, {
              anchorText: composer.anchorText, startOffset: composer.startOffset,
            });
            setComposer(null);
            showToast('Nota aggiunta', 'success');
          }}
          onClose={() => setComposer(null)}
        />
      )}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
        <button
          type="button"
          onClick={handleCopyCitation}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          <Copy size={13} /> Copia citazione
        </button>
        <button
          type="button"
          onClick={onOpenOnDashboard}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <ExternalLink size={13} /> Apri su Dashboard
        </button>
      </div>
    </div>
  );
}
