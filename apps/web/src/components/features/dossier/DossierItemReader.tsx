import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { RefreshCw, Copy, ExternalLink, Link2 } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { useArticleMarkers } from '../../../hooks/useArticleMarkers';
import { useArticleTextInteractions } from '../../../hooks/useArticleTextInteractions';
import { useHighlightInk } from '../../../hooks/useHighlightInk';
import { ArticleBody } from '../search/ArticleBody';
import { UpdateNotePopover } from '../search/UpdateNotePopover';
import { BlockAnnotationsSheet } from '../search/BlockAnnotationsSheet';
import { LooseHighlightsList } from '../search/LooseHighlightsList';
import { MoveProposalBar } from '../search/MoveProposalBar';
import { LostGlossesList, LostProposalsList } from '../search/LostProposalsList';
import { AnnotationMargin, type AnnotationMarginHandle, type NoteDraft } from '../search/AnnotationMargin';
import { buildItemKey, uniqueArticleIdFromNorma } from '../../../utils/normaKeys';
import { formatNormCitation, unversionedCitation, withCitation } from '../../../utils/citation';
import { todayInRome } from '../../../utils/dateUtils';
import { copyNormLink, EUROPEAN_LINK_NOTE, linkPinDay, normLink, normLinkActionLabel, normLinkToast } from '../../../utils/normattivaLink';
import { describeVersion, historicalItemLabel, isEuropeanAct, requestIsHistorical } from '../../../utils/versionDisplay';
import { VersionBanner } from '../search/VersionBanner';
import { HighlighterButton } from '../search/HighlighterButton';
import { NoteToolButton } from '../search/NoteToolButton';
import { fetchArticleForNorma } from '../../../utils/articleFetchCache';
import { getUpdateNoteParagraphs, parseArticleStructure } from '../../../utils/articleStructure';
import { blockStarts, describeBlock, groupAnnotationsByBlock, highlightsWithoutSign, isProposal as isProposalMark } from '../../../utils/articleAnnotations';
import type { Annotation, ArticleData, Highlight, NormaVisitata } from '../../../types';
import { useEntryProposals } from '../../../hooks/useEntryProposals';
import { useGlossPassage } from '../../../hooks/useGlossPassage';
import { useNoteOpener, useSignTarget } from '../../../hooks/useSignTarget';
import { useInlineNoteAnchors } from '../../../hooks/useInlineNoteAnchors';
import { isGloss } from '../../../utils/aiReview';
import { GLOSS_WORDS } from '../../../constants/glossWords';

