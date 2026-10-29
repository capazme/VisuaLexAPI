import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import { useCitationPreview } from '../../../hooks/useCitationPreview';
import { useCitationLinks } from '../../../hooks/useCitationLinks';
import { useDecisionLinks } from '../../../hooks/useDecisionLinks';
import { CitationPreviewPopup } from '../../ui/CitationPreviewPopup';
import { DecisionPreviewPopup } from '../../ui/DecisionPreviewPopup';
import { Toast, type ToastProps } from '../../ui/Toast';
import { ArticleBody } from '../search/ArticleBody';
import { closeFindWindow, openFindWindow } from '../../../utils/findWindowControl';
import { useFindWindowScopedTo } from '../../../hooks/useFindWindowScopedTo';
import { NotesPeekPanel } from '../search/NotesPeekPanel';
import { HighlightsActionsPicker } from '../search/HighlightsActionsPicker';
import { InlineNotePopover } from '../search/InlineNotePopover';
import { InlineNoteComposer } from '../search/InlineNoteComposer';
import { BlockAnnotationsPopover } from '../search/BlockAnnotationsPopover';
import { ArticleDiscussionPanel } from '../search/ArticleDiscussionPanel';
import { PassageThreadsStatus } from '../search/PassageThreadsStatus';
import { DecisionReadingToolbar } from './DecisionReadingToolbar';
import { UnmatchedAnchors } from './UnmatchedAnchors';
import { LostGlossesList, LostProposalsList } from '../search/LostProposalsList';
import { MoveProposalBar } from '../search/MoveProposalBar';
import { GlossMargin, type GlossMarginHandle } from '../search/GlossMargin';
import { useEntryProposals } from '../../../hooks/useEntryProposals';
import { useGlossPassage } from '../../../hooks/useGlossPassage';
import { isGloss } from '../../../utils/aiReview';
import { GLOSS_WORDS } from '../../../constants/glossWords';
import { useAnnotationActions } from '../../../hooks/useAnnotationActions';
import { useInlineNoteAnchors } from '../../../hooks/useInlineNoteAnchors';
import { useArticleTextInteractions } from '../../../hooks/useArticleTextInteractions';
import { useRegisterFindRoot } from '../../../hooks/useRegisterFindRoot';
import { describeBlock, groupAnnotationsByBlock, hasAnnotations, isProposal as isProposalMark } from '../../../utils/articleAnnotations';
import { useDiscussionWiring } from '../../../hooks/useDiscussionWiring';
import type { DecisionAttributes, DecisionIdentity, DecisionText } from '../../../types/decisions';
import { wrapCitationsInHtml, type ParsedCitationData } from '../../../utils/citationMatcher';
import { wrapDecisionCitationsInHtml } from '../../../utils/decisionCitationMatcher';
import { decisionKey, decisionPath, formatDecisionCitation, formatDecisionShort } from '../../../utils/decisionLinks';
import { decisionProjection, decisionStructure, renderDecisionHtml, unmatchedAnchors } from '../../../utils/decisionRender';
import { downloadTxt, highlightsTxt, notesTxt, slugify } from '../../../utils/annotationExport';
import { selectionAsRead } from '../../../utils/decisionText';
import type { ReadingBackEntry } from '../../../utils/readingBackStack';
import { keyPassages } from '../../../utils/decisionKeyPassages';
import { KeyPassagePopover } from './KeyPassagePopover';
import { KeyPassagesMenu } from './KeyPassagesMenu';
import { scrollToMiddle } from '../../../utils/scrollParent';

// A decision's anchors are stored under its key with no article: the wire key is `<key>::art::`.
const NO_ARTICLE = '';

/** A host that holds norms of its own (the dossier, D7d): the norms the text cites are its to open. */
export interface CitedNorms {
  /** Whether the host holds the norm: the preview's button then says «Apri tra le norme», else «Apri su Dashboard». */
  holds: (citation: ParsedCitationData) => boolean;
  /** A click on a cited norm, with the link clicked; the preview's button, with none. */
  open: (citation: ParsedCitationData, link: HTMLElement | null) => void;
}

