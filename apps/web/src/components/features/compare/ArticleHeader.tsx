import { X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { IconButton } from '../../ui/IconButton';
import type { CompareArticle } from '../../../hooks/useCompare';

interface ArticleHeaderProps {
  article: CompareArticle;
  side: 'left' | 'right';
  onRemove: () => void;
  className?: string;
}

/** What one side of the comparison is: its article number, its name with the version, and the way to take it out. */
export function ArticleHeader({ article, side, onRemove, className }: ArticleHeaderProps) {
  const articleNumber = article.article.norma_data.numero_articolo;
  const allegato = article.article.norma_data.allegato;

  return (
    <div className={cn('flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-900/50', className)}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn(
          'w-8 h-8 rounded-md flex items-center justify-center font-bold text-xs shrink-0',
          side === 'left'
            ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
            : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
        )}>
          {articleNumber}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-slate-900 dark:text-white truncate">
              Art. {articleNumber}
            </span>
            {allegato && (
              <span className="text-xs px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded">
                All. {allegato}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
            {article.label}
          </p>
        </div>
      </div>
      <IconButton
        size="sm"
        onClick={onRemove}
        title="Rimuovi dal confronto"
        aria-label={`Rimuovi dal confronto: ${article.label}`}
        icon={<X aria-hidden />}
        className="text-slate-500 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-900/20 dark:hover:text-red-400"
      />
    </div>
  );
}
