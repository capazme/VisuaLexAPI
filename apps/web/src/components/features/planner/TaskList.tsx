import { useState } from 'react';
import type { Task } from '../../../types/tasks';
import { completeWithUndo, trashWithUndo, type Optimistic } from './taskActions';
import { nestTasks } from './taskTree';
import { TaskRow } from './TaskRow';
import { useTaskSheet } from './TaskSheetScope';
import { focusAwayFrom, moveBetweenRows } from './moveBetweenRows';

interface Props {
  tasks: Task[];
  today: string;
  optimistic: Optimistic;
  showDossier?: boolean;
  /** The list's name for a screen reader («Termini scaduti», «In ritardo», «Oggi», a day). */
  label: string;
  /**
   * Whether a row's subtasks start open: in a dated view each one is listed because it is due, so they show; in a
   * list (the inbox, a dossier) they wait behind the row's counter.
   */
  subtasksOpen?: boolean;
}

/** A view's tasks as rows, subtasks one level under their parent, open or folded in place; a row opens the sheet. */
export function TaskList({ tasks, today, optimistic, showDossier = true, label, subtasksOpen = false }: Props) {
  const sheet = useTaskSheet();
  // The rows whose subtasks are the other way round from the list's default.
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setFlipped((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const actions = {
    onTick: (task: Task) => {
      focusAwayFrom(task.id);
      void completeWithUndo(task, today, optimistic);
    },
    onTrash: (task: Task) => {
      focusAwayFrom(task.id);
      void trashWithUndo(task, optimistic);
    },
    onOpen: (task: Task, focus?: 'subtask') => sheet.open(task, focus),
  };

  return (
    <ul aria-label={label} onKeyDown={moveBetweenRows} className="grid min-w-0 grid-cols-1">
      {nestTasks(tasks).map(({ task, children }) => {
        const open = subtasksOpen !== flipped.has(task.id);
        return (
          <TaskRow
            key={task.id}
            task={task}
            today={today}
            showDossier={showDossier}
            subtasks={children.length > 0 ? { count: children.length, open, onToggle: () => toggle(task.id) } : undefined}
            {...actions}
          >
            {children.length > 0 && open && (
              <ul aria-label={`Sottocompiti di ${task.title}`} className="ml-6 grid min-w-0 grid-cols-1 border-l border-slate-200 pl-2 dark:border-slate-800">
                {children.map((child) => (
                  <TaskRow key={child.id} task={child} today={today} showDossier={false} {...actions} />
                ))}
              </ul>
            )}
          </TaskRow>
        );
      })}
    </ul>
  );
}
