import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { normalizeArticleId } from '../../../utils/treeUtils';

interface ArticleNavigationProps {
  /** All article IDs from structure (for full navigation) */
  allArticleIds?: string[];
  /** Currently loaded article IDs */
  loadedArticleIds: string[];
  /** Currently active article ID */
  activeArticleId: string | null;
  /** Callback when navigating to a loaded article */
  onNavigate: (id: string) => void;
  /** Callback when navigating to an unloaded article (triggers fetch) */
  onLoadArticle?: (id: string) => void;
  className?: string;
}

/**
 * Navigation arrows with position counter for article navigation.
 * Supports navigation through full structure, loading articles on demand.
 */
export function ArticleNavigation({
  allArticleIds,
  loadedArticleIds,
  activeArticleId,
  onNavigate,
  onLoadArticle,
  className
}: ArticleNavigationProps) {
  // Use structure if available, otherwise loaded articles
  const navigationIds = allArticleIds && allArticleIds.length > 0
    ? allArticleIds
    : loadedArticleIds;

  if (navigationIds.length <= 1) return null;

  // Create normalized set for comparison (handles "3 bis" vs "3-bis")
  const loadedSetNormalized = new Set(loadedArticleIds.map(normalizeArticleId));
  const isLoaded = (id: string) => loadedSetNormalized.has(normalizeArticleId(id));

  // Find current index using normalized comparison
  const currentIndex = activeArticleId
    ? navigationIds.findIndex(id => normalizeArticleId(id) === normalizeArticleId(activeArticleId))
    : -1;

  const isFirst = currentIndex <= 0;
  const isLast = currentIndex >= navigationIds.length - 1;

  const handlePrev = () => {
    if (isFirst) return;
    const prevId = navigationIds[currentIndex - 1];
    if (isLoaded(prevId)) {
      onNavigate(prevId);
    } else if (onLoadArticle) {
      onLoadArticle(prevId);
    }
  };

  const handleNext = () => {
    if (isLast) return;
    const nextId = navigationIds[currentIndex + 1];
    if (isLoaded(nextId)) {
      onNavigate(nextId);
    } else if (onLoadArticle) {
      onLoadArticle(nextId);
    }
  };

  // Check if prev/next would load a new article
  const prevId = !isFirst ? navigationIds[currentIndex - 1] : null;
  const nextId = !isLast ? navigationIds[currentIndex + 1] : null;
  const prevWillLoad = prevId && !isLoaded(prevId);
  const nextWillLoad = nextId && !isLoaded(nextId);

  // Show structure info
  const hasStructure = allArticleIds && allArticleIds.length > loadedArticleIds.length;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <button
        onClick={handlePrev}
        disabled={isFirst}
        className={cn(
          "p-1 rounded transition-colors relative",
          isFirst
            ? "text-gray-300 dark:text-gray-600 cursor-not-allowed"
            : prevWillLoad
              ? "text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30"
              : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-300"
        )}
        title={prevWillLoad ? `Carica Art. ${prevId}` : "Articolo precedente"}
      >
        <ChevronLeft size={16} />
        {prevWillLoad && (
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-blue-500 rounded-full" />
        )}
      </button>

      <span className={cn(
        "text-xs font-medium min-w-[50px] text-center tabular-nums",
        hasStructure
          ? "text-blue-600 dark:text-blue-400"
          : "text-gray-500 dark:text-gray-400"
      )}>
        {currentIndex + 1}/{navigationIds.length}
      </span>

      <button
        onClick={handleNext}
        disabled={isLast}
        className={cn(
          "p-1 rounded transition-colors relative",
          isLast
            ? "text-gray-300 dark:text-gray-600 cursor-not-allowed"
            : nextWillLoad
              ? "text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30"
              : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-300"
        )}
        title={nextWillLoad ? `Carica Art. ${nextId}` : "Articolo successivo"}
      >
        <ChevronRight size={16} />
        {nextWillLoad && (
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-blue-500 rounded-full" />
        )}
      </button>
    </div>
  );
}
