import { useRef, useMemo, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SelectionPopup } from '../../search/SelectionPopup';
import { SafeHTML } from '../../../../utils/sanitize';
import { cn } from '../../../../lib/utils';
import { getInkAnchor } from '../../../../utils/inkSelection';
import { unversionedCitation, withCitation } from '../../../../utils/citation';
import { todayInRome } from '../../../../utils/dateUtils';
import type { ArticleData, Highlight, Annotation } from '../../../../types';
import type { StudyModeTheme } from './StudyMode';
import { useArticleMarkers } from '../../../../hooks/useArticleMarkers';
import { useArticleTextInteractions } from '../../../../hooks/useArticleTextInteractions';
import { getRubricText, getUpdateNoteParagraphs, parseArticleStructure } from '../../../../utils/articleStructure';
import { blockStarts } from '../../../../utils/articleAnnotations';
import { UpdateNotePopover } from '../../search/UpdateNotePopover';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../../store/useAppStore';
import { useHighlightInk } from '../../../../hooks/useHighlightInk';
import { uniqueArticleIdFromNorma } from '../../../../utils/normaKeys';
import { AnnotationMargin, type AnnotationMarginHandle, type NoteDraft } from '../../search/AnnotationMargin';
import { useInlineNoteAnchors } from '../../../../hooks/useInlineNoteAnchors';

const COLOR_SHORTCUTS: Record<string, 'yellow' | 'green' | 'red' | 'blue'> = {
  '1': 'yellow',
  '2': 'green',
  '3': 'red',
  '4': 'blue',
};

interface StudyModeContentProps {
  article: ArticleData;
  fontSize: number;
  lineHeight: number;
  theme: StudyModeTheme;
  highlights: Highlight[];
  annotations: Annotation[];
  normaKey: string;
  /**
   * Fired when the user picks "Aggiungi nota" from the selection popup and the screen has no room for the notes beside
   * the text: the tools panel writes it. The anchor carries the selected text and its document-relative plain
   * offset so the saved annotation can render a wavy underline across
   * the same span in both Study Mode and the main article view.
   */
  onRequestAddNote?: (anchor: { anchorText: string; startOffset: number }) => void;
}

