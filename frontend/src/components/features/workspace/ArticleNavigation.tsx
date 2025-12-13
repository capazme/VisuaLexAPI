import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../../lib/utils';

interface ArticleNavigationProps {
  currentIndex: number;
  totalArticles: number;
  onPrev: () => void;
  onNext: () => void;
  className?: string;
}

/**
 * Navigation arrows with position counter for article navigation.
 * Shows "X/Y" format with left/right arrows.
 */
export function ArticleNavigation({
  currentIndex,
  totalArticles,
  onPrev,
  onNext,
  className
}: ArticleNavigationProps) {
  if (totalArticles <= 1) return null;

  const isFirst = currentIndex === 0;
  const isLast = currentIndex === totalArticles - 1;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <button
        onClick={onPrev}
        disabled={isFirst}
        className={cn(
          "p-1 rounded transition-colors",
          isFirst
            ? "text-gray-300 dark:text-gray-600 cursor-not-allowed"
            : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-300"
        )}
        title="Articolo precedente"
      >
        <ChevronLeft size={16} />
      </button>

      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 min-w-[40px] text-center tabular-nums">
        {currentIndex + 1}/{totalArticles}
      </span>

      <button
        onClick={onNext}
        disabled={isLast}
        className={cn(
          "p-1 rounded transition-colors",
          isLast
            ? "text-gray-300 dark:text-gray-600 cursor-not-allowed"
            : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-300"
        )}
        title="Articolo successivo"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