interface Props {
  norma: NormaVisitata;
  onOpenOnDashboard: () => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  /** The fetched article, for a row that takes its rubrica from the text when the act's index gave none. */
  onArticle?: (article: ArticleData) => void;
  /** The dossier entry it reads: what an application proposed on it is drawn here, and only here (D7b). */
  itemId?: string;
  /**
   * The gear beside the colour, to the colours' meanings in Impostazioni (default). Left out inside a phone's sheet (the
   * lesson's article), which keeps the focus inside it: a dialog opened over it would have to fight it for the focus.
   */
  meaningsGear?: boolean;
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
export function DossierItemReader({ norma, onOpenOnDashboard, showToast, onArticle, itemId, meaningsGear = true }: Props) {
  const [result, setResult] = useState<FetchResult | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  // The text alone (without the selection popup): a passage's new words are read there (D7b).
  const textRootRef = useRef<HTMLDivElement>(null);
  // A new note being written (A4 §6): beside the text where it has room, else in a sheet from the bottom.
  const [draft, setDraft] = useState<NoteDraft | null>(null);

  const itemKey = useMemo(() => buildItemKey(norma), [norma]);
  const uniqueArticleId = useMemo(() => uniqueArticleIdFromNorma(norma), [norma]);

  const {
    annotations, highlights,
    addAnnotation, updateAnnotation, removeAnnotation,
    removeHighlight,
    loadAnnotationsForArticle, loadHighlightsForArticle,
  } = useAppStore(useShallow((s) => ({
    annotations: s.annotations, highlights: s.highlights,
    addAnnotation: s.addAnnotation,
    updateAnnotation: s.updateAnnotation,
    removeAnnotation: s.removeAnnotation,
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
  const display = article ? describeVersion(article.validity, norma, article.upcoming) : null;
  const readOnly = display?.readOnly ?? false;
  const historical = requestIsHistorical(norma);
  const citeLocked = historical && !display?.canCite;
  const citationNow = () => (display?.canCite
    ? formatNormCitation({
      norma,
      validity: display?.citeAs ?? article?.validity,
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

  // What an application proposed on this entry (D7b): its own route, its own store, never the app's highlights. Its
  // glosses (D8) are counted on the signs and shown beside the text, never drawn in it.
  const {
    highlights: proposalHighlights, glosses, glossAnchors, actions: proposalActions, moving, saveMove, cancelMove,
  } = useEntryProposals(itemId, itemKey, uniqueArticleId, readOnly);
  const withProposals = useMemo(
    () => (proposalHighlights.length ? [...articleHighlights, ...proposalHighlights] : articleHighlights),
    [articleHighlights, proposalHighlights],
  );
  const shownHighlights = readOnly ? NO_HIGHLIGHTS : withProposals;
  const shownAnnotations = readOnly ? NO_ANNOTATIONS : itemAnnotations;
  const markedHtml = useArticleMarkers({
    rawText, highlights: shownHighlights, annotations: shownAnnotations, structure, signs: !readOnly, glosses: glossAnchors,
  });
  // What each block's sign counts, for the popover it opens (the renderer
  // derives the signs from the same inputs, through the same module).
  const blockGroups = useMemo(
    () => groupAnnotationsByBlock(rawText, structure, shownHighlights, shownAnnotations, [], glossAnchors),
    [rawText, structure, shownHighlights, shownAnnotations, glossAnchors],
  );
  const plain = useMemo(() => rawText.replace(/\n/g, ''), [rawText]);
  // A gloss whose words are in no block (they changed): listed under the text with its actions, as a lost proposal.
  const lostGlosses = useMemo(() => {
    if (glosses.length === 0) return glosses;
    const shown = new Set(blockGroups.flatMap((g) => g.glosses.map((a) => a.id)));
    return glosses.filter((g) => !shown.has(g.id));
  }, [glosses, blockGroups]);
  const { shownId: shownGlossId, show: showGloss, hide: hideGloss } = useGlossPassage(textRootRef, plain, glossAnchors, markedHtml);
  const showGlossPassage = useCallback(
    (id: string, show: boolean) => (show ? showGloss(id) : hideGloss(id)),
    [showGloss, hideGloss],
  );
  const marginRef = useRef<AnnotationMarginHandle>(null);
  const [marginShown, setMarginShown] = useState(false);
  // Highlights no sign can reach (their text changed): still removable. A proposal whose words no longer land has a
  // list of its own, at every width, with its note and its actions (D7b).
  const looseHighlights = useMemo(
    () => (readOnly ? NO_HIGHLIGHTS : highlightsWithoutSign(articleHighlights, blockGroups)),
    [readOnly, articleHighlights, blockGroups],
  );
  const lostProposals = useMemo(
    () => highlightsWithoutSign(proposalHighlights, blockGroups).filter(isProposalMark),
    [proposalHighlights, blockGroups],
  );
  // Update-note references, the foldable AGGIORNAMENTO tail and the
  // annotation signs, as on the dashboard. `enabled` waits for the body: it
  // exists only once the fetch settles.
  const { updatesOpen, openNote, closeNote, openBlock, blockAll, closeBlock, openBlockAt } = useArticleTextInteractions(contentRef, itemKey, {
    enabled: isReady,
    contentKey: markedHtml,
    // A past text opens its notes (the rule that applies is often in them); the toggle still folds them.
    updatesOpenByDefault: display?.updateNotesOpen ?? false,
  });
  const openGroup = openBlock === null ? undefined : blockGroups[openBlock];
  // The sign (A4 §6): the block's first card beside the text, else its sheet.
  const sheetOpen = useSignTarget({ openBlock, blockAll, group: openGroup, marginShown, marginRef, closeBlock, openBlockAt });

  // A note's wavy words, clicked: its card beside the text, else its block's sheet (A4 §6, no popover). `isReady`: the
  // body (and therefore contentRef) only exists once the fetch settles, so the listener is attached on that transition.
  const openNoteBeside = useNoteOpener(marginRef, openBlockAt);
  useInlineNoteAnchors(contentRef, itemAnnotations, openNoteBeside, isReady);

  // The words selected and the ink, through the highlighter's rules (A4): a new highlight, or the same words taken away
  // or recoloured, as in every reader. Only the user's own highlights: an application's passages are left alone.
  const handlePopupHighlight = useHighlightInk({
    key: itemKey, articleId: uniqueArticleId, plain, breaks: () => blockStarts(rawText, structure), enabled: !readOnly,
  });

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

  // «Copia link Normattiva»: the address the API returned for this text (its version marker
  // with it), the stored one only if the answer had none. Locked where «Copia citazione» is.
  const linkUrn = article?.norma_data?.urn || norma.urn;
  const hasLink = useMemo(() => normLink({ ...norma, urn: linkUrn }, null) !== null, [norma, linkUrn]);
  const european = isEuropeanAct(norma.tipo_atto);
  const handleCopyLink = async () => {
    if (display && !display.canCopyOrSave) {
      showToast(display.copyBlockedReason ?? '', 'info');
      return;
    }
    const pinDay = linkPinDay(norma, display?.citeAs ?? article?.validity, todayInRome());
    const link = normLink({ ...norma, urn: linkUrn }, citationNow(), pinDay);
    if (!link) return;
    try {
      await copyNormLink(link);
      showToast(normLinkToast(link), 'success');
    } catch {
      showToast('Errore durante la copia del link', 'error');
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
        <AnnotationMargin
          ref={marginRef}
          plain={plain}
          textRootRef={textRootRef}
          contentKey={markedHtml}
          notes={shownAnnotations}
          onUpdateNote={updateAnnotation}
          onRemoveNote={removeAnnotation}
          draft={draft}
          onSaveDraft={(text) => {
            if (!draft) return;
            addAnnotation(itemKey, uniqueArticleId, text, { anchorText: draft.text, startOffset: draft.startOffset });
            setDraft(null);
            showToast('Nota aggiunta', 'success');
          }}
          onCancelDraft={() => setDraft(null)}
          glosses={glosses}
          glossActions={proposalActions}
          shownGlossId={shownGlossId}
          onShowGlossPassage={showGlossPassage}
          onWideChange={setMarginShown}
        >
          <ArticleBody
            contentRef={contentRef}
            itemKey={itemKey}
            processedContent={markedHtml}
            onPopupHighlight={handlePopupHighlight}
            onPopupAddNote={(text, startOffset) => {
              // A note being written keeps its words: a new selection refocuses it (the note tool takes every one).
              if (readOnly || marginRef.current?.keepDraft()) return;
              setDraft({ text, startOffset });
            }}
            onPopupCopy={handlePopupCopy}
            updatesOpen={updatesOpen}
            copyOnly={readOnly}
            textRootRef={textRootRef}
            selectionPopup={!moving}
          />
        </AnnotationMargin>
      )}
      {moving && (
        <MoveProposalBar
          key={moving.id}
          textRootRef={textRootRef}
          proposalId={moving.id}
          startOffset={moving.startOffset}
          text={moving.text}
          onSave={saveMove}
          onCancel={cancelMove}
          label={isGloss(moving) ? GLOSS_WORDS.moveTitle : undefined}
          focusAfter={isGloss(moving) ? () => marginRef.current?.focus([`gloss:${moving.id}`]) ?? false : undefined}
        />
      )}
      <LooseHighlightsList highlights={looseHighlights} articleId={uniqueArticleId} onRemove={removeHighlight} />
      {proposalActions && <LostProposalsList proposals={lostProposals} actions={proposalActions} />}
      {proposalActions && <LostGlossesList glosses={lostGlosses} actions={proposalActions} />}
      {openNote && structure.notes[openNote.id] && (
        <UpdateNotePopover
          noteId={openNote.id}
          paragraphs={getUpdateNoteParagraphs(rawText, structure.notes[openNote.id])}
          anchorEl={openNote.anchorEl}
          onClose={closeNote}
        />
      )}
      {sheetOpen && openBlock !== null && openGroup && (
        <BlockAnnotationsSheet
          key={openBlock}
          containerRef={contentRef}
          blockIndex={openBlock}
          blockLabel={describeBlock(rawText, structure.blocks[openBlock])}
          group={openGroup}
          onClose={closeBlock}
          onUpdateNote={updateAnnotation}
          onRemoveNote={removeAnnotation}
          onRemoveHighlight={removeHighlight}
          proposalActions={proposalActions}
          glosses={glosses}
          shownGlossId={shownGlossId}
          onShowGlossPassage={showGlossPassage}
        />
      )}
      <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
        <button
          type="button"
          onClick={handleCopyCitation}
          disabled={citeLocked}
          className="inline-flex min-h-[44px] md:min-h-0 items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Copy size={13} /> Copia citazione
        </button>
        {hasLink && (
          <button
            type="button"
            onClick={handleCopyLink}
            disabled={citeLocked}
            title={european ? EUROPEAN_LINK_NOTE : 'L’indirizzo dell’articolo su Normattiva; incollato in Word, la citazione con il collegamento'}
            className="inline-flex min-h-[44px] md:min-h-0 items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Link2 size={13} aria-hidden /> {normLinkActionLabel(norma)}
          </button>
        )}
        <button
          type="button"
          onClick={onOpenOnDashboard}
          className="inline-flex min-h-[44px] md:min-h-0 items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <ExternalLink size={13} /> Apri su Dashboard
        </button>
        {/* The highlighter (H1, A4): the dossier's reader has no bar of its own, so it sits with its actions; not on a text
            read only, which takes none. */}
        {!readOnly && (
          <HighlighterButton
            meaningsGear={meaningsGear}
            placement="auto"
            className="ml-auto"
            triggerClassName="min-h-[44px] gap-1.5 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 md:min-h-0 dark:text-slate-400 dark:hover:bg-slate-700"
          />
        )}
        {!readOnly && (
          <NoteToolButton triggerClassName="min-h-[44px] gap-1.5 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 md:min-h-0 dark:text-slate-400 dark:hover:bg-slate-700" />
        )}
      </div>
    </div>
  );
}
