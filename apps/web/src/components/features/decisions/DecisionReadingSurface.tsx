import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import { useCitationPreview } from '../../../hooks/useCitationPreview';
import { useCitationLinks } from '../../../hooks/useCitationLinks';
import { CitationPreviewPopup } from '../../ui/CitationPreviewPopup';
import { Toast, type ToastProps } from '../../ui/Toast';
import { ArticleBody } from '../search/ArticleBody';
import { NotesPeekPanel } from '../search/NotesPeekPanel';
import { HighlightsActionsPicker } from '../search/HighlightsActionsPicker';
import { InlineNotePopover } from '../search/InlineNotePopover';
import { InlineNoteComposer } from '../search/InlineNoteComposer';
import { BlockAnnotationsPopover } from '../search/BlockAnnotationsPopover';
import { ArticleDiscussionPanel } from '../search/ArticleDiscussionPanel';
import { PassageThreadsStatus } from '../search/PassageThreadsStatus';
import { DecisionReadingToolbar } from './DecisionReadingToolbar';
import { UnmatchedAnchors } from './UnmatchedAnchors';
import { useAnnotationActions } from '../../../hooks/useAnnotationActions';
import { useInlineNoteAnchors } from '../../../hooks/useInlineNoteAnchors';
import { useArticleTextInteractions } from '../../../hooks/useArticleTextInteractions';
import { describeBlock, groupAnnotationsByBlock, hasAnnotations } from '../../../utils/articleAnnotations';
import { useDiscussionWiring } from '../../../hooks/useDiscussionWiring';
import type { DecisionAttributes, DecisionIdentity, DecisionText } from '../../../types/decisions';
import { wrapCitationsInHtml, type ParsedCitationData } from '../../../utils/citationMatcher';
import { decisionKey, formatDecisionCitation, formatDecisionShort } from '../../../utils/decisionLinks';
import { decisionProjection, decisionStructure, renderDecisionHtml, unmatchedAnchors } from '../../../utils/decisionRender';
import { downloadTxt, highlightsTxt, notesTxt, slugify } from '../../../utils/annotationExport';
import { selectionAsRead } from '../../../utils/decisionText';
import type { ReadingBackEntry } from '../../../utils/readingBackStack';

// A decision's anchors are stored under its key with no article: the wire key is `<key>::art::`.
const NO_ARTICLE = '';

export interface DecisionReadingSurfaceProps {
  identity: DecisionIdentity;
  testo: DecisionText;
  attributi: DecisionAttributes;
  /**
   * The workspace tab this decision is read in. With it, a norm opened from a citation is placed
   * beside that tab and the way back names it; without it (a host with no tab, such as a light
   * window) the norm opens through the ordinary search and nothing is recorded.
   */
  hostTabId?: string;
}

/**
 * A decision's text on the reading surface: the same structured rendering as an article's
 * (`renderDecisionHtml` inside `ArticleBody`), with the norms it cites as links that open beside
 * it. Self-contained: it takes the decision as props and reaches only the store's search and
 * way-back actions, so any host can mount it.
 */
