import { ChevronDown, ExternalLink, GripVertical, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '../../../lib/utils';
import { MenuButton } from '../../ui/MenuButton';
import type { DossierItem } from '../../../types';
import { DossierArticleRow } from './DossierArticleRow';
import { foldedArticleList, type ActBlock } from './dossierLayout';
import { useActDetails } from './useActDetails';
import { FOCUS_RING } from '../studia/progress/tokens';
import { ROW_LINE, SECTION_COUNT, SECTION_HEADING, SECTION_TILE } from './dossierStyles';

export interface DossierActBlockProps {
  /** What is shown: the act's articles the dossier's search left. */
  block: ActBlock;
  /** The whole act, for its title and rubriche: a search must not read the act again. */
  act?: ActBlock;
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
  /** Article item id → the notes about it. */
  attachedNotes?: Map<string, Extract<DossierItem, { type: 'note' }>[]>;
  onAddNote?: (item: DossierItem) => void;
  onRemoveNote?: (note: DossierItem) => void;
  /** The article a decision's citation has just opened, ringed for a moment (D7d). */
  flashedId?: string | null;
  /** 3 under the page's «Norme» (D7a, the decisions beside the acts), else 2. */
  headingLevel?: 2 | 3;
}

/** An act's action: 44 px at every width, as the planner's controls (S7c). */
const ACTION_BUTTON = cn(
  'flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-lg px-2 text-sm text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
  FOCUS_RING,
);

/** One act, named once in the reader's serif, with its articles beneath it as rows of two levels (spec §4, S7c). */
export function DossierActBlock(props: DossierActBlockProps) {
  const { block, dragDisabled, isFolded, onToggleFold } = props;
  const { title, rubricaOf } = useActDetails(props.act ?? block);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.key, disabled: dragDisabled });
  const count = block.articles.length;
  const Heading = props.headingLevel === 3 ? 'h3' : 'h2';
  const countLabel = count === 1 ? '1 articolo' : `${count} articoli`;

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      aria-label={block.heading}
      // A container: in the dossier's left column (D7a) the actions keep their words only where the act is wide.
      className={cn(SECTION_TILE, '@container')}
    >
      <header className="flex items-start gap-1 border-b border-slate-200 px-2 py-1 md:gap-2 md:px-3 dark:border-slate-800">
        {!dragDisabled && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Sposta ${block.heading}`}
            className={cn('-ml-1 hidden h-11 w-11 cursor-grab place-items-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700 md:grid dark:text-slate-400 dark:hover:bg-slate-800', FOCUS_RING)}
          >
            <GripVertical size={18} />
          </button>
        )}
        <div className="min-w-0 flex-1 px-1 py-1">
          {/* The accordion pattern: the heading holds the toggle, so the act is a
              heading to a screen reader and its name is the act's own words. */}
          {/* On one line, the name cut, while the act is 42 rem wide (672 px at the default text size); narrower — a phone, a tablet's narrow window, the
              left column of two (D7a) — it wraps: a cut act name says nothing. Its count then follows the name's last
              words, on its line, not on a line of its own under a name of two (the left column at 1024 px). */}
          <Heading className="flex min-w-0 flex-wrap items-center gap-x-2 @2xl:flex-nowrap">
            <div
              role="button"
              tabIndex={0}
              aria-expanded={!isFolded}
              onClick={onToggleFold}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onToggleFold();
                }
              }}
              className={cn(
                'flex min-h-[44px] min-w-0 cursor-pointer items-center gap-2 rounded-md',
                SECTION_HEADING,
                FOCUS_RING,
                block.headingIsFallback && 'text-slate-500 dark:text-slate-400',
              )}
            >
              <ChevronDown
                size={16}
                aria-hidden
                className={cn('flex-shrink-0 text-slate-500 transition-transform motion-reduce:transition-none dark:text-slate-400', isFolded && '-rotate-90')}
              />
              <span className="break-words @2xl:truncate">
                {block.heading}
                {/* Shown in the name's flow while narrow; the heading's own count, below, says it to a screen reader. */}
                <span aria-hidden className={cn(SECTION_COUNT, 'ml-2 whitespace-nowrap @2xl:hidden')}>{countLabel}</span>
              </span>
            </div>
            <span className={cn('flex-shrink-0 sr-only @2xl:not-sr-only', SECTION_COUNT)}>{countLabel}</span>
          </Heading>
          {title && (
            <p className={cn(ROW_LINE, 'ml-6 line-clamp-2 @2xl:line-clamp-none @2xl:truncate')} title={title}>{title}</p>
          )}
          {isFolded && (
            <p className={cn(ROW_LINE, 'mb-1 ml-6 truncate')}>{foldedArticleList(block)}</p>
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
            {/* From lg, and while the act is 42 rem wide: in the left column of two its name takes the room. */}
            <span className="hidden lg:@2xl:inline">Apri tutto</span>
          </button>
          <button
            type="button"
            onClick={props.onAddArticles}
            title="Aggiungi articoli di quest'atto"
            aria-label={`Aggiungi articoli di ${block.heading}`}
            className={ACTION_BUTTON}
          >
            <Plus size={15} aria-hidden />
            <span className="hidden lg:@2xl:inline">Articoli</span>
          </button>
          <MenuButton
            label={`Azioni su ${block.heading}`}
            triggerClassName={cn(ACTION_BUTTON, 'text-slate-500')}
            // In the left column of two, which scrolls on its own (D7d), the last act's menu opens upwards.
            placement="auto"
            items={[{ label: "Rimuovi l'atto dal dossier", icon: Trash2, danger: true, onSelect: props.onRemoveAct }]}
          >
            <MoreHorizontal size={18} />
          </MenuButton>
        </div>
      </header>
      {!isFolded && (
        <div className="px-1 md:px-2">
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
              notes={props.attachedNotes?.get(item.id)}
              onAddNote={props.onAddNote ? () => props.onAddNote?.(item) : undefined}
              onRemoveNote={props.onRemoveNote}
              isFlashing={props.flashedId === item.id}
            />
          ))}
        </div>
      )}
    </section>
  );
}
