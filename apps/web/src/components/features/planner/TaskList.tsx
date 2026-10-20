import { useState } from 'react';
import type { Task } from '../../../types/tasks';
import { completeWithUndo, trashWithUndo, type Optimistic } from './taskActions';
import { nestTasks } from './taskTree';
import { TaskDialog } from './TaskDialog';
import { TaskRow } from './TaskRow';
import { moveBetweenRows } from './moveBetweenRows';

interface Props {
  tasks: Task[];
  today: string;
  optimistic: Optimistic;
  showDossier?: boolean;
  /** The list's name for a screen reader («Scaduti», «Oggi», a day). */
  label: string;
}

/** A view's tasks as rows, subtasks one level under their parent, and the task's dialog. */
export function TaskList({ tasks, today, optimistic, showDossier = true, label }: Props) {
  const [open, setOpen] = useState<{ task: Task; focus?: 'subtask' } | null>(null);
  const actions = {
    onTick: (task: Task) => void completeWithUndo(task, today, optimistic),
    onTrash: (task: Task) => void trashWithUndo(task, optimistic),
    onOpen: (task: Task, focus?: 'subtask') => setOpen({ task, focus }),
  };

  return (
    <>
      <ul aria-label={label} onKeyDown={moveBetweenRows} className="grid gap-0.5">
        {nestTasks(tasks).map(({ task, children }) => (
          <TaskRow key={task.id} task={task} today={today} showDossier={showDossier} {...actions}>
            {children.length > 0 && (
              <ul aria-label={`Sottocompiti di ${task.title}`} className="ml-6 grid gap-0.5 border-l border-slate-200 pl-2 dark:border-slate-800">
                {children.map((child) => (
                  <TaskRow key={child.id} task={child} today={today} showDossier={false} isChild {...actions} />
                ))}
              </ul>
            )}
          </TaskRow>
        ))}
      </ul>
      {open && <TaskDialog mode="edit" task={open.task} focus={open.focus} today={today} onClose={() => setOpen(null)} />}
    </>
  );
}
