/**
 * The planner's tasks (Opus, wave 1), as the client holds them: `/api/tasks` answers in snake_case and
 * `services/taskService.ts` maps each task once. Days are Rome civil days ('YYYY-MM-DD'), times 'HH:MM'.
 */

/** 1 is the most urgent, 4 the default (the server's convention). */
export type TaskPriority = 1 | 2 | 3 | 4;

/** The closed RRULE subset the server accepts (`apps/server/src/tasks/recurrence.ts`). */
export const RECURRENCE_RULES = {
  daily: 'FREQ=DAILY',
  workingDays: 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR',
  weekly: 'FREQ=WEEKLY',
  monthly: 'FREQ=MONTHLY',
  yearly: 'FREQ=YEARLY',
} as const;

export type RecurrenceRule = (typeof RECURRENCE_RULES)[keyof typeof RECURRENCE_RULES];

/** «ogni» counts from the planned date, «ogni!» from the day it was done. */
export type RecurrenceFrom = 'pianificata' | 'completamento';

export type TaskOrigin = 'lavoro' | 'studio' | 'forum';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  labels: string[];
  position: number;
  parentId: string | null;
  /** Null: the inbox. */
  dossierId: string | null;
  dossierItemId: string | null;
  plannedDate: string | null;
  plannedTime: string | null;
  /** The deadline the user wrote: nothing computes it. */
  dueDate: string | null;
  dueTime: string | null;
  recurrence: RecurrenceRule | null;
  recurrenceFrom: RecurrenceFrom;
  origin: TaskOrigin;
  completedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TaskView = 'today' | 'upcoming' | 'inbox' | 'dossier' | 'trash';

export interface TaskViewAnswer {
  /** The server's Rome day: what «today» means for every date on the page. */
  today: string;
  tasks: Task[];
  /** More than the server's cap (1000) matched. */
  truncated: boolean;
}

/** What a client may write. `undefined` leaves a field as it is, `null` clears it. */
export interface TaskInput {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  labels?: string[];
  dossierId?: string | null;
  parentId?: string | null;
  plannedDate?: string | null;
  plannedTime?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  recurrence?: RecurrenceRule | null;
  recurrenceFrom?: RecurrenceFrom;
  origin?: TaskOrigin;
}

export interface TickAnswer {
  task: Task;
  /** A repeating task does not close: its planned date moved, and this is how to put it back. */
  recurred: { previousPlannedDate: string; plannedDate: string } | null;
}
