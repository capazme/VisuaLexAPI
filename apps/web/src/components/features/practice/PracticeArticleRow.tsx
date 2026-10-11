import { useMemo, type ReactNode } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import type { ArticleData } from '../../../types';
import { ArticleTabContent } from '../search/ArticleTabContent';
import { articleLabel } from '../dossier/dossierLayout';
import { getRubricText, parseArticleStructure } from '../../../utils/articleStructure';
import { historicalItemLabel } from '../../../utils/versionDisplay';
import { shortNorm } from '../../../utils/sources';
import { articleRowKey, practiceArticleKey } from '../../../utils/practice';

export interface PracticeArticleRowProps {
  practiceId: string;
  actId: string;
  article: ArticleData;
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data']) => void;
  onOpenStudyMode: () => void;
  /** Drawn inside the open row, above the text: the annex suggestion that concerns this article. */
  annexSuggestion?: ReactNode;
}

const ICON_BUTTON =
  'flex min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 md:min-h-0 md:min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-900/20';

/**
 * One article of its act on the practice's table (spec §3.2): «art. 2043 — rubrica», a past text's
 * «Testo al …», «Togli dal tavolo». Open, it reads the article in place on the tab's own reading
 * surface, untouched (root rule 23); closed, it mounts nothing. Whether it is open is the store's
 * (`practiceRows`, T15), so a reveal opens it from anywhere.
 */
export function PracticeArticleRow({
  practiceId, actId, article, onCrossReference, onOpenStudyMode, annexSuggestion,
}: PracticeArticleRowProps) {
  const articleKey = practiceArticleKey(article);
  const rowKey = articleRowKey(practiceId, actId, articleKey);
  const isOpen = useAppStore((s) => s.practiceRows[rowKey] === true);
  const setRowOpen = useAppStore((s) => s.setRowOpen);
  const removePracticeArticle = useAppStore((s) => s.removePracticeArticle);

  const { norma_data: norma } = article;
  const text = article.article_text || '';
  // From the article's own text: no request (spec §3.2).
  const rubrica = useMemo(() => (text ? getRubricText(text, parseArticleStructure(text)) : null), [text]);
  // "Testo al 29/12/2007": what was asked for, beside the text, never in it (gotcha 32).
  const historicalLabel = historicalItemLabel(norma);
  // Where a jump out of this row walks back to: the practice, the act, and this row by its key, so
  // a past text comes back as itself (carry-over ruling 12).
  const readingOrigin = useMemo(
    () => ({ tabId: practiceId, blockId: actId, articleKey }),
    [practiceId, actId, articleKey],
  );

  const toggle = () => setRowOpen(rowKey, !isOpen);
  // The accessible name replaces the header's content: it names the act, so two laws' art. 3 never
  // read alike, and the version, so two texts of one article neither.
  const named = shortNorm(norma)
    + (historicalLabel ? `, ${historicalLabel.charAt(0).toLowerCase()}${historicalLabel.slice(1)}` : '');
  const regionId = `practice-row-${rowKey}`;

  return (
    <div
      data-practice-row={rowKey}
      // Clear of the act's sticky heading when scrolled into view.
      className="group scroll-mt-20 rounded-lg py-1 pl-2 pr-1 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
    >
      <div className="flex items-center gap-1 md:gap-2">
        {/* The toggle wraps only text: the remove button stays outside it (gotcha 22). */}
        <div
          role="button"
          tabIndex={0}
          aria-label={`${isOpen ? 'Comprimi' : 'Espandi'} ${named}`}
          aria-expanded={isOpen}
          aria-controls={isOpen ? regionId : undefined}
          onClick={toggle}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle();
            }
          }}
          className="flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-1 md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <ChevronDown
            size={16}
            aria-hidden
            className={cn('flex-shrink-0 text-slate-400 transition-transform', !isOpen && '-rotate-90')}
          />
          <span className="min-w-0 flex-1 truncate text-sm md:text-[15px]">
            <span className="font-medium text-slate-900 dark:text-white">{articleLabel(norma)}</span>
            {rubrica && (
              <span className="text-slate-500 dark:text-slate-400">
                {' — '}
                <span>{rubrica}</span>
              </span>
            )}
          </span>
          {historicalLabel && (
            <span className="flex-shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              {historicalLabel}
            </span>
          )}
        </div>
        {/* No confirmation: the article stays one search away, and the undo is the search. */}
        <button
          type="button"
          onClick={() => removePracticeArticle(practiceId, actId, articleKey)}
          aria-label={`Togli dal tavolo ${named}`}
          title="Togli dal tavolo"
          className={cn(ICON_BUTTON, 'md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100')}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      {isOpen && (
        <div id={regionId} className="pb-3 pl-2 pr-1 pt-1 md:pl-6 md:pr-2">
          {annexSuggestion}
          <ArticleTabContent
            data={article}
            onCrossReferenceNavigate={onCrossReference}
            onOpenStudyMode={onOpenStudyMode}
            readingOrigin={readingOrigin}
          />
        </div>
      )}
    </div>
  );
}
