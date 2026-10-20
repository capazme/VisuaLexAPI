import { useCallback, useEffect, useMemo, useState } from 'react';
import { taskService } from '../../../services/taskService';
import type { Task, TaskView, TaskViewAnswer } from '../../../types/tasks';
import type { Optimistic } from './taskActions';
import { plannerStore } from './plannerStore';

export type TaskViewState =
  | { status: 'loading'; answer: TaskViewAnswer | null }
  | { status: 'error'; answer: TaskViewAnswer | null }
  | { status: 'ready'; answer: TaskViewAnswer };

/**
 * One view of the tasks (`GET /api/tasks?view=`), read on mount, after every write anywhere in the app
 * (`plannerStore.version`) and on «Riprova». While a new read travels the last answer stays on screen; an older
 * read never overwrites a newer one. Rows hidden by a write on its way (`optimistic`) come back when it is refused,
 * and the next answer replaces them all. «Oggi» also gives the bar its count, so the two never disagree.
 */
export function useTaskView(view: TaskView, dossierId?: string) {
  const version = plannerStore((s) => s.version);
  const [reads, setReads] = useState(0);
  const scope = `${view}#${dossierId ?? ''}`;
  const key = `${scope}#${version}#${reads}`;
  const [stored, setAnswer] = useState<{ key: string; scope: string; data: TaskViewAnswer | null; failed: boolean }>({ key: '', scope: '', data: null, failed: false });
  // An answer for another view or dossier is never shown for this one.
  const answer = stored.scope === scope ? stored : { key: '', scope, data: null, failed: false };
  const [hidden, setHidden] = useState<{ key: string; ids: Set<string> }>({ key: '', ids: new Set() });

  useEffect(() => {
    let live = true;
    taskService.list(view, dossierId).then(
      (data) => {
        if (!live) return;
        setAnswer({ key, scope, data, failed: false });
        if (view === 'today') plannerStore.getState().setTodayCount(data.tasks.length);
      },
      (error: { status?: number }) => {
        if (!live) return;
        // Logged by its status alone: the request carries no title, and the answer is not read.
        console.warn(`[planner] the ${view} view could not be read`, error?.status ?? 'no answer');
        setAnswer((previous) => ({ key, scope, data: previous.scope === scope ? previous.data : null, failed: true }));
      },
    );
    return () => {
      live = false;
    };
  }, [key, scope, view, dossierId]);

  const reload = useCallback(() => setReads((n) => n + 1), []);

  // The rows hidden belong to the answer they were hidden from: a new answer shows what the server says.
  const hiddenIds = hidden.key === answer.key ? hidden.ids : null;
  const optimistic: Optimistic = useMemo(
    () => ({
      hide: (id) => setHidden((h) => ({ key: answer.key, ids: new Set(h.key === answer.key ? h.ids : []).add(id) })),
      show: (id) =>
        setHidden((h) => {
          const ids = new Set(h.key === answer.key ? h.ids : []);
          ids.delete(id);
          return { key: answer.key, ids };
        }),
    }),
    [answer.key],
  );

  const visible = useMemo<TaskViewAnswer | null>(() => {
    if (!answer.data) return null;
    if (!hiddenIds || hiddenIds.size === 0) return answer.data;
    // A hidden task takes the subtasks the server closes or trashes with it.
    const gone = new Set(hiddenIds);
    let grew = true;
    while (grew) {
      grew = false;
      for (const task of answer.data.tasks) {
        if (!gone.has(task.id) && task.parentId && gone.has(task.parentId)) {
          gone.add(task.id);
          grew = true;
        }
      }
    }
    return { ...answer.data, tasks: answer.data.tasks.filter((task: Task) => !gone.has(task.id)) };
  }, [answer.data, hiddenIds]);

  let state: TaskViewState;
  if (answer.key !== key) state = { status: 'loading', answer: visible };
  else if (answer.failed || !visible) state = { status: 'error', answer: visible };
  else state = { status: 'ready', answer: visible };
  return { ...state, reload, optimistic };
}
