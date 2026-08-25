import {
  FileText,
  Trash2,
  GripVertical,
  CheckSquare,
  Square,
  Star,
  ChevronDown,
} from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '../../../lib/utils';
import { formatDateItalianLong } from '../../../utils/dateUtils';
import { formatTimestampLong } from './dossierUtils';
import { DossierItemReader } from './DossierItemReader';
import type { DossierItem } from '../../../types';

interface Props {
  item: DossierItem;
  isSelected: boolean;
  onToggleSelect: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenOnDashboard: () => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onRemove: () => void;
  onToggleImportant: () => void;
  showCheckbox: boolean;
  // When true, drag-reorder is disabled (typically because the list is
  // filtered — dragging against absolute indexes under a filtered view is
  // semantically fine but visually confusing for the user).
  dragDisabled?: boolean;
}

export function SortableDossierItem({
  item,
  isSelected,
  onToggleSelect,
  isExpanded,
  onToggleExpand,
  onOpenOnDashboard,
  showToast,
  onRemove,
  onToggleImportant,
  showCheckbox,
  dragDisabled,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: dragDisabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isImportant = item.status === 'important';

  const expandVerb = isExpanded ? 'Comprimi' : 'Espandi';
  const rowLabel = item.type === 'norma'
    ? `${expandVerb} ${item.data.tipo_atto}${item.data.numero_atto ? ` ${item.data.numero_atto}` : ''} articolo ${item.data.numero_articolo}`
    : `${expandVerb} nota`;
  const regionId = `dossier-item-content-${item.id}`;

  return (
    // Plain container: the expand affordance is the header sub-div below.
    // ARIA treats every descendant of a button as presentational, so the
    // reader (article body, note composer, action buttons) and the star /
    // trash controls must stay OUTSIDE it. The root keeps only the layout
    // so the amber "important" stripe still spans the expanded height.
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative bg-white dark:bg-slate-800 p-3 md:p-4 pl-4 md:pl-5 rounded-lg border shadow-sm group hover:border-blue-300 dark:hover:border-blue-700 transition-colors',
        isSelected ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700',
      )}
    >
      {isImportant && (
        <span aria-hidden className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg bg-amber-400" />
      )}
      <div className="flex items-center gap-2 md:gap-3">
        {showCheckbox && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
            aria-label={isSelected ? 'Deseleziona elemento' : 'Seleziona elemento'}
            aria-pressed={isSelected}
            className="text-slate-400 hover:text-blue-500 p-2 -m-2 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 md:p-0 md:m-0 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          >
            {isSelected ? <CheckSquare size={20} className="text-blue-500" /> : <Square size={20} />}
          </button>
        )}
        <div
          {...(dragDisabled ? {} : attributes)}
          {...(dragDisabled ? {} : listeners)}
          onClick={(e) => e.stopPropagation()}
          aria-hidden={dragDisabled}
          title={dragDisabled ? 'Riordina disabilitato con filtri attivi' : undefined}
          className={cn(
            'hidden md:block',
            dragDisabled
              ? 'text-slate-200 dark:text-slate-700 cursor-not-allowed opacity-50'
              : 'text-slate-300 dark:text-slate-600 cursor-grab hover:text-slate-500',
          )}
        >
          <GripVertical size={20} />
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/20 p-2 rounded text-blue-600 flex-shrink-0">
          <FileText size={18} />
        </div>
        {/* The expand toggle wraps ONLY non-interactive content (title text
            plus the decorative chevron), so nothing focusable is buried
            inside a role="button" subtree. */}
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
          className="flex-1 min-w-0 flex items-center gap-2 py-1 rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
        >
          <div className="flex-1 min-w-0">
            {item.type === 'norma' ? (
              <>
                <h4 className="font-medium text-sm md:text-base text-slate-900 dark:text-white truncate">
                  {item.data.tipo_atto} {item.data.numero_atto}
                </h4>
                <p className="text-xs md:text-sm text-slate-500 truncate">Art. {item.data.numero_articolo} • {formatDateItalianLong(item.data.data || '')}</p>
              </>
            ) : (
              // Hidden while expanded: the full note is rendered below, and
              // the truncated preview would repeat its first line.
              !isExpanded && (
                <p className="text-sm md:text-base text-slate-700 dark:text-slate-300 italic truncate">"{item.data}"</p>
              )
            )}
            <div className="text-xs text-slate-400 mt-1 hidden md:block">
              Aggiunto il {formatTimestampLong(item.addedAt)}
            </div>
          </div>
          <ChevronDown
            size={18} aria-hidden
            className={cn('text-slate-400 transition-transform flex-shrink-0', isExpanded && 'rotate-180')}
          />
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {item.type === 'norma' && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleImportant(); }}
              aria-pressed={isImportant}
              aria-label={isImportant ? 'Rimuovi da importanti' : 'Segna come importante'}
              title={isImportant ? 'Importante' : 'Segna come importante'}
              className={cn(
                'p-1.5 rounded-md transition-colors min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500',
                isImportant
                  ? 'text-amber-500'
                  : 'text-slate-300 dark:text-slate-600 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20',
              )}
            >
              <Star size={18} className={cn(isImportant && 'fill-amber-400')} />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            aria-label="Rimuovi elemento dal dossier"
            className="text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 p-2 rounded-md transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>
      {isExpanded && (
        <div id={regionId}>
          {item.type === 'norma' ? (
            <DossierItemReader
              norma={item.data}
              onOpenOnDashboard={onOpenOnDashboard}
              showToast={showToast}
            />
          ) : (
            <p className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 text-sm md:text-base text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
              {item.data}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