export interface DecisionReadingSurfaceProps {
  identity: DecisionIdentity;
  testo: DecisionText;
  attributi: DecisionAttributes;
  /**
   * The host this decision is read in: a practice (its row) or a window. With it, a norm opened from
   * a citation is placed beside that host and the way back names it; without it the norm opens
   * through the ordinary search and nothing is recorded.
   */
  hostTabId?: string;
  /**
   * The place inside the host the way back returns to; the host itself when absent. A decision read
   * in a row of a practice's table names its entry, so going back reveals that row.
   */
  hostBlockId?: string;
  /**
   * The id the find window knows this decision's reading place by, when it is not `hostTabId`: a
   * light window reads under its own id (its way back) and is found under its practice's (spec
   * §6.6). Only the find window's registration, pressed state and opener read it.
   */
  findHostId?: string;
  /**
   * A norm or a decision the text cites was sent to the workspace (a search, a decision's window): a host off the
   * search page (the dossier) goes there, where it is drawn. Without it nothing moves, as in the workspace, which is
   * that page.
   */
  onLeave?: () => void;
  /**
   * The cited norms go to the host instead of a search (the dossier, D7d): it opens one it holds where it is, and
   * offers the rest. The text and its links are the same either way (gotcha 23).
   */
  citedNorms?: CitedNorms;
  /**
   * The dossier entry it is read in (D7b): what an application proposed on that entry is drawn and acted on here, and
   * only here; never in the decision's downloads.
   */
  dossierItemId?: string;
}

/**
 * A decision's text on the reading surface: the same structured rendering as an article's
 * (`renderDecisionHtml` inside `ArticleBody`), with the norms it cites as links that open beside
 * it. Self-contained: it takes the decision as props and reaches only the store's search and
 * way-back actions, so any host can mount it.
 */
