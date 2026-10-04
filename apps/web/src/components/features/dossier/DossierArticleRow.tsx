import { useCallback, useState } from 'react';
import { CheckSquare, ChevronDown, Square, Star, Trash2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { historicalItemLabel } from '../../../utils/versionDisplay';
import { getRubricText, parseArticleStructure } from '../../../utils/articleStructure';
import type { ArticleData, DossierItem } from '../../../types';
import { DossierItemReader } from './DossierItemReader';
import { shownAnnex } from './dossierLayout';

type NormaItem = Extract<DossierItem, { type: 'norma' }>;

export interface DossierArticleRowProps {
  item: NormaItem;
  /** From the act's index (`useActDetails`); the row fills it from the text when absent. */
  rubrica: string | null;
  isSelected: boolean;
  showCheckbox: boolean;
  onToggleSelect: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenOnDashboard: () => void;
  onRemove: () => void;
  onToggleImportant: () => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

/**
 * One article inside its act's block: "art. 3 — rubrica", the star, the text read
 * in place (spec §5). The act is named once by the block, so the row never repeats it.
 */
export function DossierArticleRow({
  item, rubrica, isSelected, showCheckbox, onToggleSelect, isExpanded, onToggleExpand,
  onOpenOnDashboard, onRemove, onToggleImportant, showToast,
}: DossierArticleRowProps) {
  const [textRubrica, setTextRubrica] = useState<string | null>(null);
  const onArticle = useCallback((article: ArticleData) => {
    const raw = article.article_text || '';
    setTextRubrica(raw ? getRubricText(raw, parseArticleStructure(raw)) : null);
  }, []);

  const shownRubrica = rubrica ?? textRubrica;
  const annex = shownAnnex(item.data);
  const isImportant = item.status === 'important';
  // "Testo al 29/12/2007": a row that holds a past text says so.
  const historicalLabel = historicalItemLabel(item.data);
  const verb = isExpanded ? 'Comprimi' : 'Espandi';
  // The accessible name replaces the row's content, so it names the act (two
  // laws' art. 3 must never read alike) and the version (two versions of one
  // article neither).
  const named = item.citation
    ?? `${item.data.tipo_atto}${item.data.numero_atto ? ` ${item.data.numero_atto}` : ''} articolo ${item.data.numero_articolo}`;
  const rowLabel = `${verb} ${named}`
    + (historicalLabel ? `, ${historicalLabel.charAt(0).toLowerCase()}${historicalLabel.slice(1)}` : '');
  const regionId = `dossier-item-content-${item.id}`;

  return (
    <div
      className={cn(
        'group relative rounded-lg py-1 pl-3 pr-1 transition-colors',
        isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
      )}
    >
      {isImportant && <span aria-hidden className="absolute bottom-1 left-0 top-1 w-1 rounded bg-amber-400" />}
      <div className="flex items-center gap-1 md:gap-2">
        {showCheckbox && (
          <button
            type="button"
            onClick={onToggleSelect}
            aria-label={isSelected ? 'Deseleziona elemento' : 'Seleziona elemento'}
            aria-pressed={isSelected}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-slate-400 hover:text-blue-500 md:min-h-0 md:min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {isSelected ? <CheckSquare size={18} className="text-blue-500" /> : <Square size={18} />}
          </button>
        )}
        {/* The expand toggle wraps only text: the star and the remove button stay
            outside it, since ARIA makes a role="button"'s descendants presentational. */}
        <div
          role="button"
          tabIndex={0}
          aria-label={rowLabel}
          aria-expanded={isExpanded}
          aria-controls={isExpanded ? regionId : undefined}
          onClick={onToggleExpand}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggleExpand();
            }
          }}
          className="flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-1 md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <ChevronDown
            size={16}
            aria-hidden
            className={cn('flex-shrink-0 text-slate-400 transition-transform', !isExpanded && '-rotate-90')}
          />
          <span className="min-w-0 flex-1 truncate text-sm md:text-[15px]">
            <span className="font-medium text-slate-900 dark:text-white">art. {item.data.numero_articolo}</span>
            {shownRubrica && (
              <span className="text-slate-500 dark:text-slate-400">
                {' — '}
                <span>{shownRubrica}</span>
              </span>
            )}
          </span>
          {annex && (
            <span className="flex-shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              All. {annex}
            </span>
          )}
          {historicalLabel && (
            <span className="flex-shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              {historicalLabel}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onToggleImportant}
          aria-pressed={isImportant}
          aria-label={isImportant ? 'Rimuovi da importanti' : 'Segna come importante'}
          title={isImportant ? 'Importante' : 'Segna come importante'}
          className={cn(
            'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-1.5 transition-colors md:min-h-0 md:min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500',
            isImportant
              ? 'text-amber-500'
              : 'text-slate-300 hover:bg-amber-50 hover:text-amber-500 dark:text-slate-600 dark:hover:bg-amber-900/20',
          )}
        >
          <Star size={16} className={cn(isImportant && 'fill-amber-400')} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Rimuovi articolo dal dossier"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-1.5 text-slate-400 transition-all hover:bg-red-50 hover:text-red-500 md:min-h-0 md:min-w-0 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-900/20"
        >
          <Trash2 size={16} />
        </button>
      </div>
      {isExpanded && (
        <div id={regionId} className="pb-2 pl-6 pr-2">
          <DossierItemReader
            norma={item.data}
            onOpenOnDashboard={onOpenOnDashboard}
            showToast={showToast}
            onArticle={onArticle}
          />
        </div>
      )}
    </div>
  );
}
