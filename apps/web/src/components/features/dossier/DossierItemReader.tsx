import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { RefreshCw, Copy, ExternalLink } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { useArticleMarkers } from '../../../hooks/useArticleMarkers';
import { useArticleTextInteractions } from '../../../hooks/useArticleTextInteractions';
import { ArticleBody } from '../search/ArticleBody';
import { UpdateNotePopover } from '../search/UpdateNotePopover';
import { BlockAnnotationsPopover } from '../search/BlockAnnotationsPopover';
import { LooseHighlightsList } from '../search/LooseHighlightsList';
import { InlineNoteComposer } from '../search/InlineNoteComposer';
import { InlineNotePopover } from '../search/InlineNotePopover';
import { buildItemKey, uniqueArticleIdFromNorma } from '../../../utils/normaKeys';
import { formatNormCitation, unversionedCitation, withCitation } from '../../../utils/citation';
import { todayInRome } from '../../../utils/dateUtils';
import { describeVersion, historicalItemLabel, isEuropeanAct, requestIsHistorical } from '../../../utils/versionDisplay';
import { VersionBanner } from '../search/VersionBanner';
import { fetchArticleForNorma } from '../../../utils/articleFetchCache';
import { getUpdateNoteParagraphs, parseArticleStructure } from '../../../utils/articleStructure';
import { describeBlock, groupAnnotationsByBlock, hasAnnotations, highlightsWithoutSign } from '../../../utils/articleAnnotations';
import type { Annotation, ArticleData, Highlight, NormaVisitata } from '../../../types';

interface Props {
  norma: NormaVisitata;
  onOpenOnDashboard: () => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  /** The fetched article, for a row that takes its rubrica from the text when the act's index gave none. */
  onArticle?: (article: ArticleData) => void;
}

type FetchState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; article: ArticleData };

/** A settled fetch, tagged with the request identity that produced it. */
type FetchResult = { key: string; state: Exclude<FetchState, { phase: 'loading' }> };

// What a past text is shown with in place of the reader's marks (stable, so the
// memoised rendering does not run again for a fresh empty array).
const NO_HIGHLIGHTS: Highlight[] = [];
const NO_ANNOTATIONS: Annotation[] = [];

/**
 * In-row reading surface for a dossier norma item. Mirrors the minimal
 * annotate/highlight subset of ArticleTabContent, reusing the very same
 * `buildItemKey` / `uniqueArticleIdFromNorma` pair so notes and highlights
 * created here and on the dashboard land on the same store rows.
 */