export function DecisionReadingSurface({ identity, testo, attributi, hostTabId }: DecisionReadingSurfaceProps) {
  const {
    triggerSearch, pushReadingBack, annotations, highlights, removeAnnotation, updateAnnotation,
    removeHighlight, loadAnnotationsForArticle, loadHighlightsForArticle,
  } = useAppStore(useShallow((s) => ({
    triggerSearch: s.triggerSearch,
    pushReadingBack: s.pushReadingBack,
    annotations: s.annotations,
    highlights: s.highlights,
    removeAnnotation: s.removeAnnotation,
    updateAnnotation: s.updateAnnotation,
    removeHighlight: s.removeHighlight,
    loadAnnotationsForArticle: s.loadAnnotationsForArticle,
    loadHighlightsForArticle: s.loadHighlightsForArticle,
  })));
  const contentRef = useRef<HTMLDivElement>(null);
  const isHoveringPopupRef = useRef(false);
  const preview = useCitationPreview();
  const { showPreview, hidePreview } = preview;

  const key = decisionKey(identity);
  const sezione = attributi.sezione;
  const label = formatDecisionShort({ ...identity, sezione });

  // The reader's marks are fetched once per decision, as an article's are.
  useEffect(() => {
    loadHighlightsForArticle(key, NO_ARTICLE);
    loadAnnotationsForArticle(key, NO_ARTICLE);
  }, [key, loadHighlightsForArticle, loadAnnotationsForArticle]);

  const decisionNotes = useMemo(
    () => annotations.filter((a) => a.normaKey === key && a.articleId === NO_ARTICLE),
    [annotations, key],
  );
  const decisionHighlights = useMemo(
    () => highlights.filter((h) => h.normaKey === key && h.articleId === NO_ARTICLE),
    [highlights, key],
  );

  const plain = useMemo(() => decisionProjection(testo), [testo]);
  const structure = useMemo(() => decisionStructure(testo), [testo]);

  // Discussions: this surface is mounted for a decision whose identity was found, so it always
  // takes them. The anchor is one stable object (the panel reloads when its fields change).
  const discussionAnchor = useMemo(() => ({ normaKey: key, articleId: NO_ARTICLE, articleLabel: label }), [key, label]);
  const discussion = useDiscussionWiring({
    anchor: discussionAnchor,
    // The projection has no newline, so its fingerprint is the SHA-256 of the projection itself.
    text: plain,
    plain,
    enabled: plain !== '',
    contentRef,
    onInvalidSelection: () => setToast({ message: 'Non è possibile aprire una discussione su questa selezione', type: 'error' }),
  });
  const { locatedThreads, textHash, focusedThreadId } = discussion;

  // A bare «art. 5» with no act named stays text: a decision has no act of its own to default to.
  const html = useMemo(
    () => wrapCitationsInHtml(renderDecisionHtml({
      testo, highlights: decisionHighlights, annotations: decisionNotes, signs: true,
      threads: locatedThreads, focusedThreadId,
    })),
    [testo, decisionHighlights, decisionNotes, locatedThreads, focusedThreadId],
  );

  // What each paragraph's sign counts, for the popover it opens (the renderer derives the signs
  // from the same structure through the same module).
  const blockGroups = useMemo(
    () => groupAnnotationsByBlock(plain, structure, decisionHighlights, decisionNotes, locatedThreads),
    [plain, structure, decisionHighlights, decisionNotes, locatedThreads],
  );
  const { openBlock, closeBlock } = useArticleTextInteractions(contentRef, key, { contentKey: html });
  const openGroup = openBlock === null ? undefined : blockGroups[openBlock];

  // What no longer lands is listed under the text (a free note has no anchor: the panel holds it).
  const lost = useMemo(
    () => unmatchedAnchors(testo, decisionHighlights, decisionNotes),
    [testo, decisionHighlights, decisionNotes],
  );

  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [notesButtonEl, setNotesButtonEl] = useState<HTMLButtonElement | null>(null);
  const [isHighlightsOpen, setIsHighlightsOpen] = useState(false);
  const [highlightsButtonEl, setHighlightsButtonEl] = useState<HTMLButtonElement | null>(null);
  const [highlightsHidden, setHighlightsHidden] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastProps['type'] } | null>(null);

  useEffect(() => {
    contentRef.current?.classList.toggle('highlights-hidden', highlightsHidden);
  }, [highlightsHidden]);

  const origin = useMemo<ReadingBackEntry | undefined>(
    () => hostTabId ? { tabId: hostTabId, blockId: hostTabId, articleId: '', label } : undefined,
    [hostTabId, label],
  );

  const openCitation = useCallback((citation: ParsedCitationData) => {
    triggerSearch({
      act_type: citation.act_type,
      act_number: citation.act_number || '',
      date: citation.date || '',
      article: citation.article,
      version: 'vigente',
      show_brocardi_info: true,
      ...(hostTabId ? { besideTabId: hostTabId } : {}),
    });
  }, [triggerSearch, hostTabId]);

  useCitationLinks(contentRef, { onOpen: openCitation, origin, showPreview, hidePreview, isHoveringPopupRef });

  const showToast = (message: string, type: ToastProps['type']) => setToast({ message, type });
  const {
    noteAnchor, composerRect, clearAnchor, handlePopupHighlight, handlePopupAddNote, handleAddNote, closeComposer, commitComposer,
  } = useAnnotationActions({ key, articleId: NO_ARTICLE, highlights: decisionHighlights, showToast });
  const { inlineNote, closeInlineNote } = useInlineNoteAnchors(contentRef, decisionNotes);

  const exportSlug = slugify(key) || 'decisione';
  const exportNotes = () => {
    if (decisionNotes.length === 0) return setToast({ message: 'Nessuna nota da esportare', type: 'info' });
    downloadTxt(notesTxt(formatDecisionCitation(identity, attributi), decisionNotes), `note-${exportSlug}`);
    setToast({ message: `Esportate ${decisionNotes.length} note`, type: 'success' });
  };
  const exportHighlights = () => {
    if (decisionHighlights.length === 0) return setToast({ message: 'Nessuna evidenziazione da esportare', type: 'info' });
    downloadTxt(highlightsTxt(formatDecisionCitation(identity, attributi), decisionHighlights), `evidenziazioni-${exportSlug}`);
    setToast({ message: `Esportate ${decisionHighlights.length} evidenziazioni`, type: 'success' });
  };

  // The selection popup's "Copia" reads the selection as the text reads (no «ordinanzadel»).
  const copySelection = useCallback(async (shown: string) => {
    const root = contentRef.current;
    const text = (root && selectionAsRead(root)) || shown;
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('copying the selection failed', error);
    }
  }, []);

  return (
    <div
      onCopy={(event) => {
        const text = contentRef.current && selectionAsRead(contentRef.current);
        if (!text) return;
        event.clipboardData.setData('text/plain', text);
        event.preventDefault();
      }}
    >
      <DecisionReadingToolbar
        notesCount={decisionNotes.length}
        highlightsCount={decisionHighlights.length}
        isNotesOpen={isNotesOpen}
        isHighlightsOpen={isHighlightsOpen}
        notesButtonRef={setNotesButtonEl}
        highlightsButtonRef={setHighlightsButtonEl}
        onToggleNotes={() => setIsNotesOpen((v) => !v)}
        onToggleHighlights={() => setIsHighlightsOpen((v) => !v)}
        isDiscussionOpen={discussion.open}
        onToggleDiscussion={discussion.toggle}
      />
      <NotesPeekPanel
        isOpen={isNotesOpen}
        anchorEl={notesButtonEl}
        annotations={decisionNotes}
        articleLabel={label}
        noteAnchor={noteAnchor}
        onClose={() => setIsNotesOpen(false)}
        onAddNote={handleAddNote}
        onUpdateNote={updateAnnotation}
        onRemoveNote={removeAnnotation}
        onClearAnchor={clearAnchor}
        onExportTxt={exportNotes}
        emptyText="Nessuna nota su questa decisione."
      />
      <HighlightsActionsPicker
        isOpen={isHighlightsOpen}
        anchorEl={highlightsButtonEl}
        highlightsCount={decisionHighlights.length}
        highlightsHidden={highlightsHidden}
        onClose={() => setIsHighlightsOpen(false)}
        onToggleVisibility={() => setHighlightsHidden((v) => !v)}
        onExportTxt={exportHighlights}
      />
      {inlineNote && (
        <InlineNotePopover
          note={inlineNote.note}
          anchorEl={inlineNote.anchorEl}
          onClose={closeInlineNote}
          onUpdate={updateAnnotation}
          onRemove={removeAnnotation}
        />
      )}
      {composerRect && noteAnchor && (
        <InlineNoteComposer
          anchorRect={composerRect}
          anchorText={noteAnchor.anchorText}
          onSave={commitComposer}
          onClose={closeComposer}
        />
      )}
      <ArticleBody
        contentRef={contentRef}
        itemKey={key}
        processedContent={html}
        className="vlx-art vlx-decision"
        onPopupHighlight={handlePopupHighlight}
        onPopupAddNote={handlePopupAddNote}
        onPopupCopy={copySelection}
        onPopupDiscuss={discussion.popupDiscuss}
      />
      {!discussion.open && (
        <PassageThreadsStatus error={discussion.error} loading={discussion.loading} onRetry={discussion.reload} />
      )}
      <UnmatchedAnchors
        highlights={lost.highlights}
        annotations={lost.annotations}
        reason="changed"
        onRemoveHighlight={removeHighlight}
        onRemoveAnnotation={removeAnnotation}
      />
      {openBlock !== null && hasAnnotations(openGroup) && (
        <BlockAnnotationsPopover
          key={openBlock}
          containerRef={contentRef}
          blockIndex={openBlock}
          blockLabel={describeBlock(plain, structure.blocks[openBlock])}
          group={openGroup}
          contentKey={html}
          textHash={textHash}
          onOpenThread={discussion.openThread}
          onClose={closeBlock}
          onUpdateNote={updateAnnotation}
          onRemoveNote={removeAnnotation}
          onRemoveHighlight={removeHighlight}
        />
      )}
      <ArticleDiscussionPanel
        anchor={discussionAnchor}
        label={label}
        heading="Discussioni sulla decisione"
        textChangedNotice="Il testo della decisione è cambiato da quando è stata aperta questa discussione."
        detachedPassageNotice="Il passo citato non è più nel testo della decisione."
        textUnavailableNotice="Il passo citato non è mostrato: il testo della decisione non è disponibile."
        withholdDetachedPassage
        {...discussion.panelProps}
      />
      {toast && <Toast message={toast.message} type={toast.type} isVisible onClose={() => setToast(null)} />}
      <CitationPreviewPopup
        isVisible={preview.isVisible}
        isLoading={preview.isLoading}
        error={preview.error}
        citation={preview.citation}
        article={preview.article}
        position={preview.position}
        onClose={hidePreview}
        onOpenInTab={(citation) => {
          // the popup's own button is a jump like a click: the way back is recorded the same
          if (origin) pushReadingBack(origin);
          openCitation(citation);
        }}
        onMouseEnter={() => { isHoveringPopupRef.current = true; }}
        onMouseLeave={() => {
          isHoveringPopupRef.current = false;
          hidePreview();
        }}
      />
    </div>
  );
}
