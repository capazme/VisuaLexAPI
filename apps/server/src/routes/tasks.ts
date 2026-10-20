import { Prisma, TaskOrigin, TaskRecurrenceFrom } from '@prisma/client';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { hasNoNul } from '../lingo/noNul';
import { addDays } from '../lingo/studyDay';
import { RECURRENCE_RULE_VALUES } from '../tasks/recurrence';
import {
  completeTask,
  createTask,
  getTask,
  listTasks,
  reopenTask,
  reorderTasks,
  restoreTask,
  serializeTask,
  TASK_VIEWS,
  trashTask,
  updateTask,
} from '../tasks/tasks';

/**
 * The planner's tasks (wave 1; answer 11 on the task model), on the model of `routes/dossiers.ts`:
 * the user's session only. None of these routes is in the delegated table, so an exchanged token
 * gets the default-deny 403 (MCP tools on tasks are wave 2).
 *
 * - `GET /api/tasks?view=today|upcoming|inbox|dossier|trash[&dossierId=]` — `{ view, today, tasks, truncated }`;
 * - `GET /api/tasks/:id`, `POST /api/tasks`, `PUT /api/tasks/:id`;
 * - `POST /api/tasks/:id/complete { plannedDate }` (the occurrence ticked; required for a repeating task) — `{ task, recurred }`;
 *   `POST /api/tasks/:id/reopen`;
 * - `POST /api/tasks/reorder { taskIds }` — the manual order;
 * - `DELETE /api/tasks/:id` — to the trash, with its subtasks; `POST /api/tasks/:id/restore`.
 *
 * A title or a description may name a client: no message here repeats one, and an unexpected
 * error is logged by its kind only (below).
 */
const router = Router();
router.use(authenticate);
// An id with a NUL byte names no task (and would be a 500 in the database).
router.param('id', (_req, _res, next, id: string) => next(hasNoNul(id) ? undefined : new AppError(404, 'Compito non trovato.')));

const MAX_TITLE = 500;
const MAX_DESCRIPTION = 10_000;
const MAX_LABELS = 20;
const MAX_LABEL = 50;
const MAX_REORDER = 1000;

const noNul = { message: 'Il testo contiene un carattere non valido.' };
const id = z.string().min(1).max(64).refine(hasNoNul, { message: 'Identificativo non valido.' });

/** A civil day 'YYYY-MM-DD' the calendar has, from 1900 to 2199. */
function isDay(value: string): boolean {
  try {
    addDays(value, 0);
  } catch {
    return false;
  }
  return value >= '1900-01-01' && value <= '2199-12-31';
}
const day = z.string().refine(isDay, { message: 'Una data va scritta AAAA-MM-GG (dal 1900 al 2199).' });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Un orario va scritto HH:MM.' });
// The closed values answer without repeating what was sent.
const closed = <T extends readonly [string, ...string[]]>(values: T, message: string) =>
  z.enum(values as unknown as [T[number], ...T[number][]], { errorMap: () => ({ message }) });

const fields = {
  title: z
    .string()
    .max(MAX_TITLE)
    .refine((value) => value.trim().length > 0, { message: 'Il titolo è obbligatorio.' })
    .refine(hasNoNul, noNul),
  description: z.string().max(MAX_DESCRIPTION).refine(hasNoNul, noNul).nullable(),
  priority: z.number().int().min(1).max(4),
  labels: z
    .array(z.string().trim().min(1).max(MAX_LABEL).refine(hasNoNul, noNul))
    .max(MAX_LABELS)
    .transform((labels) => [...new Set(labels)]),
  dossierId: id.nullable(),
  dossierItemId: id.nullable(),
  parentId: id.nullable(),
  plannedDate: day.nullable(),
  plannedTime: time.nullable(),
  dueDate: day.nullable(),
  dueTime: time.nullable(),
  recurrence: closed(RECURRENCE_RULE_VALUES, 'Ripetizione non prevista.').nullable(),
  recurrenceFrom: z.nativeEnum(TaskRecurrenceFrom, { errorMap: () => ({ message: 'Valore non previsto.' }) }),
  origin: z.nativeEnum(TaskOrigin, { errorMap: () => ({ message: 'Origine non prevista.' }) }),
};

const createSchema = z.object(fields).partial().required({ title: true }).strict();
const updateSchema = z.object(fields).partial().strict();
const listSchema = z.object({
  view: closed(TASK_VIEWS, 'Vista non prevista.'),
  dossierId: id.optional(),
});
const completeSchema = z.object({ plannedDate: day.optional() }).strict();
const reorderSchema = z.object({ taskIds: z.array(id).min(1).max(MAX_REORDER) }).strict();

router.get('/', async (req, res) => {
  const { view, dossierId } = listSchema.parse(req.query);
  const result = await listTasks(req.user!.id, view, dossierId);
  res.json({ view, today: result.today, tasks: result.tasks.map(serializeTask), truncated: result.truncated });
});

router.post('/', async (req, res) => {
  const input = createSchema.parse(req.body);
  res.status(201).json(serializeTask(await createTask(req.user!.id, input)));
});

// Before `/:id`, which would otherwise read «reorder» as an id.
router.post('/reorder', async (req, res) => {
  const { taskIds } = reorderSchema.parse(req.body);
  await reorderTasks(req.user!.id, taskIds);
  res.json({ ok: true });
});

router.get('/:id', async (req, res) => {
  res.json(serializeTask(await getTask(req.user!.id, req.params.id)));
});

router.put('/:id', async (req, res) => {
  const input = updateSchema.parse(req.body);
  res.json(serializeTask(await updateTask(req.user!.id, req.params.id, input)));
});

router.post('/:id/complete', async (req, res) => {
  const { plannedDate } = completeSchema.parse(req.body ?? {});
  const { task, recurred } = await completeTask(req.user!.id, req.params.id, plannedDate);
  res.json({
    task: serializeTask(task),
    recurred: recurred && { previous_planned_date: recurred.previousPlannedDate, planned_date: recurred.plannedDate },
  });
});

router.post('/:id/reopen', async (req, res) => {
  res.json({ task: serializeTask(await reopenTask(req.user!.id, req.params.id)) });
});

router.delete('/:id', async (req, res) => {
  const { deletedAt, taskCount } = await trashTask(req.user!.id, req.params.id);
  res.json({ id: req.params.id, deleted_at: deletedAt, task_count: taskCount });
});

router.post('/:id/restore', async (req, res) => {
  res.json(serializeTask(await restoreTask(req.user!.id, req.params.id)));
});

/**
 * The tasks' own error handler. A caller's error goes on to the app's handler as usual. A database
 * error is answered here: the global handler logs an unexpected error whole, and Prisma's messages
 * can quote the values of the query, a title among them. Only the error's kind and code are logged.
 */
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AppError || err instanceof ZodError) {
    next(err);
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // A dossier, an entry or a parent deleted meanwhile (a foreign key), or a row gone between the read and the write.
    if (err.code === 'P2003') return res.status(409).json({ detail: 'Il dossier, la voce o il compito principale non esiste più: riprova.' });
    if (err.code === 'P2025') return res.status(404).json({ detail: 'Compito non trovato.' });
  }
  const kind = err instanceof Error ? err.name : typeof err;
  const code = err instanceof Prisma.PrismaClientKnownRequestError ? ` ${err.code}` : '';
  console.error(`Task route failed: ${kind}${code}`);
  return res.status(500).json({ detail: 'Internal server error' });
});

export default router;