export function DossierItemReader({ norma, onOpenOnDashboard, showToast, onArticle }: Props) {
  const [result, setResult] = useState<FetchResult | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const [composer, setComposer] = useState<{
    rect: { x: number; y: number; width: number; height: number };
    anchorText: string; startOffset: number;
  } | null>(null);
  const [inlineNote, setInlineNote] = useState<{ note: Annotation; anchorEl: HTMLElement } | null>(null);

  const itemKey = useMemo(() => buildItemKey(norma), [norma]);
  const uniqueArticleId = useMemo(() => uniqueArticleIdFromNorma(norma), [norma]);

  const {
    annotations, highlights,
    addAnnotation, updateAnnotation, removeAnnotation,
    addHighlight, removeHighlight,
    loadAnnotationsForArticle, loadHighlightsForArticle,
  } = useAppStore(useShallow((s) => ({
    annotations: s.annotations, highlights: s.highlights,
    addAnnotation: s.addAnnotation,
    updateAnnotation: s.updateAnnotation,
    removeAnnotation: s.removeAnnotation,
    addHighlight: s.addHighlight,
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
  const isReady = state.phase === 'ready';

  // A past text is a reading here too: the keys of notes and highlights carry no
  // version, so whatever was made on it would appear on the text in force.
  const article = state.phase === 'ready' ? state.article : undefined;
  useEffect(() => {
    if (article) onArticle?.(article);
  }, [article, onArticle]);
  const display = article ? describeVersion(article.validity, norma) : null;
  const readOnly = display?.readOnly ?? false;
  const historical = requestIsHistorical(norma);
  const citeLocked = historical && !display?.canCite;
  const citationNow = () => (display?.canCite
    ? formatNormCitation({
      norma,
      validity: article?.validity,
      requestedDate: norma.data_versione?.trim() || undefined,
      original: !norma.data_versione?.trim() && requestIsHistorical(norma),
      consultedAt: todayInRome(),
    })
    : null);

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
  const structure = useMemo(() => parseArticleStructure(rawText), [rawText]);
  const shownHighlights = readOnly ? NO_HIGHLIGHTS : articleHighlights;
  const shownAnnotations = readOnly ? NO_ANNOTATIONS : itemAnnotations;
  const markedHtml = useArticleMarkers({ rawText, highlights: shownHighlights, annotations: shownAnnotations, structure, signs: !readOnly });
  // What each block's sign counts, for the popover it opens (the renderer
  // derives the signs from the same inputs, through the same module).
  const blockGroups = useMemo(
    () => groupAnnotationsByBlock(rawText, structure, shownHighlights, shownAnnotations),
    [rawText, structure, shownHighlights, shownAnnotations],
  );
  // Highlights no sign can reach (their text changed): still removable.
  const looseHighlights = useMemo(
    () => (readOnly ? NO_HIGHLIGHTS : highlightsWithoutSign(articleHighlights, blockGroups)),
    [readOnly, articleHighlights, blockGroups],
  );
  // Update-note references, the foldable AGGIORNAMENTO tail and the
  // annotation signs, as on the dashboard. `enabled` waits for the body: it
  // exists only once the fetch settles.
  const { updatesOpen, openNote, closeNote, openBlock, closeBlock } = useArticleTextInteractions(contentRef, itemKey, {
    enabled: isReady,
    contentKey: markedHtml,
    // A past text opens its notes (the rule that applies is often in them); the toggle still folds them.
    updatesOpenByDefault: display?.updateNotesOpen ?? false,
  });
  const openGroup = openBlock === null ? undefined : blockGroups[openBlock];

  // Delegated click on the article body: tapping a wavy `.note-anchor`
  // opens the compact InlineNotePopover for that single note, exactly as
  // ArticleTabContent does on the dashboard. `isReady` is a real dependency,
  // not a tripwire: the body (and therefore contentRef) only exists once the
  // fetch settles, so the listener has to be attached on that transition.
  useEffect(() => {
    if (!isReady) return;
    const container = contentRef.current;
    if (!container) return;
    const handler = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest('.note-anchor') as HTMLElement | null;
      if (!target) return;
      const noteId = target.getAttribute('data-note-id');
      if (!noteId) return;
      const note = itemAnnotations.find(a => a.id === noteId);
      if (!note) return;
      e.preventDefault();
      e.stopPropagation();
      setInlineNote({ note, anchorEl: target });
    };
    container.addEventListener('click', handler);
    return () => container.removeEventListener('click', handler);
  }, [itemAnnotations, isReady]);

  // Same duplicate-anchor guard as ArticleTabContent.handlePopupHighlight:
  // re-highlighting the exact same span at the same offset is a no-op with
  // an explanatory toast, not a second overlapping <mark>.
  const handlePopupHighlight = (text: string, color: 'yellow' | 'green' | 'red' | 'blue', startOffset: number) => {
    if (readOnly) return;
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
    // The table decides what may leave the page: a text it refuses is not copied under any label.
    if (display && !display.canCopyOrSave) {
      showToast(display.copyBlockedReason ?? '', 'info');
      return;
    }
    try {
      await navigator.clipboard.writeText(withCitation(text, citationNow(), unversionedCitation(norma, todayInRome())));
      showToast('Testo copiato con citazione', 'success');
    } catch {
      showToast('Errore durante la copia', 'error');
    }
  };

  const handleCopyCitation = async () => {
    if (display && !display.canCopyOrSave) {
      showToast(display.copyBlockedReason ?? '', 'info');
      return;
    }
    try {
      // A past text is cited as the version it is; with no honest citation, none is copied.
      // An act of the Union has none by design (the server ignores the day), and the plain one is true.
      const citation = citationNow();
      if (historical && !citation && !isEuropeanAct(norma.tipo_atto)) return;
      await navigator.clipboard.writeText(citation ? citation.long : unversionedCitation(norma, todayInRome()));
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
          onClick={() => setRetryTick(t => t + 1)}
          className="font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded"
        >
          Riprova
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
      {display?.banner && <VersionBanner banner={display.banner} variant={display.textVisible ? 'banner' : 'state'} />}
      {/* The source could not be read, so the banner has nothing to say: the day asked for is all there is. */}
      {historical && !display?.banner && (
        <p className="mb-2 text-xs font-medium text-amber-700 dark:text-amber-300">{historicalItemLabel(norma)}</p>
      )}
      {(display?.textVisible ?? true) && (
        <ArticleBody
          contentRef={contentRef}
          itemKey={itemKey}
          processedContent={markedHtml}
          onPopupHighlight={handlePopupHighlight}
          onPopupAddNote={(text, startOffset, rect) => {
            if (readOnly) return;
            setComposer({ rect, anchorText: text, startOffset });
          }}
          onPopupCopy={handlePopupCopy}
          updatesOpen={updatesOpen}
          copyOnly={readOnly}
        />
      )}
      <LooseHighlightsList highlights={looseHighlights} articleId={uniqueArticleId} onRemove={removeHighlight} />
      {openNote && structure.notes[openNote.id] && (
        <UpdateNotePopover
          noteId={openNote.id}
          paragraphs={getUpdateNoteParagraphs(rawText, structure.notes[openNote.id])}
          anchorEl={openNote.anchorEl}
          onClose={closeNote}
        />
      )}
      {openBlock !== null && hasAnnotations(openGroup) && (
        <BlockAnnotationsPopover
          key={openBlock}
          containerRef={contentRef}
          blockIndex={openBlock}
          blockLabel={describeBlock(rawText, structure.blocks[openBlock])}
          group={openGroup}
          contentKey={markedHtml}
          onClose={closeBlock}
          onUpdateNote={updateAnnotation}
          onRemoveNote={removeAnnotation}
          onRemoveHighlight={removeHighlight}
        />
      )}
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
      {inlineNote && (
        <InlineNotePopover
          note={inlineNote.note}
          anchorEl={inlineNote.anchorEl}
          onClose={() => setInlineNote(null)}
          onUpdate={updateAnnotation}
          onRemove={removeAnnotation}
        />
      )}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
        <button
          type="button"
          onClick={handleCopyCitation}
          disabled={citeLocked}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
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
