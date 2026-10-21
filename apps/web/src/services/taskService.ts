import { apiClient } from './api';
import type { Task, TaskInput, TaskView, TaskViewAnswer, TickAnswer } from '../types/tasks';

/**
 * The planner's tasks (`/api/tasks`, the user's session only). Every answer is mapped from the
 * server's snake_case here, once. A task's title may name a client: nothing here logs one, and a
 * failure travels as `services/api.ts` shapes it (`{ status, message, data }`, `message` the server's
 * Italian `detail`, which never repeats a title).
 */

interface TaskWire {
  id: string;
  title: string;
  description: string | null;
  priority: number;
  labels: string[];
  position: number;
  parent_id: string | null;
  dossier_id: string | null;
  dossier_item_id: string | null;
  planned_date: string | null;
  planned_time: string | null;
  due_date: string | null;
  due_time: string | null;
  recurrence: string | null;
  recurrence_from: string;
  origin: string;
  completed_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export function taskFromApi(wire: TaskWire): Task {
  return {
    id: wire.id,
    title: wire.title,
    description: wire.description,
    priority: (wire.priority >= 1 && wire.priority <= 4 ? wire.priority : 4) as Task['priority'],
    labels: Array.isArray(wire.labels) ? wire.labels : [],
    position: wire.position,
    parentId: wire.parent_id,
    dossierId: wire.dossier_id,
    dossierItemId: wire.dossier_item_id,
    plannedDate: wire.planned_date,
    plannedTime: wire.planned_time,
    dueDate: wire.due_date,
    dueTime: wire.due_time,
    recurrence: wire.recurrence as Task['recurrence'],
    recurrenceFrom: wire.recurrence_from === 'completamento' ? 'completamento' : 'pianificata',
    origin: wire.origin as Task['origin'],
    completedAt: wire.completed_at,
    deletedAt: wire.deleted_at,
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
  };
}

const path = (id: string) => `/tasks/${encodeURIComponent(id)}`;

export const taskService = {
  async list(view: TaskView, dossierId?: string): Promise<TaskViewAnswer> {
    const response = await apiClient.get('/tasks', { params: dossierId ? { view, dossierId } : { view } });
    const data = response.data as { today: string; tasks: TaskWire[]; truncated: boolean };
    return { today: data.today, tasks: data.tasks.map(taskFromApi), truncated: data.truncated };
  },

  async create(input: TaskInput & { title: string }): Promise<Task> {
    const response = await apiClient.post('/tasks', input);
    return taskFromApi(response.data);
  },

  async update(id: string, input: TaskInput): Promise<Task> {
    const response = await apiClient.put(path(id), input);
    return taskFromApi(response.data);
  },

  /** `plannedDate`, for a repeating task, is the occurrence the user ticked: a stale second tick is a 409, not a double move. */
  async complete(id: string, plannedDate?: string): Promise<TickAnswer> {
    const response = await apiClient.post(`${path(id)}/complete`, plannedDate ? { plannedDate } : {});
    const data = response.data as { task: TaskWire; recurred: { previous_planned_date: string; planned_date: string } | null };
    return {
      task: taskFromApi(data.task),
      recurred: data.recurred ? { previousPlannedDate: data.recurred.previous_planned_date, plannedDate: data.recurred.planned_date } : null,
    };
  },

  async reopen(id: string): Promise<Task> {
    const response = await apiClient.post(`${path(id)}/reopen`);
    return taskFromApi(response.data.task);
  },

  /** To the trash, with its subtasks; `taskCount` counts them all. */
  async trash(id: string): Promise<{ taskCount: number }> {
    const response = await apiClient.delete(path(id));
    return { taskCount: response.data.task_count };
  },

  async restore(id: string): Promise<Task> {
    const response = await apiClient.post(`${path(id)}/restore`);
    return taskFromApi(response.data);
  },
};
