import { showUndoToast } from '../../../hooks/useUndoableAction';
import { taskService } from '../../../services/taskService';
import type { Task } from '../../../types/tasks';
import { failureMessage, plannerStore } from './plannerStore';
import { shortDay } from './taskDates';

/** How a view hides a row while its write travels, and shows it again when the write is refused. */
export interface Optimistic {
  hide: (id: string) => void;
  show: (id: string) => void;
  /** The write has landed: the row stays hidden until an answer read after it. */
  landed: (id: string) => void;
}

const { changed, notify } = plannerStore.getState();

/**
 * A refused write: the row comes back, and on a 4xx (a task changed meanwhile, 409; gone, 404) the views read again,
 * or the row would stay as it was and every new attempt be refused the same way.
 */
function refused(task: Task, optimistic: Optimistic, error: unknown, fallback: string) {
  optimistic.show(task.id);
  notify(failureMessage(error, fallback), 'error');
  const status = (error as { status?: number } | null)?.status;
  if (status !== undefined && status >= 400 && status < 500) changed();
}

/**
 * Ticks a task, with «Annulla» for five seconds. A repeating task does not close: the server moves its planned date
 * (and needs the occurrence ticked, `plannedDate`, so a second tick of the same one is a 409), and «Annulla» puts the
 * date back; any other task closes with its open subtasks, and «Annulla» reopens them. The toast never repeats the
 * title, which may name a client.
 */
export async function completeWithUndo(task: Task, today: string, optimistic: Optimistic): Promise<void> {
  optimistic.hide(task.id);
  let answer;
  try {
    answer = await taskService.complete(task.id, task.recurrence && task.plannedDate ? task.plannedDate : undefined);
  } catch (error) {
    refused(task, optimistic, error, 'Non riesco a segnare il compito come fatto. Riprova.');
    return;
  }
  optimistic.landed(task.id);
  changed();
  const recurred = answer.recurred;
  await showUndoToast({
    action: () => recurred,
    undo: async () => {
      try {
        if (recurred) await taskService.update(task.id, { plannedDate: recurred.previousPlannedDate });
        else await taskService.reopen(task.id);
      } catch (error) {
        notify(failureMessage(error, 'Non riesco ad annullare. Riprova.'), 'error');
        // Said: no «Ripristinato» after it.
        throw error;
      } finally {
        changed();
      }
    },
    message: recurred ? `Fatto: torna ${shortDay(recurred.plannedDate, today).toLowerCase()}` : 'Compito completato',
  });
}

/** Moves a task, with its subtasks, to the trash for 30 days, with «Annulla». */
export async function trashWithUndo(task: Task, optimistic: Optimistic): Promise<void> {
  optimistic.hide(task.id);
  let taskCount: number;
  try {
    ({ taskCount } = await taskService.trash(task.id));
  } catch (error) {
    refused(task, optimistic, error, 'Non riesco a spostare il compito nel cestino. Riprova.');
    return;
  }
  optimistic.landed(task.id);
  changed();
  const subtasks = taskCount - 1;
  await showUndoToast({
    action: () => taskCount,
    undo: async () => {
      try {
        await taskService.restore(task.id);
      } catch (error) {
        notify(failureMessage(error, 'Non riesco a ripristinare il compito. Riprova.'), 'error');
        // Said: no «Ripristinato» after it.
        throw error;
      } finally {
        changed();
      }
    },
    message:
      subtasks > 0
        ? `Compito e ${subtasks === 1 ? '1 sottocompito spostati' : `${subtasks} sottocompiti spostati`} nel cestino`
        : 'Compito spostato nel cestino',
  });
}

/** Takes a task back out of the trash (the trash view's «Ripristina»). */
export async function restoreTask(task: Task, optimistic: Optimistic): Promise<void> {
  optimistic.hide(task.id);
  try {
    await taskService.restore(task.id);
  } catch (error) {
    refused(task, optimistic, error, 'Non riesco a ripristinare il compito. Riprova.');
    return;
  }
  optimistic.landed(task.id);
  changed();
  notify('Compito ripristinato');
}
