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
 * Navigation arrows around the article's own number («Art. 2043»), through the full structure, loading articles on
 * demand. A tap on the number opens a field to write another one (LC68: a phone has no double click).
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Set by Enter and Esc: the focus goes back to «Art. …» once the field is gone (LC70). Not after a blur, which went elsewhere.
  const refocus = useRef(false);
  // Set once Enter or Esc has closed the field: a blur after it (the field leaving the page) sends nothing again.
  const closed = useRef(false);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    } else if (!isEditing && refocus.current) {
      refocus.current = false;
      buttonRef.current?.focus();
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
  // The arrows name the article they lead to; one not yet on the table says it is loaded (LC68: no dot).
  const arrowLabel = (id: string | null, loading: unknown, willLoad: unknown, none: string) =>
    loading ? 'Caricamento…' : !id ? none : willLoad ? `Carica Art. ${id}` : `Art. ${id}`;
  const prevLabel = arrowLabel(prevId, isPrevLoading, prevWillLoad, 'Nessun articolo precedente');
  const nextLabel = arrowLabel(nextId, isNextLoading, nextWillLoad, 'Nessun articolo successivo');

  const startEditing = () => {
    setInputValue(activeArticleId || '');
    closed.current = false;
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
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    // The focus goes back to «Art. …» within this keydown: without this, a real Enter's keypress lands on the button as
    // a click and opens the field again with the old number (LC70, Papiniano on #556).
    e.preventDefault();
    closed.current = true;
    refocus.current = true;
    if (e.key === 'Enter') handleInputSubmit();
    else setIsEditing(false);
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <button
        type="button"
        onClick={handlePrev}
        disabled={isFirst || isLoading}
        className={cn(
          "vlx-hover-tile flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md md:min-h-0 md:min-w-0 md:p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500",
          isFirst || isLoading
            ? "text-slate-300 dark:text-slate-600 cursor-not-allowed"
            : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
        )}
        title={prevLabel}
        aria-label={prevLabel}
      >
        {isPrevLoading ? (
          <Loader2 size={16} className="animate-spin text-primary-500" />
        ) : (
          <ChevronLeft size={16} aria-hidden />
        )}
      </button>

      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={() => { if (!closed.current) handleInputSubmit(); }}
          onKeyDown={handleKeyDown}
          aria-label="Numero dell'articolo"
          enterKeyHint="go"
          // 16 px on a phone: under it Safari on iPhone zooms the page when the field is touched (LC70).
          className="h-11 w-20 rounded-md border border-slate-300 bg-white px-2 text-center text-base font-medium tabular-nums text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 md:h-7 md:text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          placeholder="Art."
        />
      ) : (
        <button
          ref={buttonRef}
          type="button"
          onClick={startEditing}
          aria-label={activeArticleId ? `Art. ${activeArticleId}, scrivi un altro numero` : 'Scrivi il numero di un articolo'}
          className="vlx-hover-tile flex min-h-[44px] items-center whitespace-nowrap rounded-md px-2 text-sm font-medium tabular-nums text-slate-900 md:min-h-0 md:py-0.5 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
        >
          Art. {activeArticleId ?? '…'}
        </button>
      )}

      <button
        type="button"
        onClick={handleNext}
        disabled={isLast || isLoading}
        className={cn(
          "vlx-hover-tile flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md md:min-h-0 md:min-w-0 md:p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500",
          isLast || isLoading
            ? "text-slate-300 dark:text-slate-600 cursor-not-allowed"
            : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
        )}
        title={nextLabel}
        aria-label={nextLabel}
      >
        {isNextLoading ? (
          <Loader2 size={16} className="animate-spin text-primary-500" />
        ) : (
          <ChevronRight size={16} aria-hidden />
        )}
      </button>
    </div>
  );
}
