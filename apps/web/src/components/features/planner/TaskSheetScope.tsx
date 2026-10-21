import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Task } from '../../../types/tasks';
import { cn } from '../../../lib/utils';
import { completeWithUndo, trashWithUndo, type Optimistic } from './taskActions';
import { focusWhenRowLeaves, moveBetweenRows } from './moveBetweenRows';
import { TaskSheet } from './TaskSheet';

interface SheetApi {
  /** Opens a task's sheet; `subtask`: with the field to add one. */
  open: (task: Task, focus?: 'subtask') => void;
}

const SheetContext = createContext<SheetApi | null>(null);

/** The sheet of the view a row sits in. */
// eslint-disable-next-line react-refresh/only-export-components
export function useTaskSheet(): SheetApi {
  const api = useContext(SheetContext);
  if (!api) throw new Error('A task row needs a TaskSheetScope around its list.');
  return api;
}

interface OpenSheet {
  task: Task;
  /** The listed task the arrows count from: the one opened, or the last one they reached. */
  anchor: string;
  /** Its place among the rows when it was reached, for when it has left the view since. */
  index: number;
  neighbours: { previous: boolean; next: boolean };
  focus?: 'subtask';
}

interface Props {
  /** The view's tasks: the sheet shows the latest copy of the one open. */
  tasks: Task[];
  today: string;
  optimistic: Optimistic;
  className?: string;
  children: ReactNode;
}

/**
 * A view's rows and the one task sheet they open. The rows of every list inside are one sequence, for the arrows
 * between them (`moveBetweenRows`) and for the sheet's «precedente» and «successivo» (and j, k): the rows as they
 * stand on the page, so a folded group or subtask is skipped. When the sheet closes the focus goes back to the open
 * task's row, or, when it has left the view, to the row now in its place.
 */
export function TaskSheetScope({ tasks, today, optimistic, className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<OpenSheet | null>(null);

  const rows = () => [...(ref.current?.querySelectorAll<HTMLElement>('[data-task-row]') ?? [])].map((el) => el.dataset.taskId ?? '');
  const rowOf = (id: string) => [...(ref.current?.querySelectorAll<HTMLElement>('[data-task-row]') ?? [])].find((el) => el.dataset.taskId === id);
  const reach = (task: Task, ids: string[], index: number, focus?: 'subtask'): OpenSheet => ({
    task,
    anchor: task.id,
    index,
    neighbours: { previous: index > 0, next: index >= 0 && index < ids.length - 1 },
    focus,
  });

  const api = useMemo<SheetApi>(
    () => ({
      open: (task, focus) => {
        const ids = rows();
        setOpen(reach(task, ids, ids.indexOf(task.id), focus));
      },
    }),
    // `rows` reads the DOM when called; nothing it closes over changes.
    [],
  );

  const current = open ? (tasks.find((t) => t.id === open.task.id) ?? open.task) : null;

  const step = (direction: -1 | 1) => {
    if (!open || !current) return;
    const ids = rows();
    let at = ids.indexOf(current.id);
    if (at < 0) at = ids.indexOf(open.anchor);
    // The task has left the view: the row now in its place is the next one.
    const target = at >= 0 ? at + direction : direction > 0 ? open.index : open.index - 1;
    const id = ids[target];
    const task = id ? tasks.find((t) => t.id === id) : undefined;
    if (task) setOpen(reach(task, ids, target));
  };

  const close = () => {
    if (!open || !current) return;
    const { index } = open;
    const id = current.id;
    setOpen(null);
    // After the window has given the focus back to where it was opened from.
    requestAnimationFrame(() => {
      const row = rowOf(id);
      if (row) {
        row.querySelector<HTMLElement>('[data-task-title]')?.focus();
        // Saved out of the view: the row leaves at the next read.
        focusWhenRowLeaves(id);
        return;
      }
      const ids = rows();
      const neighbour = rowOf(ids[index] ?? ids[index - 1] ?? '');
      const target = neighbour?.querySelector<HTMLElement>('[data-task-focus]') ?? ref.current?.closest('section')?.querySelector<HTMLElement>('[data-focus-fallback]');
      target?.focus();
    });
  };

  /** A task done or trashed from its sheet: a subtask hands the sheet to its parent, a task closes it. */
  const leave = (task: Task, parent: Task | null, write: (task: Task) => void) => {
    if (parent && open) setOpen({ ...open, task: parent, focus: undefined });
    else close();
    write(task);
  };

  return (
    <SheetContext.Provider value={api}>
      <div ref={ref} data-task-lists onKeyDown={moveBetweenRows} className={cn('min-w-0', className)}>
        {children}
      </div>
      {open && current && (
        <TaskSheet
          task={current}
          today={today}
          optimistic={optimistic}
          neighbours={open.neighbours}
          focus={open.focus}
          onStep={step}
          onOpenTask={(task) => setOpen({ ...open, task, focus: undefined })}
          onDone={(task, parent) => leave(task, parent, (t) => void completeWithUndo(t, today, optimistic))}
          onTrash={(task, parent) => leave(task, parent, (t) => void trashWithUndo(t, optimistic))}
          onClose={close}
        />
      )}
    </SheetContext.Provider>
  );
}
