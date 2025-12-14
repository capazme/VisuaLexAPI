import { useRef, useMemo, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SelectionPopup } from '../../search/SelectionPopup';
import { SafeHTML } from '../../../../utils/sanitize';
import { cn } from '../../../../lib/utils';
import type { ArticleData, NormaVisitata, Highlight } from '../../../../types';
import type { StudyModeTheme } from './StudyMode';

interface StudyModeContentProps {
  article: ArticleData;
  fontSize: number;
  lineHeight: number;
  theme: StudyModeTheme;
  highlights: Highlight[];
  normaKey: string;
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
  onAddHighlight,
  onCrossReferenceNavigate
}: StudyModeContentProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);

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
      <div className="max-w-3xl mx-auto px-8 py-12" ref={contentRef}>
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
              "text-2xl font-serif font-bold mb-8 pb-4 border-b",
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
    </div>
  );
}
