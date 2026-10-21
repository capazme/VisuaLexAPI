import { Link } from 'react-router-dom';
import { CalendarDays, ChevronRight, Folder, Hourglass, ListTree, MoreHorizontal, Pencil, Plus, Repeat, Tag, Trash2 } from 'lucide-react';
import { MenuButton } from '../../ui/MenuButton';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import type { Task } from '../../../types/tasks';
import { FOCUS_RING } from '../studia/progress/tokens';
import { tagLabel } from '../../../utils/tagLabel';
import { LinkedText } from './LinkedText';
import { TaskCheckbox } from './TaskCheckbox';
import { countdown, dayTone, PRIORITY_LABEL, RECURRENCE_LABEL, rowDay, shortDay } from './taskDates';
import { DAY_TONE, DEADLINE_TONE, ICON_BUTTON, META, PRIORITY_TEXT } from './plannerStyles';

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
  /** The subtasks listed under it, and whether they are open (the counter opens and folds them). */
  subtasks?: { count: number; open: boolean; onToggle: () => void };
  children?: React.ReactNode;
}

const time = (value: string | null) => (value ? ` · ${value}` : '');

/**
 * One task, on two levels as the list's rows are (P2b): the tick (a real checkbox, so Space ticks it; its ring the
 * priority's), the title (opens the task's sheet), its description in one grey line, then a line of signs — the
 * planned day in its colour and in words (`rowDay`: «Domani», «venerdì», «Ieri · in ritardo di 1 giorno»), the
 * deadline bordered with its count, the subtasks' counter (which opens them in place), the repetition, the priority in
 * words, the labels — with the dossier at its right end, in grey; and «⋯». The list moves between rows with the arrows
 * (`TaskList`).
 */
export function TaskRow({ task, today, showDossier, subtasks, onTick, onOpen, onTrash, children }: Props) {
  const dossierTitle = useAppStore((s) => (task.dossierId ? s.dossiers.find((d) => d.id === task.dossierId)?.title : undefined));
  const due = task.dueDate ? countdown(task.dueDate, today) : null;
  const hasSigns = Boolean(task.plannedDate || due || (subtasks && subtasks.count > 0) || task.recurrence || task.priority < 4 || task.labels.length > 0 || (showDossier && task.dossierId));

  return (
    <li data-task-row data-task-id={task.id} className="relative min-w-0">
      <div className="group relative flex items-start gap-1 border-b border-slate-200 py-0.5 pr-0.5 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/30">
        <TaskCheckbox
          label={`Segna come fatto: ${task.title}${task.priority < 4 ? `, priorità ${PRIORITY_LABEL[task.priority].toLowerCase()}` : ''}`}
          priority={task.priority}
          onTick={() => onTick(task)}
          focusTarget
        />

        <div className={cn('min-w-0 flex-1', hasSigns ? 'pb-2' : 'pb-0.5')}>
          <button
            type="button"
            data-task-title
            onClick={() => onOpen(task)}
            className={cn('flex min-h-[44px] w-full items-center rounded py-2.5 text-left text-[15px] leading-snug text-slate-900 [overflow-wrap:anywhere] hover:underline hover:underline-offset-2 dark:text-slate-50', FOCUS_RING)}
          >
            {task.title}
          </button>
          {task.description && (
            <p className="-mt-2 mb-0.5 line-clamp-1 text-[13px] text-slate-600 [overflow-wrap:anywhere] dark:text-slate-400">
              <LinkedText text={task.description} />
            </p>
          )}
          {hasSigns && (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {task.plannedDate && (
                <span className={cn(META, DAY_TONE[dayTone(task.plannedDate, today)])}>
                  <CalendarDays size={12} aria-hidden />
                  <span className="sr-only">Data pianificata: </span>
                  {rowDay(task.plannedDate, today)}
                  {time(task.plannedTime)}
                </span>
              )}
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
              {subtasks && subtasks.count > 0 && (
                <button
                  type="button"
                  aria-expanded={subtasks.open}
                  onClick={subtasks.onToggle}
                  // 44 px tall for a finger, its extra height laid over the gaps (the line stays its height).
                  className={cn(META, '-my-3.5 min-h-[44px] rounded px-1 hover:text-slate-900 dark:hover:text-slate-100', FOCUS_RING)}
                >
                  <ChevronRight size={12} aria-hidden className={cn('transition-transform motion-reduce:transition-none', subtasks.open && 'rotate-90')} />
                  <ListTree size={12} aria-hidden />
                  {subtasks.count}
                  <span className="sr-only">{subtasks.count === 1 ? ' sottocompito' : ' sottocompiti'}</span>
                </button>
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
                <span key={label} className={cn(META, 'max-w-full rounded bg-slate-100 px-1.5 py-0.5 text-slate-700 dark:bg-slate-800 dark:text-slate-300')}>
                  <Tag size={11} aria-hidden />
                  <span className="sr-only">Etichetta: </span>
                  {/* Shown as the dossiers' tags are, its first letter capitalised; stored as typed. */}
                  <span className="truncate">{tagLabel(label)}</span>
                </span>
              ))}
              {showDossier && task.dossierId && (
                <Link
                  to={`/dossier?dossier=${encodeURIComponent(task.dossierId)}`}
                  // At the line's right end; 44 px tall for a finger, its extra height laid over the gaps.
                  className={cn(META, '-my-3.5 ml-auto min-h-[44px] max-w-full rounded hover:text-slate-900 hover:underline dark:hover:text-slate-100 sm:max-w-[45%]', FOCUS_RING)}
                >
                  <span className="sr-only">Dossier: </span>
                  <span className="truncate">{dossierTitle ?? 'Dossier'}</span>
                  <Folder size={12} aria-hidden className="shrink-0" />
                </Link>
              )}
            </div>
          )}
        </div>

        <MenuButton
          label={`Azioni: ${task.title}`}
          triggerClassName={ICON_BUTTON}
          items={[
            { label: 'Modifica', icon: Pencil, onSelect: () => onOpen(task) },
            // One level: a subtask takes none, whether it is drawn under its parent or as a row of its own.
            ...(task.parentId ? [] : [{ label: 'Aggiungi un sottocompito', icon: Plus, onSelect: () => onOpen(task, 'subtask') }]),
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
