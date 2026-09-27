import { useRef, useEffect } from 'react';
import { cn } from '../../../lib/utils';
import { normalizeArticleId } from '../../../utils/treeUtils';

interface ArticleMinimapProps {
  /** IDs of loaded articles */
  loadedArticleIds: string[];
  /** ID of the currently active article */
  activeArticleId: string | null;
  /** Callback when clicking a minimap indicator */
  onArticleClick: (articleId: string) => void;
  className?: string;
}

export function ArticleMinimap({
  loadedArticleIds,
  activeArticleId,
  onArticleClick,
  className
}: ArticleMinimapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the minimap to keep active article in view
  useEffect(() => {
    if (activeArticleId && containerRef.current) {
      const activeIndex = loadedArticleIds.findIndex(id => normalizeArticleId(id) === normalizeArticleId(activeArticleId));
      if (activeIndex !== -1) {
        const indicator = containerRef.current.children[activeIndex] as HTMLElement;
        if (indicator) {
          indicator.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'center'
          });
        }
      }
    }
  }, [activeArticleId, loadedArticleIds]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex items-center gap-0.5 overflow-x-auto no-scrollbar py-1 px-1 select-none",
        className
      )}
    >
      {loadedArticleIds.map((id) => {
        const isActive = activeArticleId && normalizeArticleId(id) === normalizeArticleId(activeArticleId);

        return (
          <div
            key={id}
            onClick={() => onArticleClick(id)}
            title={`Vai all'Art. ${id}`}
            className={cn(
              "flex-shrink-0 cursor-pointer transition-all duration-200 rounded-sm",
              isActive
                ? "w-8 h-1.5 bg-primary-500 shadow-sm"
                : "w-1.5 h-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 hover:w-3"
            )}
          />
        );
      })}
    </div>
  );
}
