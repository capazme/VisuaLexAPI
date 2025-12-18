import { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowUpRight, StickyNote } from 'lucide-react';
import { SelectionPopup } from '../../search/SelectionPopup';
import { SafeHTML } from '../../../../utils/sanitize';
import { cn } from '../../../../lib/utils';
import { extractArticleRefs } from '../../../../utils/citationParser';
import type { ArticleData, NormaVisitata, Highlight, Footnote } from '../../../../types';
import type { StudyModeTheme } from './StudyMode';

interface StudyModeContentProps {
  article: ArticleData;
  fontSize: number;
  lineHeight: number;
  theme: StudyModeTheme;
  highlights: Highlight[];
  normaKey: string;
  footnotes?: Footnote[];
  onAddHighlight: (normaKey: string, articleId: string, text: string, range: string, color: 'yellow' | 'green' | 'red' | 'blue') => void;
  onCrossReferenceNavigate?: (articleNumber: string, normaData: NormaVisitata) => void;
}

const HIGHLIGHT_STYLES: Record<string, string> = {
  yellow: 'background-color:#FEF3C7;color:#92400E;',
  green: 'background-color:#D1FAE5;color:#065F46;',
  red: 'background-color:#FEE2E2;color:#991B1B;',
  blue: 'background-color:#DBEAFE;color:#1E3A8A;',
};

