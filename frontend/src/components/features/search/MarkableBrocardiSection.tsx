import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Lightbulb } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { SafeHTML } from '../../../utils/sanitize';
import { SelectionPopup } from './SelectionPopup';
import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useArticleMarkers } from '../../../hooks/useArticleMarkers';
import type { HighlightColor } from '../../../utils/highlightColors';

interface MarkableBrocardiSectionProps {
  title: string;
  content: string;
  icon?: React.ReactNode;
  /** Base norma identifier (matches ArticleTabContent itemKey). */
  itemKey: string;
  /**
   * Article-scoped identifier for this specific section, e.g.
   * `${uniqueArticleId}/brocardi/ratio`. All highlights and annotations
   * created from this section are stored against this identifier so the
   * renderer can apply them back to the same textContent.
   */
  sectionArticleId: string;
  /** Forwarded up so the parent can open its notes panel with the anchor. */
  onRequestAddNote: (scopedArticleId: string, text: string, startOffset: number, rect: { x: number; y: number; width: number; height: number }) => void;
}

/**
 * Brocardi content section that supports text-span highlighting and
 * note-anchoring via the same pipeline used by the article body.
 *
 * Each section has its own plain-text offset space (DOM textContent of
 * its own contentRef), so we scope highlights/annotations by a derived
 * sectionArticleId to avoid offset collisions with the article text.
 */
export function MarkableBrocardiSection({
  title,
  content,
  icon,
  itemKey,
  sectionArticleId,
  onRequestAddNote,
}: MarkableBrocardiSectionProps) {
  const [isOpen, setIsOpen] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);

  const {
    annotations, loadAnnotationsForArticle,
    highlights, addHighlight, loadHighlightsForArticle,
  } = useAppStore(useShallow(s => ({
    annotations: s.annotations,
    loadAnnotationsForArticle: s.loadAnnotationsForArticle,
    highlights: s.highlights,
    addHighlight: s.addHighlight,
    loadHighlightsForArticle: s.loadHighlightsForArticle,
  })));

  const sectionHighlights = useMemo(
    () => highlights.filter(h => h.normaKey === itemKey && h.articleId === sectionArticleId),
    [highlights, itemKey, sectionArticleId],
  );
  const sectionAnnotations = useMemo(
    () => annotations.filter(a => a.normaKey === itemKey && a.articleId === sectionArticleId),
    [annotations, itemKey, sectionArticleId],
  );

  // Load persisted highlights + annotations for this section on mount
  useEffect(() => {
    if (!itemKey || !sectionArticleId) return;
    loadHighlightsForArticle(itemKey, sectionArticleId);
    loadAnnotationsForArticle(itemKey, sectionArticleId);
  }, [itemKey, sectionArticleId, loadHighlightsForArticle, loadAnnotationsForArticle]);

  const markedHtml = useArticleMarkers({
    rawText: content,
    highlights: sectionHighlights,
    annotations: sectionAnnotations,
  });

  const handleHighlight = (text: string, color: HighlightColor, startOffset: number) => {
    const already = sectionHighlights.some(
      (h) => h.text.toLowerCase() === text.toLowerCase() && h.startOffset === startOffset,
    );
    if (already) return;
    addHighlight(itemKey, sectionArticleId, text, '', color, startOffset);
  };

  const handleAddNote = (text: string, startOffset: number, rect: { x: number; y: number; width: number; height: number }) => {
    onRequestAddNote(sectionArticleId, text, startOffset, rect);
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Silently ignore — user sees no toast here (toolbar handles main copy UX)
    }
  };

  // Strict early validation — matches the original BrocardiSectionContent
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return null;
  }

  return (
    <div className="card bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm rounded-xl mb-3 overflow-hidden transition-all hover:shadow-md">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50/50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors text-left"
      >
        <strong className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase flex items-center gap-2.5">
          {icon || <Lightbulb size={16} className="text-primary-500" />}
          {title}
        </strong>
        <ChevronDown
          size={16}
          className={cn('text-slate-400 transition-transform duration-200', isOpen && 'rotate-180')}
        />
      </button>
      {isOpen && (
        <div className="relative">
          <div ref={contentRef} className="text-sm text-slate-700 dark:text-slate-300">
            <SafeHTML
              html={markedHtml}
              className="p-4 prose prose-sm dark:prose-invert max-w-none prose-slate leading-relaxed"
            />
          </div>
          <SelectionPopup
            containerRef={contentRef}
            onHighlight={handleHighlight}
            onAddNote={handleAddNote}
            onCopy={handleCopy}
          />
        </div>
      )}
    </div>
  );
}
