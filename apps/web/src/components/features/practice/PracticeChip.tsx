import { GripVertical, MoreHorizontal, Pencil, X } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { MenuButton } from '../../ui/MenuButton';
import { practiceCountLine, practiceCounts } from '../../../utils/practice';
import { PracticeNameInput } from './PracticeParts';
import { closePracticeWithUndo } from './practiceUndo';
import { usePracticeSaveActions } from './usePracticeSaveActions';

export interface PracticeChipProps {
  practiceId: string;
  isActive: boolean;
  /** Its name opens for editing (a practice just made with «+ Nuova pratica»). */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}

/**
 * One practice in the bar (spec §5): its name and a count («2 atti · 1 sentenza»), the active one
 * marked (`aria-current`). A click makes it active, a double click renames it, the handle drags it
 * (the bar's sortable list), «⋯» renames or closes it (behind its danger confirmation).
 */
export function PracticeChip({ practiceId, isActive, editing, onEditingChange }: PracticeChipProps) {
  const practice = useAppStore((s) => s.practices.find((p) => p.id === practiceId));
  const setActivePractice = useAppStore((s) => s.setActivePractice);
  const renamePractice = useAppStore((s) => s.renamePractice);
  const save = usePracticeSaveActions(practiceId);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: practiceId });

  if (!practice) return null;
  const counts = practiceCounts(practice);
  // The bar's line is shorter than the table's: acts and decisions («2 atti · 1 sentenza»).
  const countLine = practiceCountLine({ ...counts, articles: 0 }) || 'Vuota';

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      data-testid="practice-chip"
      className={cn(
        'flex min-w-[150px] max-w-[220px] items-start gap-1 rounded-xl border p-2 transition-colors',
        isActive
          ? 'border-primary-200 bg-primary-50/60 ring-1 ring-primary-500/10 dark:border-primary-800 dark:bg-primary-900/20'
          : 'border-slate-200 bg-white hover:border-primary-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-primary-600',
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Sposta la pratica ${practice.label}`}
        className="mt-1 cursor-grab rounded text-slate-300 hover:text-slate-500 active:cursor-grabbing dark:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <GripVertical size={12} aria-hidden />
      </button>
      {editing ? (
        <PracticeNameInput
          initial={practice.label}
          className="flex-1 text-xs font-bold"
          onDone={(name) => {
            onEditingChange(false);
            if (name !== null) renamePractice(practiceId, name);
          }}
        />
      ) : (
        <button
          type="button"
          aria-current={isActive ? 'true' : undefined}
          onClick={() => setActivePractice(practiceId)}
          onDoubleClick={() => onEditingChange(true)}
          title={practice.label}
          className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <span className={cn(
            'block truncate text-xs font-bold',
            isActive ? 'text-primary-700 dark:text-primary-300' : 'text-slate-700 dark:text-slate-300',
          )}>
            {practice.label}
          </span>
          <span className="block truncate text-[10px] font-medium text-slate-500 dark:text-slate-400">{countLine}</span>
        </button>
      )}
      <MenuButton
        label={`Altre azioni per la pratica ${practice.label}`}
        placement="above"
        triggerClassName="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        items={[
          { label: 'Rinomina', icon: Pencil, onSelect: () => onEditingChange(true) },
          ...save.items,
          { label: 'Chiudi la pratica', icon: X, danger: true, separatorBefore: true, onSelect: () => closePracticeWithUndo(practiceId) },
        ]}
      >
        <MoreHorizontal size={14} aria-hidden />
      </MenuButton>
      {save.overlay}
    </div>
  );
}
