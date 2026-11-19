import { createContext, useContext } from 'react';
import type { DossierKind } from '../../../types';
import type { Task, TaskOrigin } from '../../../types/tasks';
import { isStudiaEnabled } from '../../../features/studia/featureFlag';

/**
 * Work's and Learn's own lists of tasks (LC130): Learn lists the «studio» tasks, Work every other one («lavoro», and
 * «forum» where it always was). The server reads them all (`GET /api/tasks` has no origin filter); the views split them.
 */
export type TaskSection = 'work' | 'learn';

/** Where each section's planner lives: its views are `${base}/scadenziario`, `/prossimi`, `/ingresso`, `/cestino`. */
export const TASK_BASE: Readonly<Record<TaskSection, string>> = { work: '/work', learn: '/learn/attivita' };

/** The section a task is listed in. Without Learn (`VITE_FEATURE_STUDIA` off) Work lists them all: none is out of reach. */
export function inSection(task: Pick<Task, 'origin'>, section: TaskSection): boolean {
  if (section === 'learn') return task.origin === 'studio';
  return !isStudiaEnabled() || task.origin !== 'studio';
}

/** A new task's origin: its dossier's kind when it has one, else the section it is written in. */
export function newTaskOrigin(dossierKind: DossierKind | undefined, section: TaskSection): TaskOrigin {
  if (dossierKind) return dossierKind === 'studio' ? 'studio' : 'lavoro';
  return section === 'learn' ? 'studio' : 'lavoro';
}

/** Today's and overdue tasks of each section, from one answer of the «today» view (the sidebar's two badges). */
export function countBySection(tasks: ReadonlyArray<Pick<Task, 'origin'>>): Record<TaskSection, number> {
  return {
    work: tasks.filter((task) => inSection(task, 'work')).length,
    learn: tasks.filter((task) => inSection(task, 'learn')).length,
  };
}

/** The section of the planner page around a view (`OpusPage`); null outside it (a dossier's tasks list them all). */
export const TaskSectionContext = createContext<TaskSection | null>(null);

export function useTaskSection(): TaskSection | null {
  return useContext(TaskSectionContext);
}
