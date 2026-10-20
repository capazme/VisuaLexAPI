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
 * read never overwrites a newer one. A row hidden by a write (`optimistic`) stays hidden while the write travels and
 * until an answer read after it landed arrives — a read that started before, or a failed one that keeps the last
 * answer, would show it again, not done — and comes back at once when the write is refused. «Oggi» also gives the bar
 * its count, so the two never disagree.
 */
export function useTaskView(view: TaskView, dossierId?: string) {
  const version = plannerStore((s) => s.version);
  const [reads, setReads] = useState(0);
  const scope = `${view}#${dossierId ?? ''}`;
  const key = `${scope}#${version}#${reads}`;
  // `readAt`: the write counter when the data on screen was read.
  const [stored, setAnswer] = useState<{ key: string; scope: string; data: TaskViewAnswer | null; readAt: number; failed: boolean }>({ key: '', scope: '', data: null, readAt: -1, failed: false });
  // An answer for another view or dossier is never shown for this one.
  const answer = stored.scope === scope ? stored : { key: '', scope, data: null, readAt: -1, failed: false };
  // A hidden row: null while its write travels, then the counter its landing set (an answer read at it or after knows).
  const [hidden, setHidden] = useState<ReadonlyMap<string, number | null>>(new Map());

  useEffect(() => {
    let live = true;
    taskService.list(view, dossierId).then(
      (data) => {
        if (!live) return;
        setAnswer({ key, scope, data, readAt: version, failed: false });
        if (view === 'today') plannerStore.getState().setTodayCount(data.tasks.length);
      },
      (error: { status?: number }) => {
        if (!live) return;
        // Logged by its status alone: the request carries no title, and the answer is not read.
        console.warn(`[planner] the ${view} view could not be read`, error?.status ?? 'no answer');
        setAnswer((previous) =>
          previous.scope === scope ? { ...previous, key, failed: true } : { key, scope, data: null, readAt: -1, failed: true },
        );
      },
    );
    return () => {
      live = false;
    };
  }, [key, scope, view, dossierId, version]);

  const reload = useCallback(() => setReads((n) => n + 1), []);

  const optimistic: Optimistic = useMemo(() => {
    const change = (id: string, at: number | null | undefined) =>
      setHidden((previous) => {
        const next = new Map(previous);
        if (at === undefined) next.delete(id);
        else next.set(id, at);
        return next;
      });
    return {
      hide: (id) => change(id, null),
      show: (id) => change(id, undefined),
      // Called once the write has landed, before it bumps the counter: the next read is the first to see it.
      landed: (id) => change(id, plannerStore.getState().version + 1),
    };
  }, []);

  const visible = useMemo<TaskViewAnswer | null>(() => {
    if (!answer.data) return null;
    const gone = new Set([...hidden].filter(([, at]) => at === null || answer.readAt < at).map(([id]) => id));
    if (gone.size === 0) return answer.data;
    // A hidden task takes the subtasks the server closes or trashes with it.
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
  }, [answer.data, answer.readAt, hidden]);

  let state: TaskViewState;
  if (answer.key !== key) state = { status: 'loading', answer: visible };
  else if (answer.failed || !visible) state = { status: 'error', answer: visible };
  else state = { status: 'ready', answer: visible };
  return { ...state, reload, optimistic };
}