export function DecisionReadingSurface({ identity, testo, attributi, hostTabId, hostBlockId, findHostId, onLeave, citedNorms, dossierItemId }: DecisionReadingSurfaceProps) {
  const {
    triggerSearch, pushReadingBack, annotations, highlights, removeAnnotation, updateAnnotation,
    removeHighlight, loadAnnotationsForArticle, loadHighlightsForArticle, showKeyPassages, updateSettings, highlightColor,
  } = useAppStore(useShallow((s) => ({
    showKeyPassages: s.settings.showKeyPassages,
    highlightColor: s.settings.highlightColor,
    updateSettings: s.updateSettings,
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

  // What an application proposed on the dossier entry (D7b): drawn with the reader's marks, never in their downloads.
  // Its glosses (D8) are counted on the signs and shown beside the text, never drawn in it.
  const {
    highlights: proposalHighlights, glosses, glossAnchors, actions: proposalActions, moving, saveMove, cancelMove,
  } = useEntryProposals(dossierItemId, key, NO_ARTICLE);
  const shownHighlights = useMemo(
    () => (proposalHighlights.length ? [...decisionHighlights, ...proposalHighlights] : decisionHighlights),
    [decisionHighlights, proposalHighlights],
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
    onInvalidSelection: () => setToast({ message: 'Non è possibile aprire una glossa su questa selezione', type: 'error' }),
  });
  const { locatedThreads, textHash, focusedThreadId } = discussion;

  // A bare «art. 5» with no act named stays text: a decision has no act of its own to default to.
  // The decisions it cites are linked after the norms; inside a Cassazione decision a section written
  // without its court reads as the Cassazione's, inside a Corte costituzionale decision «sentenza n. … del …»
  // as the Court's own, and the decision's own name links nowhere.
  const selfPath = decisionPath(identity);
  const within = identity.corte === 'cassazione' || identity.corte === 'corte_costituzionale' ? identity.corte : undefined;
  // The key passages (spec 2026-10-13-decision-key-passages-design): computed from the text, always
  // drawn and hidden by a class, so the switch does not redraw the text; never stored.
  const passages = useMemo(() => keyPassages(testo, identity.corte), [testo, identity.corte]);
  const html = useMemo(
    () => wrapDecisionCitationsInHtml(
      wrapCitationsInHtml(renderDecisionHtml({
        testo, highlights: shownHighlights, annotations: decisionNotes, signs: true,
        threads: locatedThreads, focusedThreadId, keyPassages: passages, glosses: glossAnchors,
      })),
      { within, selfPath },
    ),
    [testo, shownHighlights, decisionNotes, locatedThreads, focusedThreadId, within, selfPath, passages, glossAnchors],
  );

  // What each paragraph's sign counts, for the popover it opens (the renderer derives the signs
  // from the same structure through the same module).
  const blockGroups = useMemo(
    () => groupAnnotationsByBlock(plain, structure, shownHighlights, decisionNotes, locatedThreads, glossAnchors),
    [plain, structure, shownHighlights, decisionNotes, locatedThreads, glossAnchors],
  );
  const { openBlock, closeBlock } = useArticleTextInteractions(contentRef, key, { contentKey: html });
  const openGroup = openBlock === null ? undefined : blockGroups[openBlock];
  // A gloss whose words are in no paragraph (the text changed): listed under the text with its actions.
  const lostGlosses = useMemo(() => {
    if (glosses.length === 0) return glosses;
    const shown = new Set(blockGroups.flatMap((g) => g.glosses.map((a) => a.id)));
    return glosses.filter((g) => !shown.has(g.id));
  }, [glosses, blockGroups]);
  const marginRef = useRef<GlossMarginHandle>(null);
  const [glossesWide, setGlossesWide] = useState(false);
  // As it was when the paragraph was opened: a popover open while the reader is resized keeps its cards.
  const [openedWide, setOpenedWide] = useState<{ block: number | null; wide: boolean }>({ block: null, wide: false });
  if (openedWide.block !== openBlock) setOpenedWide({ block: openBlock, wide: glossesWide });
  // Narrowed meanwhile, the cards are listed in the popover (the column is gone, «Vai alla glossa» would go nowhere);
  // widened, they stay there (one may be half edited).
  const inMargin = glossesWide && (openedWide.block === openBlock ? openedWide.wide : true);
  // With the glosses beside the text, a sign whose paragraph holds only glosses focuses the first one's card (D8).
  const onlyGlosses = !!openGroup && openGroup.glosses.length > 0
    && openGroup.notes.length + openGroup.highlights.length + openGroup.threads.length === 0;
  const focusCard = inMargin && onlyGlosses ? openGroup.glosses[0].id : null;
  useEffect(() => {
    if (!focusCard) return;
    // The column took the press: the focus goes to the card (a DOM write), and the paragraph is closed again.
    marginRef.current?.focus(focusCard);
    closeBlock();
  }, [focusCard, closeBlock]);

  // What no longer lands is listed under the text (a free note has no anchor: the panel holds it).
  // An application's proposal that no longer lands has a list of its own, with its note and its actions (D7b).
  const lost = useMemo(
    () => unmatchedAnchors(testo, decisionHighlights, decisionNotes),
    [testo, decisionHighlights, decisionNotes],
  );
  const lostProposals = useMemo(
    () => unmatchedAnchors(testo, proposalHighlights, []).highlights.filter(isProposalMark),
    [testo, proposalHighlights],
  );

  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [notesButtonEl, setNotesButtonEl] = useState<HTMLButtonElement | null>(null);
  const [isHighlightsOpen, setIsHighlightsOpen] = useState(false);
  const [highlightsButtonEl, setHighlightsButtonEl] = useState<HTMLButtonElement | null>(null);
  const [highlightsHidden, setHighlightsHidden] = useState(false);
  const findButtonRef = useRef<HTMLButtonElement>(null);
  const textRootRef = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastProps['type'] } | null>(null);
  const { shownId: shownGlossId, show: showGloss, hide: hideGloss } = useGlossPassage(textRootRef, plain, glossAnchors, html);
  const showGlossPassage = useCallback(
    (id: string, show: boolean) => (show ? showGloss(id) : hideGloss(id)),
    [showGloss, hideGloss],
  );

  // The find window's target for this decision (spec §13.1): one text, keyed by its own
  // `decisionKey`, the key the scope computes for a decision tab. No `hostTabId` (a host with no
  // tab) registers nothing.
  const findHost = findHostId ?? hostTabId;
  useRegisterFindRoot(findHost, key, label, textRootRef);
  const isFindOpen = useFindWindowScopedTo(findHost, key);

  useEffect(() => {
    contentRef.current?.classList.toggle('highlights-hidden', highlightsHidden);
  }, [highlightsHidden]);

  useEffect(() => {
    contentRef.current?.classList.toggle('key-passages-hidden', !showKeyPassages);
  }, [showKeyPassages]);

  // The passage whose popover is open, with the text it was opened on: a redraw (a highlight made
  // of it) replaces the element it sits by, so the popover goes with it.
  const [openPassage, setOpenPassage] = useState<{ index: number; el: HTMLElement; html: string } | null>(null);
  const shownPassage = openPassage && openPassage.html === html && openPassage.el.isConnected && showKeyPassages ? openPassage : null;
  useEffect(() => {
    const root = contentRef.current;
    if (!root || !showKeyPassages) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      // a link, a note's words, a sign or a reference keep their own click; words under a highlight are the
      // reader's, unless the highlights are hidden (then the passage shows again, and answers again)
      if (!target || target.closest('a, button, .citation-hover, .decision-cite, .note-anchor, .vlx-sign, .vlx-ref')) return;
      if (target.closest('.highlight-mark') && !root.classList.contains('highlights-hidden')) return;
      const piece = target.closest<HTMLElement>('[data-key-passage]');
      if (!piece || !root.contains(piece)) return;
      // the end of a selection is not a click on the passage
      if (window.getSelection()?.isCollapsed === false) return;
      setOpenPassage({ index: Number(piece.dataset.keyIndex), el: piece, html });
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, [showKeyPassages, html]);

  const goToPassage = (index: number) => {
    const piece = contentRef.current?.querySelector<HTMLElement>(`[data-key-index="${index}"]`);
    if (!piece) return;
    // at once, not smoothly: the popover opens on the passage already in view, and the keyboard's focus goes to it; the
    // scroller the text reads in alone (in the dossier's two columns the norms' column and the page stay put, D7d)
    scrollToMiddle(piece);
    const pieces = contentRef.current?.querySelectorAll<HTMLElement>(`[data-key-index="${index}"]`) ?? [];
    pieces.forEach((p) => p.classList.add('vlx-flash'));
    window.setTimeout(() => pieces.forEach((p) => p.classList.remove('vlx-flash')), 1600);
    setOpenPassage({ index, el: piece, html });
  };
  const hideKeyPassages = () => {
    updateSettings({ showKeyPassages: false });
    setToast({ message: 'Passaggi chiave nascosti: li riaccendi da «Passaggi chiave» nella barra', type: 'info' });
  };

  const origin = useMemo<ReadingBackEntry | undefined>(
    () => hostTabId ? { tabId: hostTabId, blockId: hostBlockId ?? hostTabId, articleId: '', label } : undefined,
    [hostTabId, hostBlockId, label],
  );

  const openCitation = useCallback((citation: ParsedCitationData, link: HTMLElement | null = null) => {
    if (citedNorms) return citedNorms.open(citation, link);
    triggerSearch({
      act_type: citation.act_type,
      act_number: citation.act_number || '',
      date: citation.date || '',
      article: citation.article,
      version: 'vigente',
      ...(hostTabId ? { besideId: hostTabId } : {}),
    });
    onLeave?.();
  }, [triggerSearch, hostTabId, onLeave, citedNorms]);

  const decisionLinks = useDecisionLinks({ besideId: hostTabId, origin, onOpened: onLeave });
  useCitationLinks(contentRef, { onOpen: openCitation, origin, showPreview, hidePreview, isHoveringPopupRef, decisions: decisionLinks.links });

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
        isFindOpen={isFindOpen}
        // No host, no find window: nothing of this text is registered for it to search (the dossier).
        onToggleFind={findHost ? (wasPressed) => (wasPressed ? closeFindWindow() : openFindWindow({ tabId: findHost, targetKey: key, returnFocus: findButtonRef.current })) : undefined}
        findButtonRef={findButtonRef}
        keyPassages={(
          <KeyPassagesMenu
            passages={passages}
            plain={plain}
            shown={showKeyPassages}
            onToggleShown={() => (showKeyPassages ? hideKeyPassages() : updateSettings({ showKeyPassages: true }))}
            onGoTo={goToPassage}
          />
        )}
      />
      {shownPassage && passages[shownPassage.index] && (
        <KeyPassagePopover
          kind={passages[shownPassage.index].kind}
          anchorEl={shownPassage.el}
          // the passage becomes a highlight of the reader's, through the ordinary action, in the colour chosen (H1)
          onMakeOwn={() => {
            const p = passages[shownPassage.index];
            handlePopupHighlight(plain.slice(p.start, p.end), highlightColor, p.start);
          }}
          onHideAll={hideKeyPassages}
          onClose={() => setOpenPassage(null)}
        />
      )}
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
      <GlossMargin
        ref={marginRef}
        glosses={glosses}
        plain={plain}
        actions={proposalActions}
        textRootRef={textRootRef}
        contentKey={html}
        shownId={shownGlossId}
        onShowPassage={showGlossPassage}
        onWideChange={setGlossesWide}
      >
        <ArticleBody
          contentRef={contentRef}
          textRootRef={textRootRef}
          itemKey={key}
          processedContent={html}
          className="vlx-art vlx-decision"
          onPopupHighlight={handlePopupHighlight}
          onPopupAddNote={handlePopupAddNote}
          onPopupCopy={copySelection}
          onPopupDiscuss={discussion.popupDiscuss}
          selectionPopup={!moving}
        />
      </GlossMargin>
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
          focusAfter={isGloss(moving) ? () => marginRef.current?.focus(moving.id) ?? false : undefined}
        />
      )}
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
      {proposalActions && <LostProposalsList proposals={lostProposals} actions={proposalActions} />}
      {proposalActions && <LostGlossesList glosses={lostGlosses} actions={proposalActions} />}
      {openBlock !== null && hasAnnotations(openGroup) && !focusCard && (
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
          proposalActions={proposalActions}
          glosses={glosses}
          glossesInMargin={inMargin}
          onGoToGloss={(id) => marginRef.current?.focus(id) ?? false}
          shownGlossId={shownGlossId}
          onShowGlossPassage={showGlossPassage}
        />
      )}
      <ArticleDiscussionPanel
        anchor={discussionAnchor}
        label={label}
        heading="Glosse sulla decisione"
        textChangedNotice="Il testo della decisione è cambiato da quando è stata aperta questa glossa."
        detachedPassageNotice="Il passo citato non è più nel testo della decisione."
        textUnavailableNotice="Il passo citato non è mostrato: il testo della decisione non è disponibile."
        withholdDetachedPassage
        {...discussion.panelProps}
      />
      {toast && <Toast message={toast.message} type={toast.type} isVisible onClose={() => setToast(null)} />}
      <DecisionPreviewPopup {...decisionLinks.popupProps} />
      <CitationPreviewPopup
        isVisible={preview.isVisible}
        isLoading={preview.isLoading}
        error={preview.error}
        citation={preview.citation}
        article={preview.article}
        position={preview.position}
        onClose={hidePreview}
        // In the dossier: «Apri tra le norme» for a norm it holds, else Dashboard, as the dossier's own buttons say.
        openLabel={citedNorms && preview.citation ? (citedNorms.holds(preview.citation) ? 'Apri tra le norme' : 'Apri su Dashboard') : undefined}
        onOpenCitation={(citation) => {
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
