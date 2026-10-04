import { ChevronDown, ExternalLink, GripVertical, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '../../../lib/utils';
import { MenuButton } from '../../ui/MenuButton';
import type { DossierItem } from '../../../types';
import { DossierArticleRow } from './DossierArticleRow';
import { foldedArticleList, type ActBlock } from './dossierLayout';
import { useActDetails } from './useActDetails';

export interface DossierActBlockProps {
  block: ActBlock;
  /** Off while the dossier's search filters the page. */
  dragDisabled: boolean;
  isFolded: boolean;
  onToggleFold: () => void;
  expandedIds: Set<string>;
  onToggleExpand: (itemId: string) => void;
  selectedIds: Set<string>;
  showCheckbox: boolean;
  onToggleSelect: (itemId: string) => void;
  /** "Apri tutto" for this act's groups. */
  onOpenAct: () => void;
  /** The act's index, to take more of its articles. */
  onAddArticles: () => void;
  /** All its articles, behind one undo toast. */
  onRemoveAct: () => void;
  onOpenItem: (item: DossierItem) => void;
  onRemoveItem: (item: DossierItem) => void;
  onToggleImportant: (item: DossierItem) => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const ACTION_BUTTON =
  'flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-lg px-2 text-sm text-slate-600 transition-colors hover:bg-slate-100 md:min-h-0 md:min-w-0 md:py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-300 dark:hover:bg-slate-700';

/** One act, named once, with its articles beneath it (spec §4). */
export function DossierActBlock(props: DossierActBlockProps) {
  const { block, dragDisabled, isFolded, onToggleFold } = props;
  const { title, rubricaOf } = useActDetails(block);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.key, disabled: dragDisabled });
  const count = block.articles.length;

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      aria-label={block.heading}
      className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800"
    >
      <header className="flex items-start gap-1 border-b border-slate-100 px-2 py-2 md:gap-2 md:px-3 dark:border-slate-700">
        {!dragDisabled && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Sposta ${block.heading}`}
            className="mt-1.5 hidden cursor-grab rounded text-slate-300 hover:text-slate-500 md:block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-600"
          >
            <GripVertical size={18} />
          </button>
        )}
        <div
          role="button"
          tabIndex={0}
          aria-expanded={!isFolded}
          aria-label={`${isFolded ? 'Apri' : 'Chiudi'} ${block.heading}`}
          onClick={onToggleFold}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggleFold();
            }
          }}
          className="min-w-0 flex-1 cursor-pointer rounded-md px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <div className="flex items-center gap-2">
            <ChevronDown
              size={16}
              aria-hidden
              className={cn('flex-shrink-0 text-slate-400 transition-transform', isFolded && '-rotate-90')}
            />
            <h3
              className={cn(
                'min-w-0 truncate text-base font-semibold',
                block.headingIsFallback ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-white',
              )}
            >
              {block.heading}
            </h3>
            <span className="flex-shrink-0 text-xs text-slate-400">
              {count === 1 ? '1 articolo' : `${count} articoli`}
            </span>
          </div>
          {title && (
            <p className="ml-6 truncate text-sm text-slate-500 dark:text-slate-400" title={title}>{title}</p>
          )}
          {isFolded && (
            <p className="ml-6 truncate text-sm text-slate-500 dark:text-slate-400">{foldedArticleList(block)}</p>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center">
          <button
            type="button"
            onClick={props.onOpenAct}
            title="Apri tutto su Dashboard"
            aria-label={`Apri tutto ${block.heading} su Dashboard`}
            className={ACTION_BUTTON}
          >
            <ExternalLink size={15} aria-hidden />
            <span className="hidden lg:inline">Apri tutto</span>
          </button>
          <button
            type="button"
            onClick={props.onAddArticles}
            title="Aggiungi articoli di quest'atto"
            aria-label={`Aggiungi articoli di ${block.heading}`}
            className={ACTION_BUTTON}
          >
            <Plus size={15} aria-hidden />
            <span className="hidden lg:inline">Articoli</span>
          </button>
          <MenuButton
            label={`Azioni su ${block.heading}`}
            triggerClassName={cn(ACTION_BUTTON, 'text-slate-500')}
            items={[{ label: "Rimuovi l'atto dal dossier", icon: Trash2, danger: true, onSelect: props.onRemoveAct }]}
          >
            <MoreHorizontal size={18} />
          </MenuButton>
        </div>
      </header>
      {!isFolded && (
        <div className="px-1 py-1 md:px-2">
          {block.articles.map((item) => (
            <DossierArticleRow
              key={item.id}
              item={item}
              rubrica={rubricaOf(item.data)}
              isSelected={props.selectedIds.has(item.id)}
              showCheckbox={props.showCheckbox}
              onToggleSelect={() => props.onToggleSelect(item.id)}
              isExpanded={props.expandedIds.has(item.id)}
              onToggleExpand={() => props.onToggleExpand(item.id)}
              onOpenOnDashboard={() => props.onOpenItem(item)}
              onRemove={() => props.onRemoveItem(item)}
              onToggleImportant={() => props.onToggleImportant(item)}
              showToast={props.showToast}
            />
          ))}
        </div>
      )}
    </section>
  );
}