const THEME_CONTENT_STYLES: Record<StudyModeTheme, { prose: string }> = {
  light: {
    prose: 'prose-gray'
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
  normaKey,
  footnotes,
  onAddHighlight,
  onCrossReferenceNavigate
}: StudyModeContentProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [activeFootnote, setActiveFootnote] = useState<Footnote | null>(null);

  const { article_text, norma_data } = article;
  const styles = THEME_CONTENT_STYLES[theme];

  // Track scroll progress
  useEffect(() => {
    const container = contentRef.current?.parentElement;
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

  // Process content with highlights
  const processedContent = useMemo(() => {
    let html = article_text?.replace(/\n/g, '<br />') || '';

    // Apply highlights (longest first to avoid partial matches)
    const sortedHighlights = [...highlights].sort((a, b) => b.text.length - a.text.length);
    sortedHighlights.forEach(h => {
      const escaped = h.text.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`(?<!<mark[^>]*>)${escaped}(?!</mark>)`, 'gi');
      html = html.replace(regex, (match) => {
        return `<mark style="${HIGHLIGHT_STYLES[h.color]}" data-highlight="${h.id}" class="highlight-mark rounded px-0.5">${match}</mark>`;
      });
    });

    // Apply cross-references
    html = html.replace(/art\.?\s+(\d+)/gi, (_match, p1) => {
      return `<button type="button" class="cross-reference text-blue-600 dark:text-blue-400 hover:underline cursor-pointer" data-article="${p1}">art. ${p1}</button>`;
    });

    return html;
  }, [article_text, highlights]);

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

  // Handle highlight from selection popup
  const handleHighlight = (text: string, color: 'yellow' | 'green' | 'red' | 'blue') => {
    const alreadyHighlighted = highlights.some(h =>
      h.text.toLowerCase() === text.toLowerCase()
    );
    if (!alreadyHighlighted) {
      onAddHighlight(normaKey, norma_data.numero_articolo, text, '', color);
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
    <div className="flex-1 overflow-y-auto relative">
      {/* Progress Bar */}
      <div className="sticky top-0 left-0 right-0 h-1 bg-transparent z-10">
        <motion.div
          className="h-full bg-blue-500/50"
          initial={{ width: '0%' }}
          animate={{ width: `${scrollProgress}%` }}
          transition={{ duration: 0.1 }}
        />
      </div>

      {/* Centered Content */}
      <div className="max-w-3xl mx-auto px-4 sm:px-8 py-6 sm:py-12" ref={contentRef}>
        {/* Article Title */}
        <AnimatePresence mode="wait">
          <motion.div
            key={norma_data.numero_articolo}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            <h2 className={cn(
              "text-xl sm:text-2xl font-serif font-bold mb-4 sm:mb-8 pb-3 sm:pb-4 border-b",
              theme === 'dark' ? 'border-gray-700' : theme === 'sepia' ? 'border-[#d4c4a8]' : 'border-gray-200'
            )}>
              Articolo {norma_data.numero_articolo}
            </h2>

            {/* Selection Popup */}
            <SelectionPopup
              containerRef={contentRef}
              onHighlight={handleHighlight}
              onAddNote={handleAddNote}
              onCopy={handleCopy}
            />

            {/* Article Text */}
            <div
              className={cn(
                "prose max-w-none font-serif",
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
                <div className="text-center py-8 opacity-50">
                  Caricamento testo...
                </div>
              )}
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
              "absolute z-20 flex items-center gap-1.5 sm:gap-2 rounded-full shadow-lg transition-colors",
              // Responsive positioning - closer to edge on mobile
              "bottom-4 right-4 sm:bottom-6 sm:right-6",
              // Responsive padding
              "px-2.5 py-1.5 sm:px-3 sm:py-2",
              // Active/inactive states with theme support
              activeFootnote
                ? theme === 'dark'
                  ? "bg-amber-600 text-white"
                  : "bg-amber-500 text-white"
                : theme === 'dark'
                ? "bg-gray-700 text-amber-400 hover:bg-gray-600 active:bg-gray-600"
                : theme === 'sepia'
                ? "bg-[#d4c4a8] text-[#5c4b37] hover:bg-[#c4b498] active:bg-[#c4b498]"
                : "bg-white text-amber-600 hover:bg-gray-50 active:bg-gray-100 border border-gray-200"
            )}
            title={`${footnotes.length} note disponibili`}
            aria-label={`${footnotes.length} note disponibili`}
          >
            <StickyNote size={16} className="sm:w-4 sm:h-4" />
            <span className="text-xs sm:text-sm font-medium">{footnotes.length}</span>
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
                  "absolute z-20 flex flex-col rounded-lg shadow-xl border overflow-hidden",
                  // Responsive width - nearly full width on mobile, fixed on desktop
                  "left-4 right-4 sm:left-auto sm:right-6 sm:w-80",
                  // Responsive positioning - bottom sheet style on mobile
                  "bottom-16 sm:bottom-20",
                  // Responsive max-height
                  "max-h-[50vh] sm:max-h-[60vh]",
                  // Theme colors
                  theme === 'dark'
                    ? "bg-gray-800 border-gray-700"
                    : theme === 'sepia'
                    ? "bg-[#f4ecd8] border-[#d4c4a8]"
                    : "bg-white border-gray-200"
                )}
              >
                {/* Header */}
                <div className={cn(
                  "flex items-center justify-between px-4 py-3 border-b shrink-0",
                  theme === 'dark'
                    ? "bg-gray-700/50 border-gray-700"
                    : theme === 'sepia'
                    ? "bg-[#efe5d1] border-[#d4c4a8]"
                    : "bg-gray-50 border-gray-100"
                )}>
                  <span className={cn(
                    "text-sm font-semibold flex items-center gap-2",
                    theme === 'dark' ? "text-gray-200" : theme === 'sepia' ? "text-[#5c4b37]" : "text-gray-700"
                  )}>
                    <StickyNote size={16} className="text-amber-500" />
                    Note al Dispositivo
                  </span>
                  <button
                    onClick={toggleFootnotesPanel}
                    className={cn(
                      "p-1 rounded transition-colors",
                      theme === 'dark'
                        ? "text-gray-400 hover:text-gray-300 hover:bg-gray-600"
                        : theme === 'sepia'
                        ? "text-[#8b7355] hover:text-[#5c4b37] hover:bg-[#e4d4b8]"
                        : "text-gray-400 hover:text-gray-600 hover:bg-gray-200"
                    )}
                    aria-label="Chiudi note"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Notes List */}
                <div className="flex-1 overflow-y-auto">
                  {footnotes.map((fn, idx) => {
                    const articleRefs = extractArticleRefs(fn.testo, norma_data.tipo_atto);
                    return (
                      <div
                        key={`study-footnote-panel-${fn.numero}-${idx}`}
                        className={cn(
                          "px-4 py-3 border-b last:border-b-0",
                          theme === 'dark'
                            ? "border-gray-700"
                            : theme === 'sepia'
                            ? "border-[#d4c4a8]"
                            : "border-gray-100"
                        )}
                      >
                        {/* Note number badge */}
                        <div className="flex items-start gap-3">
                          <span className={cn(
                            "shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold",
                            "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                          )}>
                            {fn.numero}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className={cn(
                              "text-sm leading-relaxed",
                              theme === 'dark' ? "text-gray-300" : theme === 'sepia' ? "text-[#5c4b37]" : "text-gray-700"
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
                                      "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-pointer",
                                      theme === 'dark'
                                        ? "bg-blue-900/30 text-blue-300 hover:bg-blue-900/50"
                                        : theme === 'sepia'
                                        ? "bg-amber-100/70 text-amber-800 hover:bg-amber-200"
                                        : "bg-blue-50 text-blue-700 hover:bg-blue-100"
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
