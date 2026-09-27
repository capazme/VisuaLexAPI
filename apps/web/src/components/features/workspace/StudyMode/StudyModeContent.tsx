import { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowUpRight, StickyNote } from 'lucide-react';
import { SelectionPopup } from '../../search/SelectionPopup';
import { SafeHTML } from '../../../../utils/sanitize';
import { cn } from '../../../../lib/utils';
import { extractArticleRefs } from '../../../../utils/citationParser';
import { getSelectionAnchor } from '../../../../utils/selectionOffset';
import type { ArticleData, NormaVisitata, Highlight, Annotation, Footnote } from '../../../../types';
import type { StudyModeTheme } from './StudyMode';
import { useArticleMarkers } from '../../../../hooks/useArticleMarkers';
import { useArticleTextInteractions } from '../../../../hooks/useArticleTextInteractions';
import { getRubricText, getUpdateNoteParagraphs, parseArticleStructure } from '../../../../utils/articleStructure';
import { UpdateNotePopover } from '../../search/UpdateNotePopover';

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
  footnotes?: Footnote[];
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
  onCrossReferenceNavigate?: (articleNumber: string, normaData: NormaVisitata) => void;
}

export function StudyModeContent({
  article,
  fontSize,
  lineHeight,
  theme,
  highlights,
  annotations,
  normaKey,
  footnotes,
  onAddHighlight,
  onRequestAddNote,
  onCrossReferenceNavigate
}: StudyModeContentProps) {
  // `scrollRef` tracks the outer scrollable container (used for the
  // progress bar). `contentRef` wraps the body and its selection popup;
  // `textRef` is the text alone, the root stored offsets are measured from.
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [activeFootnote, setActiveFootnote] = useState<Footnote | null>(null);

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

  // Toggle footnotes panel
  const toggleFootnotesPanel = useCallback(() => {
    if (activeFootnote) {
      setActiveFootnote(null);
    } else if (footnotes?.length) {
      setActiveFootnote(footnotes[0]); // Just to trigger the panel
    }
  }, [activeFootnote, footnotes]);

  // Close panel on Escape key
  useEffect(() => {
    if (!activeFootnote) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveFootnote(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeFootnote]);

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
  // sits inside the article body. Runs in the capture phase with
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

      const selection = window.getSelection();
      if (!selection?.toString().trim()) return;
      // Text and offset from the DOM text itself (see getSelectionAnchor):
      // a rendered selection string would carry newlines the text has not.
      const anchor = getSelectionAnchor(container, selection);
      if (!anchor) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      handleHighlight(anchor.text, color, anchor.startOffset);
      selection.removeAllRanges();
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [handleHighlight]);

  // Handle note from selection popup; the offset is document-relative
  // already, so the anchor resolves on the dashboard and in the dossier too.
  const handleAddNote = (text: string, startOffset: number) => {
    if (!onRequestAddNote) return;
    onRequestAddNote({ anchorText: text, startOffset });
  };

  // Handle copy from selection popup
  const handleCopy = async (text: string) => {
    const citation = `\n\n---\nTratto da: ${norma_data.tipo_atto}${norma_data.numero_atto ? ` n. ${norma_data.numero_atto}` : ''}${norma_data.data ? ` del ${norma_data.data}` : ''}, Art. ${norma_data.numero_articolo}`;
    await navigator.clipboard.writeText(text + citation);
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

      {/* Floating Footnotes Indicator */}
      {footnotes && footnotes.length > 0 && (
        <>
          {/* Floating Button - responsive positioning */}
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.3, type: 'spring', stiffness: 300 }}
            onClick={toggleFootnotesPanel}
            className={cn(
              // Base styles
              "absolute z-20 flex items-center gap-1.5 sm:gap-2 rounded-full shadow-lg transition-colors border",
              // Responsive positioning - closer to edge on mobile
              "bottom-4 right-4 sm:bottom-6 sm:right-6",
              // Responsive padding
              "px-3 py-1.5 sm:px-4 sm:py-2",
              // Active/inactive states with theme support
              activeFootnote
                ? theme === 'dark'
                  ? "bg-slate-700 border-slate-600 text-white shadow-slate-900/50"
                  : "bg-slate-800 border-slate-700 text-white shadow-slate-200"
                : theme === 'dark'
                  ? "bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 active:bg-slate-600"
                  : theme === 'sepia'
                    ? "bg-[#f4ecd8] text-[#5c4b37] border-[#d4c4a8] hover:bg-[#e4d4b8] active:bg-[#e4d4b8]"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 active:bg-slate-100"
            )}
            title={`${footnotes.length} note disponibili`}
            aria-label={`${footnotes.length} note disponibili`}
          >
            <StickyNote size={16} className="sm:w-4 sm:h-4 text-primary-500" />
            <span className="text-xs sm:text-sm font-semibold">{footnotes.length}</span>
          </motion.button>

          {/* Footnotes Panel - responsive layout */}
          <AnimatePresence>
            {activeFootnote && (
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className={cn(
                  // Base styles
                  "absolute z-20 flex flex-col rounded-xl shadow-2xl border overflow-hidden",
                  // Responsive width - nearly full width on mobile, fixed on desktop
                  "left-4 right-4 sm:left-auto sm:right-6 sm:w-80",
                  // Responsive positioning - bottom sheet style on mobile
                  "bottom-16 sm:bottom-20",
                  // Responsive max-height
                  "max-h-[50vh] sm:max-h-[60vh]",
                  // Theme colors
                  theme === 'dark'
                    ? "bg-slate-800 border-slate-700"
                    : theme === 'sepia'
                      ? "bg-[#f4ecd8] border-[#d4c4a8]"
                      : "bg-white border-slate-200"
                )}
              >
                {/* Header */}
                <div className={cn(
                  "flex items-center justify-between px-4 py-3 border-b shrink-0",
                  theme === 'dark'
                    ? "bg-slate-800 border-slate-700"
                    : theme === 'sepia'
                      ? "bg-[#efe5d1] border-[#d4c4a8]"
                      : "bg-slate-50 border-slate-100"
                )}>
                  <span className={cn(
                    "text-sm font-semibold flex items-center gap-2",
                    theme === 'dark' ? "text-slate-200" : theme === 'sepia' ? "text-[#5c4b37]" : "text-slate-700"
                  )}>
                    <StickyNote size={16} className="text-primary-500" />
                    Note al Dispositivo
                  </span>
                  <button
                    onClick={toggleFootnotesPanel}
                    className={cn(
                      "p-1 rounded-md transition-colors",
                      theme === 'dark'
                        ? "text-slate-400 hover:text-slate-300 hover:bg-slate-700"
                        : theme === 'sepia'
                          ? "text-[#8b7355] hover:text-[#5c4b37] hover:bg-[#e4d4b8]"
                          : "text-slate-400 hover:text-slate-600 hover:bg-slate-200"
                    )}
                    aria-label="Chiudi note"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Notes List */}
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {footnotes.map((fn, idx) => {
                    const articleRefs = extractArticleRefs(fn.testo, norma_data.tipo_atto);
                    return (
                      <div
                        key={`study-footnote-panel-${fn.numero}-${idx}`}
                        className={cn(
                          "px-4 py-3 border-b last:border-b-0",
                          theme === 'dark'
                            ? "border-slate-700 hover:bg-slate-700/30"
                            : theme === 'sepia'
                              ? "border-[#d4c4a8] hover:bg-[#e4d4b8]/30"
                              : "border-slate-100 hover:bg-slate-50"
                        )}
                      >
                        {/* Note number badge */}
                        <div className="flex items-start gap-3">
                          <span className={cn(
                            "shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold mt-0.5",
                            "bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300"
                          )}>
                            {fn.numero}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className={cn(
                              "text-sm leading-relaxed",
                              theme === 'dark' ? "text-slate-300" : theme === 'sepia' ? "text-[#5c4b37]" : "text-slate-700"
                            )}>
                              {fn.testo}
                            </p>

                            {/* Article references */}
                            {articleRefs.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                {articleRefs.map((ref, i) => (
                                  <button
                                    key={`study-fn-ref-${fn.numero}-${ref.numero || 'unknown'}-${i}`}
                                    onClick={() => {
                                      if (onCrossReferenceNavigate) {
                                        onCrossReferenceNavigate(ref.numero, norma_data);
                                      }
                                    }}
                                    className={cn(
                                      "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-pointer border",
                                      theme === 'dark'
                                        ? "bg-primary-900/20 text-primary-300 border-primary-900/30 hover:bg-primary-900/40"
                                        : theme === 'sepia'
                                          ? "bg-amber-100/70 text-amber-800 border-amber-200 hover:bg-amber-200"
                                          : "bg-primary-50 text-primary-700 border-primary-100 hover:bg-primary-100"
                                    )}
                                    title={`Vai a Art. ${ref.numero}`}
                                  >
                                    Art. {ref.numero}
                                    <ArrowUpRight size={10} className="opacity-60" />
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
