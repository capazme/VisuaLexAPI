import type { Task } from '../../../types/tasks';

export interface TaskNode {
  task: Task;
  /** The subtasks in the same list, one level: the server allows any depth, the planner shows one (the brief). */
  children: Task[];
}

/**
 * A view's flat list as rows: a task whose parent is in the list sits under it, a task whose parent is not (a
 * subtask dated today, its parent not) is a row of its own. Deeper subtasks go under their top ancestor in the
 * list. The order of the rows, and of the subtasks under each, is the list's.
 */
export function nestTasks(tasks: Task[]): TaskNode[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const topOf = (task: Task): Task => {
    let current = task;
    const seen = new Set([current.id]);
    while (current.parentId && byId.has(current.parentId)) {
      // A loop (the server refuses one; the data is read as untrusted all the same): the task is a row of its own.
      if (seen.has(current.parentId)) return task;
      current = byId.get(current.parentId)!;
      seen.add(current.id);
    }
    return current;
  };
  const nodes = new Map<string, TaskNode>();
  for (const task of tasks) if (topOf(task) === task) nodes.set(task.id, { task, children: [] });
  for (const task of tasks) {
    const top = topOf(task);
    if (top !== task) nodes.get(top.id)!.children.push(task);
  }
  return [...nodes.values()];
}
