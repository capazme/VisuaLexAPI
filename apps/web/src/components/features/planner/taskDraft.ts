import { addDaysToIsoDate } from '../../../utils/dateUtils';
import type { RecurrenceFrom, RecurrenceRule, Task, TaskInput, TaskOrigin, TaskPriority, TaskView } from '../../../types/tasks';
import { UPCOMING_DAYS } from './taskDates';

/** A task as its form holds it: every field a string the inputs can show, '' for none. */
export interface TaskDraft {
  title: string;
  description: string;
  priority: TaskPriority;
  /** As typed: «cliente, udienza». */
  labels: string;
  plannedDate: string;
  plannedTime: string;
  dueDate: string;
  dueTime: string;
  recurrence: RecurrenceRule | '';
  recurrenceFrom: RecurrenceFrom;
  dossierId: string;
}

/** The server's bounds (`routes/tasks.ts`), checked here first so a refusal names the field. */
export const MAX_TITLE = 500;
export const MAX_DESCRIPTION = 10_000;
export const MAX_LABELS = 20;
export const MAX_LABEL = 50;

export function emptyDraft(defaults: Partial<TaskDraft> = {}): TaskDraft {
  return {
    title: '', description: '', priority: 4, labels: '', plannedDate: '', plannedTime: '', dueDate: '', dueTime: '',
    recurrence: '', recurrenceFrom: 'pianificata', dossierId: '', ...defaults,
  };
}

export function draftFromTask(task: Task): TaskDraft {
  return {
    title: task.title,
    description: task.description ?? '',
    priority: task.priority,
    labels: task.labels.join(', '),
    plannedDate: task.plannedDate ?? '',
    plannedTime: task.plannedTime ?? '',
    dueDate: task.dueDate ?? '',
    dueTime: task.dueTime ?? '',
    recurrence: task.recurrence ?? '',
    recurrenceFrom: task.recurrenceFrom,
    dossierId: task.dossierId ?? '',
  };
}

/** «cliente, udienza, cliente» → two labels, trimmed, the first spelling kept. */
export function parseLabels(text: string): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const part of text.split(',')) {
    const label = part.trim().replace(/\s+/g, ' ');
    if (label && !seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}

/** What the server would refuse, said before sending, or null. The words are the server's where it has them. */
export function draftProblem(draft: TaskDraft): string | null {
  if (!draft.title.trim()) return 'Il titolo è obbligatorio.';
  if (draft.title.length > MAX_TITLE) return `Il titolo può avere al massimo ${MAX_TITLE} caratteri.`;
  if (draft.description.length > MAX_DESCRIPTION) return `La descrizione può avere al massimo ${MAX_DESCRIPTION.toLocaleString('it-IT')} caratteri.`;
  const labels = parseLabels(draft.labels);
  if (labels.length > MAX_LABELS) return `Al massimo ${MAX_LABELS} etichette.`;
  if (labels.some((label) => label.length > MAX_LABEL)) return `Un'etichetta può avere al massimo ${MAX_LABEL} caratteri.`;
  if (draft.plannedTime && !draft.plannedDate) return "Un orario pianificato richiede la data pianificata.";
  if (draft.dueTime && !draft.dueDate) return "L'orario del termine finale richiede la data del termine.";
  if (draft.recurrence && !draft.plannedDate) return 'Una ripetizione richiede la data pianificata.';
  if (draft.recurrence && draft.dueDate) return 'Un compito con un termine finale non si ripete: togli la ripetizione o il termine.';
  return null;
}

const orNull = (value: string) => (value.trim() ? value : null);

/**
 * The draft as the server takes it: every field, a cleared one as null. A subtask's dossier is its parent's, so it
 * is never sent for one (`withDossier` false); the origin follows the dossier's kind on creation.
 */
export function inputFromDraft(draft: TaskDraft, options: { withDossier: boolean; origin?: TaskOrigin }): TaskInput & { title: string } {
  return {
    title: draft.title.trim(),
    description: orNull(draft.description),
    priority: draft.priority,
    labels: parseLabels(draft.labels),
    plannedDate: orNull(draft.plannedDate),
    plannedTime: draft.plannedDate ? orNull(draft.plannedTime) : null,
    dueDate: orNull(draft.dueDate),
    dueTime: draft.dueDate ? orNull(draft.dueTime) : null,
    recurrence: draft.recurrence || null,
    ...(draft.recurrence ? { recurrenceFrom: draft.recurrenceFrom } : {}),
    ...(options.withDossier ? { dossierId: orNull(draft.dossierId) } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
  };
}

/** Whether a task, just written, is one the view lists: if not, the page says where it went. */
export function belongsTo(task: Task, view: TaskView, today: string, dossierId?: string): boolean {
  if (task.completedAt || task.deletedAt) return view === 'trash' && task.deletedAt !== null;
  switch (view) {
    case 'today':
      return (task.plannedDate !== null && task.plannedDate <= today) || (task.dueDate !== null && task.dueDate <= today);
    case 'upcoming': {
      const last = addDaysToIsoDate(today, UPCOMING_DAYS - 1);
      const inRange = (day: string | null) => day !== null && day >= today && day <= last;
      return inRange(task.plannedDate) || inRange(task.dueDate);
    }
    case 'inbox':
      return task.dossierId === null;
    case 'dossier':
      return task.dossierId === (dossierId ?? null);
    case 'trash':
      return false;
  }
}
