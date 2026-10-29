import { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SelectionPopup } from '../../search/SelectionPopup';
import { SafeHTML } from '../../../../utils/sanitize';
import { cn } from '../../../../lib/utils';
import { getSelectionAnchor } from '../../../../utils/selectionOffset';
import { unversionedCitation, withCitation } from '../../../../utils/citation';
import { todayInRome } from '../../../../utils/dateUtils';
import type { ArticleData, Highlight, Annotation } from '../../../../types';
import type { StudyModeTheme } from './StudyMode';
import { useArticleMarkers } from '../../../../hooks/useArticleMarkers';
import { useArticleTextInteractions } from '../../../../hooks/useArticleTextInteractions';
import { getRubricText, getUpdateNoteParagraphs, parseArticleStructure } from '../../../../utils/articleStructure';
import { UpdateNotePopover } from '../../search/UpdateNotePopover';
import { useAppStore } from '../../../../store/useAppStore';

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
  onAddHighlight: (
    normaKey: string,
    articleId: string,
    text: string,
    range: string,
    color: 'yellow' | 'green' | 'red' | 'blue',
    startOffset: number,
  ) => void;
  /**
   * Fired when the user picks "Aggiungi nota" from the selection popup.
   * The anchor carries the selected text and its document-relative plain
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
  onAddHighlight,
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
  const uniqueArticleId = useMemo(
    () => norma_data.allegato ? `all${norma_data.allegato}:${norma_data.numero_articolo}` : norma_data.numero_articolo,
    [norma_data.allegato, norma_data.numero_articolo],
  );
  const updateSettings = useAppStore((s) => s.updateSettings);
  const handleHighlight = useCallback(
    (text: string, color: 'yellow' | 'green' | 'red' | 'blue', startOffset: number) => {
      const alreadyHighlighted = highlights.some(h =>
        h.text.toLowerCase() === text.toLowerCase() && h.startOffset === startOffset
      );
      if (!alreadyHighlighted) {
        onAddHighlight(normaKey, uniqueArticleId, text, '', color, startOffset);
      }
    },
    [highlights, onAddHighlight, normaKey, uniqueArticleId],
  );

  // "(119)" references open their AGGIORNAMENTO note; the notes at the bottom fold.
  const { updatesOpen, openNote, closeNote } = useArticleTextInteractions(contentRef, uniqueArticleId, {
    contentKey: markedHtml,
  });

  // Colour shortcut: 1/2/3/4 highlight the current selection when it
  // sits inside the article body, and make that colour the one chosen for
  // new highlights, as the bar's menu does (H1): the next highlight, by
  // the popup or H, takes it too. Runs in the capture phase with
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
      // A dialog over Study Mode (Impostazioni) keeps its keys, a selection left in the text behind it included.
      if (target instanceof Element && target.closest('[aria-modal="true"]')) return;

      const selection = window.getSelection();
      if (!selection?.toString().trim()) return;
      // Text and offset from the DOM text itself (see getSelectionAnchor):
      // a rendered selection string would carry newlines the text has not.
      const anchor = getSelectionAnchor(container, selection);
      if (!anchor) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      updateSettings({ highlightColor: color });
      handleHighlight(anchor.text, color, anchor.startOffset);
      selection.removeAllRanges();
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [handleHighlight, updateSettings]);

  // Handle note from selection popup; the offset is document-relative
  // already, so the anchor resolves on the dashboard and in the dossier too.
  const handleAddNote = (text: string, startOffset: number) => {
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
      <div className="max-w-3xl mx-auto px-4 sm:px-8 pt-20 sm:pt-24 pb-6 sm:pb-10">
        {/* Article Title */}
        <AnimatePresence mode="wait">
          <motion.div
            key={norma_data.allegato ? `all${norma_data.allegato}:${norma_data.numero_articolo}` : norma_data.numero_articolo}
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
