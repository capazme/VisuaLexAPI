import { MoreHorizontal, Edit2, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Button } from '../../ui/Button';
import { MenuButton } from '../../ui/MenuButton';
import { buttonClassName } from '../../ui/buttonStyles';
import { formatTimestampLong } from './dossierUtils';
import { lastTouched, DEFAULT_DIR, type SortKey, type SortDir } from './dossierSort';
import { tagLabel } from '../../../utils/tagLabel';
import { deleteDossierWithUndo } from './deleteDossierWithUndo';
import type { Dossier } from '../../../types';

interface Props {
  dossiers: Dossier[];
  isDesktop: boolean;
  sort: SortKey;
  dir: SortDir;
  onSort: (key: SortKey, dir: SortDir) => void;
  onSelect: (id: string) => void;
  onEdit: (d: Dossier) => void;
  onTrashChanged?: () => void;
}

// One row each: name, category, items, last touched, «⋯». Fixed 52 px on a computer, two 44 px lines on a phone.
// The category column is left out when no pratica has one, so no empty column is left.
const COLUMNS = 'md:grid-cols-[minmax(0,1fr)_11rem_6rem_10rem_2.75rem]';
const COLUMNS_NO_CATEGORY = 'md:grid-cols-[minmax(0,1fr)_6rem_10rem_2.75rem]';

const dateOf = (d: Dossier) => {
  const t = lastTouched(d);
  return t === null ? '' : formatTimestampLong(new Date(t).toISOString());
};

export function DossierRows({ dossiers, isDesktop, sort, dir, onSort, onSelect, onEdit, onTrashChanged }: Props) {
  const showCategory = dossiers.some((d) => d.tags?.[0]);
  const columns = showCategory ? COLUMNS : COLUMNS_NO_CATEGORY;
  const header = (key: SortKey, label: string) => {
    const active = sort === key;
    return (
      <div role="columnheader" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="min-w-0">
        <Button
          type="button"
          variant="quiet"
          size="sm"
          onClick={() => onSort(key, active ? (dir === 'asc' ? 'desc' : 'asc') : DEFAULT_DIR[key])}
          className={active ? 'text-slate-900 dark:text-slate-50' : 'text-slate-600 dark:text-slate-400'}
        >
          {label}
          {active && (dir === 'asc' ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />)}
        </Button>
      </div>
    );
  };

  return (
    <div role="table" aria-label="Pratiche" className="overflow-hidden rounded-[8px] border border-slate-200 dark:border-slate-800">
      {isDesktop && (
        <div role="row" className={cn('grid items-center gap-4 border-b border-slate-200 bg-slate-50 px-4 dark:border-slate-800 dark:bg-slate-900', columns)}>
          {header('name', 'Nome')}
          {showCategory && <div role="columnheader" className="text-xs font-medium text-slate-600 dark:text-slate-400">Categoria</div>}
          {header('items', 'Elementi')}
          {header('updated', 'Aggiornata')}
          <div role="columnheader"><span className="sr-only">Azioni</span></div>
        </div>
      )}
      <div role="rowgroup" className="divide-y divide-slate-200 dark:divide-slate-800">
        {dossiers.map((d) => {
          const category = d.tags?.[0] ? tagLabel(d.tags[0]) : '';
          const items = `${d.items.length} ${d.items.length === 1 ? 'elemento' : 'elementi'}`;
          const actions = (
            <MenuButton
              label={`Azioni su ${d.title}`}
              triggerClassName={cn(buttonClassName('quiet', 'lg'), 'min-w-11 px-0')}
              items={[
                { label: 'Rinomina / Modifica', icon: Edit2, onSelect: () => onEdit(d) },
                { label: 'Elimina', icon: Trash2, danger: true, separatorBefore: true, onSelect: () => deleteDossierWithUndo(d, onTrashChanged) },
              ]}
            >
              <MoreHorizontal size={18} />
            </MenuButton>
          );
          return (
            <div
              key={d.id}
              role="row"
              tabIndex={0}
              aria-label={`Apri la pratica ${d.title}`}
              onClick={() => onSelect(d.id)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(d.id); }
              }}
              className={cn('grid cursor-pointer items-center gap-x-4 bg-white px-4 hover:bg-slate-50 dark:bg-slate-950 dark:hover:bg-slate-900', isDesktop ? cn('h-[52px]', columns) : 'grid-cols-[minmax(0,1fr)_2.75rem] py-1')}
            >
              {isDesktop ? (
                <>
                  <div role="cell" title={d.title} className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">{d.title}</div>
                  {showCategory && <div role="cell" title={category} className="truncate text-sm text-slate-600 dark:text-slate-400">{category || '–'}</div>}
                  <div role="cell" className="text-sm tabular-nums text-slate-600 dark:text-slate-400">{d.items.length}</div>
                  <div role="cell" className="truncate text-sm text-slate-600 dark:text-slate-400">{dateOf(d)}</div>
                  <div role="cell" className="-mr-2 flex justify-end" onClick={(e) => e.stopPropagation()}>{actions}</div>
                </>
              ) : (
                <>
                  <div role="cell" className="min-w-0 py-1">
                    <p title={d.title} className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">{d.title}</p>
                    <p className="truncate text-xs text-slate-600 dark:text-slate-400">
                      {[category, items, dateOf(d)].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div role="cell" className="-mr-2 flex justify-end" onClick={(e) => e.stopPropagation()}>{actions}</div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