export function StudyModeContent({
  article,
  fontSize,
  lineHeight,
  theme,
  highlights,
  annotations,
  normaKey,
  onRequestAddNote,
}: StudyModeContentProps) {
  // `scrollRef` tracks the outer scrollable container (used for the
  // progress bar). `contentRef` wraps the body and its selection popup;
  // `textRef` is the text alone, the root stored offsets are measured from.
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);

  const { article_text, norma_data } = article;

  // Track scroll progress
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const progress = scrollHeight > clientHeight
        ? (scrollTop / (scrollHeight - clientHeight)) * 100
        : 100;
      setScrollProgress(Math.min(100, Math.max(0, progress)));
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // The full text, structured like the dashboard's. The heading and rubric
  // blocks stay in it but are hidden (`vlx-hide-header`): Study Mode shows
  // its own header, and hidden text still counts in the offsets, so stored
  // highlights and notes need no shifting — they are document-relative here
  // exactly as on the dashboard and in the dossier.
  const structure = useMemo(() => parseArticleStructure(article_text || ''), [article_text]);
  const rubric = useMemo(() => getRubricText(article_text || '', structure), [article_text, structure]);

  const markedHtml = useArticleMarkers({
    rawText: article_text || '',
    highlights,
    annotations,
    structure,
  });

  // Handle highlight from selection popup. The offset is already
  // document-relative (the text root holds the whole text).
  //
  // `uniqueArticleId` mirrors ArticleTabContent's builder: highlights
  // live under `all{N}:{numero}` for annex articles so the main view's
  // articleId filter finds entries created here.
  const uniqueArticleId = uniqueArticleIdFromNorma(norma_data);
  const setHighlighterInk = useAppStore((s) => s.setHighlighterInk);
  const plain = useMemo(() => (article_text || '').replace(/\n/g, ''), [article_text]);
  // The highlighter's rules (A4), as in every reader: over its own colour alone the ink is taken away, anything else
  // takes it. No notification, as everywhere: Ctrl+Z (⌘Z) takes the last gesture back.
  const handleHighlight = useHighlightInk({
    key: normaKey, articleId: uniqueArticleId, plain, breaks: () => blockStarts(article_text || '', structure),
  });

  // "(119)" references open their AGGIORNAMENTO note; the notes at the bottom fold.
  const { updatesOpen, openNote, closeNote } = useArticleTextInteractions(contentRef, uniqueArticleId, {
    contentKey: markedHtml,
  });

  // Colour shortcut: 1/2/3/4 apply their colour to the current selection
  // when it sits inside the article body, by the highlighter's rules (A4),
  // and make it the highlighter's ink, as the bar's menu does (H1): the next
  // highlight, by the popup or H, takes it too. Runs in the capture phase with
  // stopImmediatePropagation so the theme shortcut in
  // useStudyModeShortcuts (also bound to 1/2/3 on window) doesn't also
  // fire and flip the theme while the user wanted a yellow highlight.
  useEffect(() => {
    const container = textRef.current;
    if (!container) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const color = COLOR_SHORTCUTS[e.key];
      if (!color) return;

      const target = e.target as Node | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      // While a dialog is open over Study Mode (Impostazioni) the keys are its own: a selection left in the text behind
      // it is not highlighted.
      if (document.querySelector('[aria-modal="true"]')) return;
      // A key held down highlights once (A4): its repeats are taken, so neither a second highlight nor the theme's key.
      if (e.repeat) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      const selection = window.getSelection();
      if (!selection?.toString().trim()) return;
      // Text and offset from the DOM text itself (see getSelectionAnchor):
      // a rendered selection string would carry newlines the text has not.
      // Whole words, as the highlighter takes them (A4).
      const anchor = getInkAnchor(container, selection);
      if (!anchor) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      setHighlighterInk(color);
      handleHighlight(anchor.text, color, anchor.startOffset);
      selection.removeAllRanges();
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [handleHighlight, setHighlighterInk]);

  // Handle note from selection popup; the offset is document-relative
  // already, so the anchor resolves on the dashboard and in the dossier too.
  // The notes beside the text (A4 §6): a new one's editor at its words where the screen has room, else the tools panel.
  const { addAnnotation, updateAnnotation, removeAnnotation } = useAppStore(useShallow((s) => ({
    addAnnotation: s.addAnnotation, updateAnnotation: s.updateAnnotation, removeAnnotation: s.removeAnnotation,
  })));
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [roomy, setRoomy] = useState(false);
  const marginRef = useRef<AnnotationMarginHandle>(null);
  // A note's wavy words: its card beside the text (Study Mode draws no sign: with no column, the tools panel lists it).
  useInlineNoteAnchors(contentRef, annotations, (note) => { marginRef.current?.focus([`note:${note.id}`]); });
  const handleAddNote = (text: string, startOffset: number) => {
    if (roomy) {
      setDraft({ text, startOffset });
      return;
    }
    if (!onRequestAddNote) return;
    onRequestAddNote({ anchorText: text, startOffset });
  };

  // Handle copy from selection popup
  // Study Mode opens only on the text in force: a copy starts with its citation (D8).
  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(withCitation(text, null, unversionedCitation(norma_data, todayInRome())));
  };

  return (
    <div className="flex-1 overflow-y-auto relative custom-scrollbar" ref={scrollRef}>
      {/* Progress Bar */}
      <div className="sticky top-0 left-0 right-0 h-1 bg-transparent z-10 pointer-events-none">
        <motion.div
          className="h-full bg-primary-500/50 backdrop-blur-sm"
          initial={{ width: '0%' }}
          animate={{ width: `${scrollProgress}%` }}
          transition={{ duration: 0.1 }}
        />
      </div>

      {/* Centered Content. Extra top padding clears the absolutely
          positioned StudyModeHeader (~56px tall) so the article title
          isn't tucked behind it when the scroll is at the top. */}
      <AnnotationMargin
        plain={plain}
        textRootRef={textRef}
        contentKey={markedHtml}
        notes={annotations}
        onUpdateNote={updateAnnotation}
        onRemoveNote={removeAnnotation}
        draft={roomy ? draft : null}
        onSaveDraft={(text) => {
          if (!draft) return;
          addAnnotation(normaKey, uniqueArticleId, text, { anchorText: draft.text, startOffset: draft.startOffset });
          setDraft(null);
        }}
        onCancelDraft={() => setDraft(null)}
        onRoomChange={setRoomy}
        ref={marginRef}
        // Below the header's height; the column off the scroller's edge where it is drawn (from 52rem).
        className="pt-20 sm:pt-24 lg:pr-8"
      >
      <div className="max-w-3xl mx-auto px-4 sm:px-8 pb-6 sm:pb-10">
        {/* Article Title */}
        <AnimatePresence mode="wait">
          <motion.div
            key={uniqueArticleId}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            <header className="mb-6 sm:mb-8">
              <h2 className="text-xl sm:text-2xl font-serif font-bold leading-tight tracking-tight">
                Articolo {norma_data.numero_articolo}
                {norma_data.allegato && (
                  <span className="opacity-60 font-normal text-base sm:text-lg"> — Allegato {norma_data.allegato}</span>
                )}
              </h2>
              {rubric && (
                <p className={cn(
                  "mt-1.5 font-serif italic text-sm sm:text-base leading-snug",
                  theme === 'dark' ? 'text-slate-400' : theme === 'sepia' ? 'text-[#8b7355]' : 'text-slate-500'
                )}>
                  {rubric}
                </p>
              )}
            </header>

            {/* Article body. The id is read by StudyModeToolsPanel to scroll
                to a highlight or a note anchor. */}
            <div className="relative" id="study-mode-article-body" ref={contentRef}>
              <SelectionPopup
                containerRef={contentRef}
                textRootRef={textRef}
                onHighlight={handleHighlight}
                onAddNote={handleAddNote}
                onCopy={handleCopy}
              />

              {/* Structured like the dashboard (`vlx-art`); size, leading
                  and theme colours come from Study Mode's own settings. */}
              <div
                ref={textRef}
                className={cn('vlx-art vlx-art--study vlx-hide-header', updatesOpen && 'vlx-updates-open')}
                style={{
                  fontSize: `${fontSize}px`,
                  lineHeight: lineHeight
                }}
              >
                {markedHtml ? (
                  <SafeHTML html={markedHtml} />
                ) : (
                  <div className="text-center py-8 opacity-50 flex flex-col items-center gap-2">
                    <div className="w-5 h-5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    Caricamento testo...
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
      </AnnotationMargin>

      {openNote && structure.notes[openNote.id] && (
        <UpdateNotePopover
          noteId={openNote.id}
          paragraphs={getUpdateNoteParagraphs(article_text || '', structure.notes[openNote.id])}
          anchorEl={openNote.anchorEl}
          onClose={closeNote}
        />
      )}

    </div>
  );
}
