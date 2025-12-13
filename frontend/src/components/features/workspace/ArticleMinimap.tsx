import { useState } from 'react';
import { Map } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { normalizeArticleId } from '../../../utils/treeUtils';

interface ArticleMinimapProps {
  /** All article IDs from the structure (complete list) */
  allArticleIds?: string[];
  /** Currently loaded article IDs */
  loadedArticleIds: string[];
  /** Currently active/selected article ID */
  activeArticleId: string | null;
  /** Callback when clicking an article */
  onArticleClick: (id: string) => void;
  /** Whether the article is already loaded (for styling) */
  className?: string;
}

/**
 * Row of clickable dots representing articles.
 * - Filled dots = loaded articles
 * - Empty/ring dots = not loaded (from structure)
 * - Active article is highlighted with larger, colored dot.
 *
 * If allArticleIds is provided, shows full structure.
 * Otherwise falls back to showing only loaded articles.
 */
export function ArticleMinimap({
  allArticleIds,
  loadedArticleIds,
  activeArticleId,
  onArticleClick,
  className
}: ArticleMinimapProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Use structure if available, otherwise just loaded articles
  const displayIds = allArticleIds && allArticleIds.length > 0
    ? allArticleIds
    : loadedArticleIds;

  if (displayIds.length <= 1) return null;

  // Create normalized set for comparison (handles "3 bis" vs "3-bis")
  const loadedSetNormalized = new Set(loadedArticleIds.map(normalizeArticleId));
  const isLoaded = (id: string) => loadedSetNormalized.has(normalizeArticleId(id));
  const isActive = (id: string) => activeArticleId && normalizeArticleId(id) === normalizeArticleId(activeArticleId);

  const showCompact = displayIds.length > 15;
  const hasStructure = allArticleIds && allArticleIds.length > loadedArticleIds.length;

  // Collapsed view: show summary button
  if (!isExpanded && displayIds.length > 8) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md transition-colors",
          "text-gray-500 hover:text-gray-700 hover:bg-gray-100",
          "dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800",
          className
        )}
        title="Mostra mappa articoli"
      >
        <Map size={14} />
        <span>{loadedArticleIds.length}/{displayIds.length}</span>
        {hasStructure && (
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
        )}
      </button>
    );
  }

  return (
    <div className={cn("relative", className)}>
      {/* Collapse button for expanded view */}
      {isExpanded && displayIds.length > 8 && (
        <button
          onClick={() => setIsExpanded(false)}
          className="absolute -top-1 -right-1 w-4 h-4 bg-gray-200 dark:bg-gray-700 rounded-full text-[10px] text-gray-500 hover:bg-gray-300 dark:hover:bg-gray-600 z-10"
          title="Comprimi"
        >
          ×
        </button>
      )}

      <div className={cn(
        "flex items-center gap-1 overflow-x-auto no-scrollbar p-1 rounded-lg",
        isExpanded && "bg-gray-100 dark:bg-gray-800/50"
      )}>
        {displayIds.map((id) => {
          const active = isActive(id);
          const loaded = isLoaded(id);

          return (
            <button
              key={id}
              onClick={() => onArticleClick(id)}
              className={cn(
                "rounded-full transition-all flex-shrink-0",
                active
                  ? "w-3 h-3 bg-blue-500 ring-2 ring-blue-200 dark:ring-blue-800"
                  : loaded
                    ? "w-2 h-2 bg-gray-400 dark:bg-gray-500 hover:bg-blue-400 dark:hover:bg-blue-500"
                    : "w-2 h-2 border border-gray-300 dark:border-gray-600 hover:border-blue-400 hover:bg-blue-100 dark:hover:border-blue-500 dark:hover:bg-blue-900/30",
                showCompact && !active && "w-1.5 h-1.5"
              )}
              title={`Art. ${id}${loaded ? '' : ' (click per caricare)'}`}
              aria-label={`${loaded ? 'Vai a' : 'Carica'} articolo ${id}`}
            />
          );
        })}
      </div>
    </div>
  );
}
