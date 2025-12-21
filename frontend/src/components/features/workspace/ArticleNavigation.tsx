import { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { normalizeArticleId } from '../../../utils/treeUtils';

interface ArticleNavigationProps {
  /** All article IDs from structure (for full navigation) */
  allArticleIds?: string[];
  /** Currently loaded article IDs */
  loadedArticleIds: string[];
  /** Currently active article ID */
  activeArticleId: string | null;
  /** Article ID currently being loaded (shows spinner) */
  loadingArticleId?: string | null;
  /** Callback when navigating to a loaded article */
  onNavigate: (id: string) => void;
  /** Callback when navigating to an unloaded article (triggers fetch) */
  onLoadArticle?: (id: string) => void;
  className?: string;
}

/**
 * Navigation arrows with position counter for article navigation.
 * Supports navigation through full structure, loading articles on demand.
 * Double-click on the counter to manually enter an article number.
 */
export function ArticleNavigation({
  allArticleIds,
  loadedArticleIds,
  activeArticleId,
  loadingArticleId,
  onNavigate,
  onLoadArticle,
  className
}: ArticleNavigationProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Use structure if available, otherwise loaded articles
  const navigationIds = allArticleIds && allArticleIds.length > 0
    ? allArticleIds
    : loadedArticleIds;

  if (navigationIds.length <= 1) return null;

  // Create normalized set for comparison (handles "3 bis" vs "3-bis")
  const loadedSetNormalized = new Set(loadedArticleIds.map(normalizeArticleId));
  const isLoaded = (id: string) => loadedSetNormalized.has(normalizeArticleId(id));

  // Find current index using normalized comparison
  const normalizedActiveId = activeArticleId ? normalizeArticleId(activeArticleId) : null;
  const currentIndex = normalizedActiveId
    ? navigationIds.findIndex(id => normalizeArticleId(id) === normalizedActiveId)
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

  // Check if currently loading an article
  const isLoading = !!loadingArticleId;
  const isPrevLoading = prevId && loadingArticleId && normalizeArticleId(prevId) === normalizeArticleId(loadingArticleId);
  const isNextLoading = nextId && loadingArticleId && normalizeArticleId(nextId) === normalizeArticleId(loadingArticleId);

  // Show structure info
  const hasStructure = allArticleIds && allArticleIds.length > loadedArticleIds.length;

  // Handle double-click to edit
  const handleDoubleClick = () => {
    setInputValue(activeArticleId || '');
    setIsEditing(true);
  };

  // Handle input submission
  const handleInputSubmit = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      setIsEditing(false);
      return;
    }

    // Find the article in navigation list (normalized comparison)
    const normalizedInput = normalizeArticleId(trimmed);
    const matchingId = navigationIds.find(id => normalizeArticleId(id) === normalizedInput);

    if (matchingId) {
      // Found in list - navigate or load
      if (isLoaded(matchingId)) {
        onNavigate(matchingId);
      } else if (onLoadArticle) {
        onLoadArticle(matchingId);
      }
    } else if (onLoadArticle) {
      // Not in list but try to load anyway (user might know better)
      onLoadArticle(trimmed);
    }

    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleInputSubmit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <button
        onClick={handlePrev}
        disabled={isFirst || isLoading}
        className={cn(
          "p-1 rounded-md transition-colors relative",
          isFirst || isLoading
            ? "text-slate-300 dark:text-slate-600 cursor-not-allowed"
            : prevWillLoad
              ? "text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/30"
              : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-300"
        )}
        title={isPrevLoading ? 'Caricamento...' : prevWillLoad ? `Carica Art. ${prevId}` : "Articolo precedente"}
      >
        {isPrevLoading ? (
          <Loader2 size={16} className="animate-spin text-primary-500" />
        ) : (
          <ChevronLeft size={16} />
        )}
        {prevWillLoad && !isPrevLoading && (
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-primary-500 rounded-full" />
        )}
      </button>

      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={handleInputSubmit}
          onKeyDown={handleKeyDown}
          className="w-16 text-xs font-medium text-center bg-white dark:bg-slate-800 border border-primary-500 rounded-md px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          placeholder="Art."
        />
      ) : (
        <span
          onDoubleClick={handleDoubleClick}
          className={cn(
            "text-xs font-medium min-w-[50px] text-center tabular-nums cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 px-2 py-1 rounded-md transition-colors select-none",
            hasStructure
              ? "text-primary-600 dark:text-primary-400 font-semibold"
              : "text-slate-500 dark:text-slate-400"
          )}
          title="Doppio click per inserire articolo"
        >
          {currentIndex + 1}
          <span className="text-slate-300 dark:text-slate-600 mx-1">/</span>
          {navigationIds.length}
        </span>
      )}

      <button
        onClick={handleNext}
        disabled={isLast || isLoading}
        className={cn(
          "p-1 rounded-md transition-colors relative",
          isLast || isLoading
            ? "text-slate-300 dark:text-slate-600 cursor-not-allowed"
            : nextWillLoad
              ? "text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/30"
              : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-300"
        )}
        title={isNextLoading ? 'Caricamento...' : nextWillLoad ? `Carica Art. ${nextId}` : "Articolo successivo"}
      >
        {isNextLoading ? (
          <Loader2 size={16} className="animate-spin text-primary-500" />
        ) : (
          <ChevronRight size={16} />
        )}
        {nextWillLoad && !isNextLoading && (
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-primary-500 rounded-full" />
        )}
      </button>
    </div>
  );
}
