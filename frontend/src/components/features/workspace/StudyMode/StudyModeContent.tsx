import { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowUpRight, StickyNote } from 'lucide-react';
import { SelectionPopup } from '../../search/SelectionPopup';
import { SafeHTML } from '../../../../utils/sanitize';
import { cn } from '../../../../lib/utils';
import { extractArticleRefs } from '../../../../utils/citationParser';
import type { ArticleData, NormaVisitata, Highlight, Annotation, Footnote } from '../../../../types';
import type { StudyModeTheme } from './StudyMode';
import { useArticleMarkers } from '../../../../hooks/useArticleMarkers';
import { extractPreamble } from './extractPreamble';

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
  onCrossReferenceNavigate?: (articleNumber: string, normaData: NormaVisitata) => void;
}

const THEME_CONTENT_STYLES: Record<StudyModeTheme, { prose: string }> = {
  light: {
    prose: 'prose-slate'
  },
  dark: {
    prose: 'prose-invert'
  },
  sepia: {
    prose: 'prose-stone'
  }
};

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
  onCrossReferenceNavigate
}: StudyModeContentProps) {
  // `scrollRef` tracks the outer scrollable container (used for the
  // progress bar). `contentRef` wraps only the prose so selection
  // offsets exclude the title / rubric — otherwise `getPlainTextOffset`
  // would count the H2 characters and the highlight anchor would land
  // way off the actual text once shifted into document coords.
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [activeFootnote, setActiveFootnote] = useState<Footnote | null>(null);

  const { article_text, norma_data } = article;
  const styles = THEME_CONTENT_STYLES[theme];

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

  // Split off the "Art. N. (Rubrica)." preamble so the rendered body doesn't
  // duplicate what the H2 + rubric subtitle already show.
  const { rubric, body: bodyText, offset: preambleOffset } = useMemo(
    () => extractPreamble(article_text || ''),
    [article_text],
  );

  // Highlights and annotations are stored document-relative (matching the
  // main article view). Shift them into body-relative coordinates for this
  // view, and drop anything that falls inside the hidden preamble — users
  // never interact with that region here.
  const bodyHighlights = useMemo<Highlight[]>(() => {
    if (preambleOffset === 0) return highlights;
    return highlights.flatMap((h) => {
      if (typeof h.startOffset !== 'number') return [h];
      const shifted = h.startOffset - preambleOffset;
      if (shifted < 0) return [];
      return [{ ...h, startOffset: shifted }];
    });
  }, [highlights, preambleOffset]);

  const bodyAnnotations = useMemo<Annotation[]>(() => {
    if (preambleOffset === 0) return annotations;
    return annotations.flatMap((a) => {
      if (typeof a.startOffset !== 'number') return [a];
      const shifted = a.startOffset - preambleOffset;
      if (shifted < 0) return [];
      return [{ ...a, startOffset: shifted }];
    });
  }, [annotations, preambleOffset]);

  // Shared marker pipeline: pins highlights to specific occurrences via
  // startOffset, renders note-anchor spans for annotations, and handles
  // adjacent/nested boundaries correctly. Same hook the main article flow
  // uses — Study Mode no longer has its own divergent renderer.
  const markedHtml = useArticleMarkers({
    rawText: bodyText,
    highlights: bodyHighlights,
    annotations: bodyAnnotations,
  });

  // Cross-references are Study-Mode-specific: simple `art. N` → button wrap.
  // Applied after marker insertion so highlights/note anchors don't get
  // mangled by the cross-reference regex.
  const processedContent = useMemo(() => {
    return markedHtml.replace(/art\.?\s+(\d+)/gi, (_match, p1) => {
      return `<button type="button" class="cross-reference text-primary-600 dark:text-primary-400 hover:underline cursor-pointer font-medium" data-article="${p1}">art. ${p1}</button>`;
    });
  }, [markedHtml]);

  // Handle cross-reference clicks
  useEffect(() => {
    if (!onCrossReferenceNavigate) return;
    const container = contentRef.current;
    if (!container) return;

    const handler = (event: Event) => {
      const target = event.target as HTMLElement;
      if (target.classList.contains('cross-reference')) {
        const articleNumber = target.getAttribute('data-article');
        if (articleNumber) {
          onCrossReferenceNavigate(articleNumber, norma_data);
        }
      }
    };

    container.addEventListener('click', handler);
    return () => container.removeEventListener('click', handler);
  }, [onCrossReferenceNavigate, norma_data]);

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

  // Handle highlight from selection popup. SelectionPopup supplies the
  // plain-text startOffset relative to the rendered body (which now
  // excludes the preamble). Shift it back to document coords so the
  // stored offset matches what the main article view would produce for
  // the same span — otherwise the same highlight would point to
  // different places depending on where it was created.
  const handleHighlight = (text: string, color: 'yellow' | 'green' | 'red' | 'blue', startOffset: number) => {
    const documentOffset = startOffset + preambleOffset;
    const alreadyHighlighted = highlights.some(h =>
      h.text.toLowerCase() === text.toLowerCase() && h.startOffset === documentOffset
    );
    if (!alreadyHighlighted) {
      onAddHighlight(normaKey, norma_data.numero_articolo, text, '', color, documentOffset);
    }
  };

  // Handle note from selection popup
  const handleAddNote = (text: string) => {
    // This will be handled by opening the tools panel
    console.log('Add note for text:', text);
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

      {/* Centered Content */}
      <div className="max-w-3xl mx-auto px-4 sm:px-8 py-6 sm:py-10">
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

            {/* Article body — ref scoped to this wrapper so selection
                offsets align with the body text fed to useArticleMarkers. */}
            <div className="relative" ref={contentRef}>
              <SelectionPopup
                containerRef={contentRef}
                onHighlight={handleHighlight}
                onAddNote={handleAddNote}
                onCopy={handleCopy}
              />

              <div
                className={cn(
                  "prose max-w-none font-serif leading-relaxed",
                  styles.prose
                )}
                style={{
                  fontSize: `${fontSize}px`,
                  lineHeight: lineHeight
                }}
              >
                {processedContent ? (
                  <SafeHTML html={processedContent} />
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
