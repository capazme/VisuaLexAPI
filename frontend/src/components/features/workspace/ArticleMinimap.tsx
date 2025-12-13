import { cn } from '../../../lib/utils';

interface ArticleMinimapProps {
  articleIds: string[];
  activeArticleId: string | null;
  onArticleClick: (id: string) => void;
  className?: string;
}

/**
 * Row of clickable dots representing articles.
 * Active article is highlighted with larger, colored dot.
 */
export function ArticleMinimap({
  articleIds,
  activeArticleId,
  onArticleClick,
  className
}: ArticleMinimapProps) {
  if (articleIds.length <= 1) return null;

  // For many articles, show scrollable dots
  const showCompact = articleIds.length > 10;

  return (
    <div className={cn("flex items-center gap-1.5 overflow-x-auto no-scrollbar", className)}>
      {articleIds.map((id) => {
        const isActive = id === activeArticleId;

        return (
          <button
            key={id}
            onClick={() => onArticleClick(id)}
            className={cn(
              "rounded-full transition-all flex-shrink-0",
              isActive
                ? "w-3 h-3 bg-blue-500 ring-2 ring-blue-200 dark:ring-blue-800"
                : "w-2 h-2 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500",
              showCompact && "w-1.5 h-1.5"
            )}
            title={`Art. ${id}`}
            aria-label={`Vai all'articolo ${id}`}
          />
        );
      })}
    </div>
  );
}
