import { useState, useEffect, useRef } from 'react';
import {
  FileText,
  Trash2,
  GripVertical,
  CheckSquare,
  Square,
} from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '../../../lib/utils';
import { formatDateItalianLong } from '../../../utils/dateUtils';
import { formatTimestampLong, STATUS_CONFIG, type DossierItemStatus } from './dossierUtils';
import type { DossierItem } from '../../../types';

interface Props {
  item: DossierItem;
  isSelected: boolean;
  onToggleSelect: () => void;
  onView: () => void;
  onRemove: () => void;
  onStatusChange: (status: DossierItemStatus) => void;
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
  onView,
  onRemove,
  onStatusChange,
  showCheckbox,
  dragDisabled,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: dragDisabled });
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!statusMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (statusWrapperRef.current && !statusWrapperRef.current.contains(e.target as Node)) {
        setStatusMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStatusMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [statusMenuOpen]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const status = (item.status as DossierItemStatus) || 'unread';
  const statusConfig = STATUS_CONFIG[status] ?? STATUS_CONFIG.unread;
  const StatusIcon = statusConfig.icon;

  const rowLabel = item.type === 'norma'
    ? `Apri ${item.data.tipo_atto}${item.data.numero_atto ? ` ${item.data.numero_atto}` : ''} articolo ${item.data.numero_articolo}`
    : 'Apri nota';

  return (
    <div
      ref={setNodeRef}
      style={style}
      role="button"
      tabIndex={0}
      aria-label={rowLabel}
      onClick={onView}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onView();
        }
      }}
      className={cn(
        'relative bg-white dark:bg-slate-800 p-3 md:p-4 pl-4 md:pl-5 rounded-lg border shadow-sm group hover:border-blue-300 dark:hover:border-blue-700 transition-colors cursor-pointer',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900',
        isSelected ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700',
      )}
    >
      <span
        aria-hidden
        className={cn('absolute left-0 top-0 bottom-0 w-1 rounded-l-lg', statusConfig.stripe)}
      />
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
        <div className="flex-1 min-w-0">
          {item.type === 'norma' ? (
            <>
              <h4 className="font-medium text-sm md:text-base text-slate-900 dark:text-white truncate">
                {item.data.tipo_atto} {item.data.numero_atto}
              </h4>
              <p className="text-xs md:text-sm text-slate-500 truncate">Art. {item.data.numero_articolo} • {formatDateItalianLong(item.data.data || '')}</p>
            </>
          ) : (
            <p className="text-sm md:text-base text-slate-700 dark:text-slate-300 italic truncate">"{item.data}"</p>
          )}
          <div className="text-xs text-slate-400 mt-1 hidden md:block">
            Aggiunto il {formatTimestampLong(item.addedAt)}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <div ref={statusWrapperRef} className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setStatusMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={statusMenuOpen}
              aria-label={`Stato: ${statusConfig.label}. Cambia stato`}
              className={cn(
                'p-2 md:p-2 rounded-md transition-colors min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center',
                'hover:bg-slate-100 dark:hover:bg-slate-700',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                statusConfig.color,
              )}
            >
              <StatusIcon size={18} />
            </button>
            {statusMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-1 w-44 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 py-1 z-50"
              >
                {(Object.entries(STATUS_CONFIG) as [DossierItemStatus, typeof STATUS_CONFIG[DossierItemStatus]][]).map(([key, config]) => (
                  <button
                    key={key}
                    type="button"
                    role="menuitem"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStatusChange(key);
                      setStatusMenuOpen(false);
                    }}
                    className={cn(
                      'w-full px-3 py-2 text-sm text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-700 min-h-[44px] focus-visible:outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-slate-700',
                      status === key && 'bg-slate-100 dark:bg-slate-700',
                    )}
                  >
                    <config.icon size={16} className={config.color} />
                    {config.label}
                  </button>
                ))}
              </div>
            )}
          </div>
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
    </div>
  );
}
