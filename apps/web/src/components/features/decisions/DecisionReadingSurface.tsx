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
import { DecisionReadingToolbar } from './DecisionReadingToolbar';
import { UnmatchedAnchors } from './UnmatchedAnchors';
import { useArticleTextInteractions } from '../../../hooks/useArticleTextInteractions';
import { describeBlock, groupAnnotationsByBlock, hasAnnotations } from '../../../utils/articleAnnotations';
import type { Annotation } from '../../../types';
import type { DecisionAttributes, DecisionIdentity, DecisionText } from '../../../types/decisions';
import { wrapCitationsInHtml, type ParsedCitationData } from '../../../utils/citationMatcher';
import { decisionKey, formatDecisionCitation, formatDecisionShort } from '../../../utils/decisionLinks';
import { decisionProjection, decisionStructure, renderDecisionHtml, unmatchedAnchors } from '../../../utils/decisionRender';
import { selectionAsRead } from '../../../utils/decisionText';
import type { ReadingBackEntry } from '../../../utils/readingBackStack';

type Rect = { x: number; y: number; width: number; height: number };
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
    triggerSearch, pushReadingBack, annotations, highlights, addAnnotation, removeAnnotation, updateAnnotation,
    addHighlight, removeHighlight, loadAnnotationsForArticle, loadHighlightsForArticle,
  } = useAppStore(useShallow((s) => ({
    triggerSearch: s.triggerSearch,
    pushReadingBack: s.pushReadingBack,
    annotations: s.annotations,
    highlights: s.highlights,
    addAnnotation: s.addAnnotation,
    removeAnnotation: s.removeAnnotation,
    updateAnnotation: s.updateAnnotation,
    addHighlight: s.addHighlight,
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

  // A bare «art. 5» with no act named stays text: a decision has no act of its own to default to.
  const html = useMemo(
    () => wrapCitationsInHtml(renderDecisionHtml({ testo, highlights: decisionHighlights, annotations: decisionNotes, signs: true })),
    [testo, decisionHighlights, decisionNotes],
  );

  // What each paragraph's sign counts, for the popover it opens (the renderer derives the signs
  // from the same structure through the same module).
  const blockGroups = useMemo(
    () => groupAnnotationsByBlock(plain, structure, decisionHighlights, decisionNotes),
    [plain, structure, decisionHighlights, decisionNotes],
  );
  const { openBlock, closeBlock } = useArticleTextInteractions(contentRef, key, { contentKey: html });
  const openGroup = openBlock === null ? undefined : blockGroups[openBlock];

  // A free note (no anchor) is in the notes panel only; the box lists what was anchored and is gone.
  const anchoredNotes = useMemo(
    () => decisionNotes.filter((a) => typeof a.startOffset === 'number' && Boolean(a.anchorText)),
    [decisionNotes],
  );
  const lost = useMemo(
    () => unmatchedAnchors(testo, decisionHighlights, anchoredNotes),
    [testo, decisionHighlights, anchoredNotes],
  );

  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [notesButtonEl, setNotesButtonEl] = useState<HTMLButtonElement | null>(null);
  const [isHighlightsOpen, setIsHighlightsOpen] = useState(false);
  const [highlightsButtonEl, setHighlightsButtonEl] = useState<HTMLButtonElement | null>(null);
  const [highlightsHidden, setHighlightsHidden] = useState(false);
  const [noteAnchor, setNoteAnchor] = useState<{ anchorText: string; startOffset: number; scopedArticleId: string } | null>(null);
  const [composerRect, setComposerRect] = useState<Rect | null>(null);
  const [inlineNote, setInlineNote] = useState<{ note: Annotation; anchorEl: HTMLElement } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastProps['type'] } | null>(null);

  useEffect(() => {
    contentRef.current?.classList.toggle('highlights-hidden', highlightsHidden);
  }, [highlightsHidden]);

  // A tap on a wavy `.note-anchor` opens that note's compact popover.
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const handler = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('.note-anchor');
      const note = target && decisionNotes.find((a) => a.id === target.getAttribute('data-note-id'));
      if (!target || !note) return;
      e.preventDefault();
      e.stopPropagation();
      setInlineNote({ note, anchorEl: target });
    };
    container.addEventListener('click', handler);
    return () => container.removeEventListener('click', handler);
  }, [decisionNotes]);

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

  const handlePopupHighlight = (text: string, color: 'yellow' | 'green' | 'red' | 'blue', startOffset: number) => {
    const already = decisionHighlights.some((h) => h.text.toLowerCase() === text.toLowerCase() && h.startOffset === startOffset);
    if (already) {
      setToast({ message: 'Questa occorrenza è già evidenziata', type: 'info' });
      return;
    }
    addHighlight(key, NO_ARTICLE, text, '', color, startOffset);
    setToast({ message: 'Testo evidenziato', type: 'success' });
  };

  // The rect was captured by the popup before the selection cleared: the composer sits on the words.
  const handlePopupAddNote = (text: string, startOffset: number, rect: Rect) => {
    setNoteAnchor({ anchorText: text, startOffset, scopedArticleId: NO_ARTICLE });
    setComposerRect(rect);
  };

  const handleAddNote = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    addAnnotation(key, NO_ARTICLE, trimmed, noteAnchor ? { anchorText: noteAnchor.anchorText, startOffset: noteAnchor.startOffset } : undefined);
    setToast({ message: noteAnchor ? 'Nota ancorata al testo' : 'Nota aggiunta', type: 'success' });
    setNoteAnchor(null);
  };

  const closeComposer = () => {
    setNoteAnchor(null);
    setComposerRect(null);
  };

  const downloadTxt = (kind: 'Note' | 'Evidenziazioni', body: string) => {
    const header = [`${kind} — ${formatDecisionCitation(identity, attributi)}`, `Esportato il ${new Date().toLocaleString('it-IT')}`, '─'.repeat(60), ''].join('\n');
    const blob = new Blob([`${header}\n${body}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${kind === 'Note' ? 'note' : 'evidenziazioni'}-${key.replace(/[^a-z0-9]+/gi, '-')}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  const exportNotes = () => {
    if (decisionNotes.length === 0) return setToast({ message: 'Nessuna nota da esportare', type: 'info' });
    downloadTxt('Note', decisionNotes.map((n, i) => `${i + 1}. ${n.text}${n.anchorText ? `\n   Ancorata a: "${n.anchorText}"` : ''}`).join('\n\n'));
    setToast({ message: `Esportate ${decisionNotes.length} note`, type: 'success' });
  };
  const exportHighlights = () => {
    if (decisionHighlights.length === 0) return setToast({ message: 'Nessuna evidenziazione da esportare', type: 'info' });
    downloadTxt('Evidenziazioni', decisionHighlights.map((h, i) => `${i + 1}. [${h.color}] ${h.text}`).join('\n\n'));
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
        onClearAnchor={() => setNoteAnchor(null)}
        onExportTxt={exportNotes}
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
          onClose={() => setInlineNote(null)}
          onUpdate={updateAnnotation}
          onRemove={removeAnnotation}
        />
      )}
      {composerRect && noteAnchor && (
        <InlineNoteComposer
          anchorRect={composerRect}
          anchorText={noteAnchor.anchorText}
          onSave={(text) => { handleAddNote(text); setComposerRect(null); }}
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
      />
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
          onClose={closeBlock}
          onUpdateNote={updateAnnotation}
          onRemoveNote={removeAnnotation}
          onRemoveHighlight={removeHighlight}
        />
      )}
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
