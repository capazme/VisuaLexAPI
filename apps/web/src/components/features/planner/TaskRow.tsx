import { Link } from 'react-router-dom';
import { CalendarDays, Folder, Hourglass, MoreHorizontal, Pencil, Plus, Repeat, Tag, Trash2 } from 'lucide-react';
import { MenuButton } from '../../ui/MenuButton';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import type { Task } from '../../../types/tasks';
import { FOCUS_RING } from '../studia/progress/tokens';
import { LinkedText } from './LinkedText';
import { TaskCheckbox } from './TaskCheckbox';
import { countdown, PRIORITY_LABEL, RECURRENCE_LABEL, shortDay } from './taskDates';
import { DEADLINE_TONE, ICON_BUTTON, META, PRIORITY_STRIPE, PRIORITY_TEXT } from './plannerStyles';

export interface TaskRowActions {
  onTick: (task: Task) => void;
  onOpen: (task: Task, focus?: 'subtask') => void;
  onTrash: (task: Task) => void;
}

interface Props extends TaskRowActions {
  task: Task;
  today: string;
  /** Off in the dossier's own panel, where every task is that dossier's. */
  showDossier: boolean;
  /** A subtask: indented under its parent, and it takes no subtasks of its own (one level). */
  isChild?: boolean;
  children?: React.ReactNode;
}

const time = (value: string | null) => (value ? ` · ${value}` : '');

/**
 * One task: the tick (a real checkbox, so Space ticks it), the title (opens the task), then its line — the
 * deadline first and bordered, with its count, then the planned day, the repetition, the priority in words, the
 * labels and the dossier — and «⋯». The list moves between rows with the arrows (`TaskList`).
 */
export function TaskRow({ task, today, showDossier, isChild = false, onTick, onOpen, onTrash, children }: Props) {
  const dossierTitle = useAppStore((s) => (task.dossierId ? s.dossiers.find((d) => d.id === task.dossierId)?.title : undefined));
  const stripe = PRIORITY_STRIPE[task.priority];
  const due = task.dueDate ? countdown(task.dueDate, today) : null;
  const plannedLate = task.plannedDate !== null && task.plannedDate < today;

  return (
    <li data-task-row data-task-id={task.id} className="relative min-w-0">
      <div className="group relative flex items-start gap-1 rounded-xl py-1 pl-1 pr-1 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40">
        {stripe && <span aria-hidden className={cn('absolute bottom-2 left-0 top-2 w-1 rounded-full', stripe)} />}
        <TaskCheckbox label={`Segna come fatto: ${task.title}`} onTick={() => onTick(task)} focusTarget />

        <div className="min-w-0 flex-1 pb-2.5">
          <button
            type="button"
            onClick={() => onOpen(task)}
            className={cn('flex min-h-[44px] w-full items-center rounded py-2.5 text-left text-[15px] leading-snug text-slate-900 [overflow-wrap:anywhere] hover:underline hover:underline-offset-2 dark:text-slate-50', FOCUS_RING)}
          >
            {task.title}
          </button>
          {task.description && (
            <p className="-mt-1.5 mb-0.5 line-clamp-2 text-sm text-slate-600 [overflow-wrap:anywhere] dark:text-slate-400">
              <LinkedText text={task.description} />
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {due && task.dueDate && (
              <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-semibold', DEADLINE_TONE[due.tone])}>
                <Hourglass size={12} aria-hidden />
                <span>
                  {due.tone === 'today'
                    ? `Termine finale: scade oggi${time(task.dueTime)}`
                    : `Termine finale ${shortDay(task.dueDate, today).toLowerCase()}${time(task.dueTime)} · ${due.text}`}
                </span>
              </span>
            )}
            {task.plannedDate && (
              <span className={cn(META, plannedLate && 'font-medium text-red-700 dark:text-red-300')}>
                <CalendarDays size={12} aria-hidden />
                <span className="sr-only">Data pianificata: </span>
                {shortDay(task.plannedDate, today)}
                {time(task.plannedTime)}
              </span>
            )}
            {task.recurrence && (
              <span className={META}>
                <Repeat size={12} aria-hidden />
                {RECURRENCE_LABEL[task.recurrence]}
              </span>
            )}
            {task.priority < 4 && (
              <span className={cn('text-xs font-semibold', PRIORITY_TEXT[task.priority])}>
                {task.priority === 1 ? 'Urgente' : `Priorità ${PRIORITY_LABEL[task.priority].toLowerCase()}`}
              </span>
            )}
            {task.labels.map((label) => (
              <span key={label} className={cn(META, 'rounded bg-slate-100 px-1.5 py-0.5 text-slate-700 dark:bg-slate-800 dark:text-slate-300')}>
                <Tag size={11} aria-hidden />
                <span className="sr-only">Etichetta: </span>
                <span className="truncate">{label}</span>
              </span>
            ))}
            {showDossier && task.dossierId && (
              <Link
                to={`/dossier?dossier=${encodeURIComponent(task.dossierId)}`}
                // 44 px tall for a finger, its 14 px above and below laid over the gaps (the line stays its height).
                className={cn(META, '-my-3.5 min-h-[44px] max-w-full rounded hover:text-slate-900 hover:underline dark:hover:text-slate-100', FOCUS_RING)}
              >
                <Folder size={12} aria-hidden className="shrink-0" />
                <span className="sr-only">Dossier: </span>
                <span className="truncate">{dossierTitle ?? 'Dossier'}</span>
              </Link>
            )}
          </div>
        </div>

        <MenuButton
          label={`Azioni: ${task.title}`}
          triggerClassName={ICON_BUTTON}
          items={[
            { label: 'Modifica', icon: Pencil, onSelect: () => onOpen(task) },
            ...(isChild ? [] : [{ label: 'Aggiungi un sottocompito', icon: Plus, onSelect: () => onOpen(task, 'subtask') }]),
            { label: 'Sposta nel cestino', icon: Trash2, danger: true, separatorBefore: true, onSelect: () => onTrash(task) },
          ]}
        >
          <MoreHorizontal size={18} aria-hidden />
        </MenuButton>
      </div>
      {children}
    </li>
  );
}
