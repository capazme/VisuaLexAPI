import { Prisma, type Task, type TaskOrigin, type TaskRecurrenceFrom } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { addDays, romeDay } from '../lingo/studyDay';
import { dateToDay, dayToDate } from '../lingo/studyDays';
import { dayOfMonth, landsOnDay, nextOccurrence, type RecurrenceRule } from './recurrence';

/**
 * The planner's tasks (wave 1; the answers on the task model, 1–4, 7, 11, 13). Every function takes
 * the owner's id and reads or writes only that user's rows: a task, a dossier, an entry or a parent
 * that is someone else's is «not found», never «forbidden», so nothing tells an id that exists apart
 * from one that does not.
 *
 * A task's title and description may name a client: they never go into an error message or a log.
 */

/** How long a task stays in the trash before the sweep removes it: as long as the dossiers' trash. */
export const TASK_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 10 * 60 * 1000;
/** A view answers at most this many tasks, and says when there were more. */
export const VIEW_LIMIT = 1000;
/** «Prossimi giorni»: today and the six days after it. */
export const UPCOMING_DAYS = 7;

export const TASK_VIEWS = ['today', 'upcoming', 'inbox', 'dossier', 'trash'] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

const NOT_FOUND = 'Compito non trovato.';

/** 'HH:MM' → the Date Prisma maps to that TIME (1970-01-01, UTC). */
const timeToDate = (time: string) => new Date(`1970-01-01T${time}:00.000Z`);
const dateToTime = (date: Date) => date.toISOString().slice(11, 16);

const dayOrNull = (date: Date | null) => (date ? dateToDay(date) : null);
const timeOrNull = (date: Date | null) => (date ? dateToTime(date) : null);

/** A task as every route answers it. Dates are Rome civil days ('YYYY-MM-DD'), times 'HH:MM'. */
export function serializeTask(task: Task) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    priority: task.priority,
    labels: task.labels,
    position: task.position,
    parent_id: task.parentId,
    dossier_id: task.dossierId,
    dossier_item_id: task.dossierItemId,
    planned_date: dayOrNull(task.plannedDate),
    planned_time: timeOrNull(task.plannedTime),
    due_date: dayOrNull(task.dueDate),
    due_time: timeOrNull(task.dueTime),
    recurrence: task.recurrence,
    recurrence_from: task.recurrenceFrom,
    origin: task.origin,
    completed_at: task.completedAt,
    deleted_at: task.deletedAt,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}

/** What a client may write on a task. `undefined` leaves a field as it is; `null` clears it. */
export interface TaskInput {
  title?: string;
  description?: string | null;
  priority?: number;
  labels?: string[];
  dossierId?: string | null;
  dossierItemId?: string | null;
  parentId?: string | null;
  plannedDate?: string | null;
  plannedTime?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  recurrence?: RecurrenceRule | null;
  recurrenceFrom?: TaskRecurrenceFrom;
  origin?: TaskOrigin;
}

/** The fields whose pairing the server checks, as they will be once written. */
interface Shape {
  dossierId: string | null;
  dossierItemId: string | null;
  plannedDate: string | null;
  plannedTime: string | null;
  dueDate: string | null;
  dueTime: string | null;
  recurrence: string | null;
}

function checkShape(shape: Shape): void {
  if (shape.plannedTime && !shape.plannedDate) throw new AppError(400, "Un orario pianificato richiede la data pianificata.");
  if (shape.dueTime && !shape.dueDate) throw new AppError(400, "L'orario del termine finale richiede la data del termine.");
  if (shape.recurrence && !shape.plannedDate) throw new AppError(400, 'Una ripetizione richiede la data pianificata.');
  // The deadline never moves and never repeats (the planner's row 9).
  if (shape.recurrence && shape.dueDate) {
    throw new AppError(400, 'Un compito con un termine finale non si ripete: togli la ripetizione o il termine.');
  }
  if (shape.dossierItemId && !shape.dossierId) throw new AppError(400, 'Una voce di dossier richiede il suo dossier.');
}

async function assertOwnDossier(tx: Prisma.TransactionClient, userId: string, dossierId: string): Promise<void> {
  const dossier = await tx.dossier.findFirst({ where: { id: dossierId, userId }, select: { id: true } });
  if (!dossier) throw new AppError(404, 'Dossier non trovato.');
}

async function assertItemOfDossier(tx: Prisma.TransactionClient, dossierId: string, itemId: string): Promise<void> {
  const item = await tx.dossierItem.findFirst({ where: { id: itemId, dossierId }, select: { id: true } });
  if (!item) throw new AppError(404, 'Voce del dossier non trovata.');
}

/** The user's task, open to changes (not in the trash), or a parent named by a client. Lock it first (`lockTask`) to rely on it. */
async function liveTask(tx: Prisma.TransactionClient, userId: string, id: string, message = NOT_FOUND): Promise<Task> {
  const task = await tx.task.findFirst({ where: { id, userId, deletedAt: null } });
  if (!task) throw new AppError(404, message);
  return task;
}

/** Locks the user's task row for the rest of the transaction: two ticks at once run one after the other. */
async function lockTask(tx: Prisma.TransactionClient, userId: string, id: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM tasks WHERE id = ${id} AND user_id = ${userId} FOR UPDATE`;
  if (rows.length !== 1) throw new AppError(404, NOT_FOUND);
}

/**
 * A parent named by a client, locked and read as live: a parent moved to the trash meanwhile either
 * finishes first (and is refused here) or waits, so a live subtask never ends up under a trashed one.
 */
async function lockedParent(tx: Prisma.TransactionClient, userId: string, id: string): Promise<Task> {
  const message = 'Compito principale non trovato.';
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM tasks WHERE id = ${id} AND user_id = ${userId} FOR UPDATE`;
  if (rows.length !== 1) throw new AppError(404, message);
  return liveTask(tx, userId, id, message);
}

/**
 * Locks the user's dossier rows, in id order, for the rest of the transaction: a task moved between
 * two dossiers and a dossier moved to the trash run one after the other, so the trash's payload never
 * holds a task that has meanwhile left (its restore would collide with the live row).
 */
async function lockDossiers(tx: Prisma.TransactionClient, userId: string, ids: (string | null)[]): Promise<void> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))].sort();
  if (wanted.length === 0) return;
  await tx.$queryRaw`SELECT id FROM dossiers WHERE id IN (${Prisma.join(wanted)}) AND user_id = ${userId} ORDER BY id FOR UPDATE`;
}

/**
 * Serialises the user's re-parentings: two at once (A under B, B under A) would each check its own
 * loop before the other's write and close one together. Taken first, before any row lock.
 */
async function lockParentChanges(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('tasks:parent:' || ${userId}::text))`;
}

/** The task and every task under it, at any depth, as ids (the user's rows only). */
async function subtreeIds(tx: Prisma.TransactionClient, userId: string, id: string): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE sub AS (
      SELECT id FROM tasks WHERE id = ${id} AND user_id = ${userId}
      UNION
      SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id WHERE t.user_id = ${userId}
    )
    SELECT id FROM sub`;
  return rows.map((row) => row.id);
}

/** Whether `candidateParentId` is the task itself or under it: making it the task's parent would close a loop. */
async function isAncestorOrSelf(tx: Prisma.TransactionClient, userId: string, taskId: string, candidateParentId: string): Promise<boolean> {
  return (await subtreeIds(tx, userId, taskId)).includes(candidateParentId);
}

async function nextPosition(tx: Prisma.TransactionClient, userId: string, dossierId: string | null, parentId: string | null): Promise<number> {
  const last = await tx.task.aggregate({ where: { userId, dossierId, parentId, deletedAt: null }, _max: { position: true } });
  return (last._max.position ?? -1) + 1;
}

const dayInput = (day: string | null | undefined) => (day === undefined ? undefined : day === null ? null : dayToDate(day));
const timeInput = (time: string | null | undefined) => (time === undefined ? undefined : time === null ? null : timeToDate(time));

/** A new task, after the last one of its list (its dossier or the inbox, under its parent). */
export async function createTask(userId: string, input: TaskInput & { title: string }): Promise<Task> {
  return prisma.$transaction(async (tx) => {
    const parent = input.parentId ? await lockedParent(tx, userId, input.parentId) : null;
    if (parent && input.dossierId !== undefined && input.dossierId !== parent.dossierId) {
      throw new AppError(400, 'Un sottocompito sta nel dossier del compito principale.');
    }
    const dossierId = parent ? parent.dossierId : input.dossierId ?? null;
    const shape: Shape = {
      dossierId,
      dossierItemId: input.dossierItemId ?? null,
      plannedDate: input.plannedDate ?? null,
      plannedTime: input.plannedTime ?? null,
      dueDate: input.dueDate ?? null,
      dueTime: input.dueTime ?? null,
      recurrence: input.recurrence ?? null,
    };
    checkShape(shape);
    if (dossierId) await assertOwnDossier(tx, userId, dossierId);
    if (dossierId && shape.dossierItemId) await assertItemOfDossier(tx, dossierId, shape.dossierItemId);
    return tx.task.create({
      data: {
        userId,
        dossierId,
        dossierItemId: shape.dossierItemId,
        parentId: parent?.id ?? null,
        position: await nextPosition(tx, userId, dossierId, parent?.id ?? null),
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? 4,
        labels: input.labels ?? [],
        plannedDate: dayInput(input.plannedDate) ?? null,
        plannedTime: timeInput(input.plannedTime) ?? null,
        dueDate: dayInput(input.dueDate) ?? null,
        dueTime: timeInput(input.dueTime) ?? null,
        recurrence: input.recurrence ?? null,
        recurrenceFrom: input.recurrenceFrom ?? 'pianificata',
        recurrenceDay: shape.recurrence && shape.plannedDate ? dayOfMonth(shape.plannedDate) : null,
        origin: input.origin ?? 'lavoro',
      },
    });
  });
}

/**
 * Changes a task that is not in the trash. A subtask always sits in its parent's dossier: a new
 * parent brings the task (and what is under it) into the parent's dossier, and a subtask's dossier
 * changes only with its parent. A task moved to another dossier loses its entry, as do its subtasks.
 */
export async function updateTask(userId: string, id: string, input: TaskInput): Promise<Task> {
  return prisma.$transaction(async (tx) => {
    if (typeof input.parentId === 'string') await lockParentChanges(tx, userId);
    // The dossiers a move may touch are locked before the task, in the order the dossier's trash takes
    // them (dossier, then its tasks); the task is then re-read, and a dossier changed meanwhile is a 409.
    if (input.dossierId !== undefined || input.parentId !== undefined) {
      const before = await tx.task.findFirst({ where: { id, userId }, select: { dossierId: true } });
      const parentDossier = input.parentId ? (await tx.task.findFirst({ where: { id: input.parentId, userId }, select: { dossierId: true } }))?.dossierId ?? null : null;
      await lockDossiers(tx, userId, [before?.dossierId ?? null, input.dossierId ?? null, parentDossier]);
      await lockTask(tx, userId, id);
      const now = await tx.task.findFirst({ where: { id, userId }, select: { dossierId: true } });
      if (before && now && now.dossierId !== before.dossierId) throw new AppError(409, 'Il compito è cambiato nel frattempo: riprova.');
    } else {
      await lockTask(tx, userId, id);
    }
    const existing = await liveTask(tx, userId, id);

    let parentId = existing.parentId;
    let dossierId = existing.dossierId;
    if (input.parentId !== undefined && input.parentId !== existing.parentId) {
      if (input.parentId === null) {
        parentId = null;
        if (input.dossierId !== undefined) dossierId = input.dossierId;
      } else {
        const parent = await lockedParent(tx, userId, input.parentId);
        if (await isAncestorOrSelf(tx, userId, id, parent.id)) {
          throw new AppError(400, 'Un compito non può stare sotto un suo sottocompito.');
        }
        if (input.dossierId !== undefined && input.dossierId !== parent.dossierId) {
          throw new AppError(400, 'Un sottocompito sta nel dossier del compito principale.');
        }
        parentId = parent.id;
        dossierId = parent.dossierId;
      }
    } else if (input.dossierId !== undefined && input.dossierId !== existing.dossierId) {
      if (existing.parentId) throw new AppError(400, 'Un sottocompito sta nel dossier del compito principale.');
      dossierId = input.dossierId;
    }
    const dossierMoved = dossierId !== existing.dossierId;
    if (dossierMoved && dossierId) await assertOwnDossier(tx, userId, dossierId);

    const shape: Shape = {
      dossierId,
      dossierItemId: input.dossierItemId !== undefined ? input.dossierItemId : dossierMoved ? null : existing.dossierItemId,
      plannedDate: input.plannedDate !== undefined ? input.plannedDate : dayOrNull(existing.plannedDate),
      plannedTime: input.plannedTime !== undefined ? input.plannedTime : timeOrNull(existing.plannedTime),
      dueDate: input.dueDate !== undefined ? input.dueDate : dayOrNull(existing.dueDate),
      dueTime: input.dueTime !== undefined ? input.dueTime : timeOrNull(existing.dueTime),
      recurrence: input.recurrence !== undefined ? input.recurrence : existing.recurrence,
    };
    checkShape(shape);
    if (dossierId && shape.dossierItemId && (dossierMoved || shape.dossierItemId !== existing.dossierItemId)) {
      await assertItemOfDossier(tx, dossierId, shape.dossierItemId);
    }

    if (dossierMoved) {
      const below = (await subtreeIds(tx, userId, id)).filter((taskId) => taskId !== id);
      if (below.length > 0) {
        await tx.task.updateMany({ where: { id: { in: below }, userId }, data: { dossierId, dossierItemId: null } });
      }
    }
    // A task that changes list (another dossier, another parent) goes after the last one of the new list.
    const listChanged = dossierMoved || parentId !== existing.parentId;
    // The day a repetition keeps is the planned date's when the user sets the rule, its origin or a
    // new day. A write that leaves the rule and its origin as they are, with a date where the kept day
    // lands in its month, keeps it: a February 28th the tick shortened from the 31st does not become
    // the 28th for good when the web sends the task back whole, or when «Annulla» puts it back there.
    const recurrenceFrom = input.recurrenceFrom ?? existing.recurrenceFrom;
    const repetitionKept =
      existing.recurrenceDay !== null &&
      shape.recurrence === existing.recurrence &&
      recurrenceFrom === existing.recurrenceFrom &&
      shape.plannedDate !== null &&
      landsOnDay(shape.plannedDate, existing.recurrenceDay);
    const recurrenceDay = !shape.recurrence || !shape.plannedDate ? null : repetitionKept ? existing.recurrenceDay : dayOfMonth(shape.plannedDate);
    return tx.task.update({
      where: { id },
      data: {
        position: listChanged ? await nextPosition(tx, userId, dossierId, parentId) : undefined,
        title: input.title,
        description: input.description,
        priority: input.priority,
        labels: input.labels,
        parentId,
        dossierId,
        dossierItemId: shape.dossierItemId,
        plannedDate: dayInput(input.plannedDate),
        plannedTime: timeInput(input.plannedTime),
        dueDate: dayInput(input.dueDate),
        dueTime: timeInput(input.dueTime),
        recurrence: input.recurrence,
        recurrenceFrom: input.recurrenceFrom,
        recurrenceDay,
        origin: input.origin,
      },
    });
  });
}

export interface CompleteResult {
  task: Task;
  /** A repeating task does not close: its planned date moves to the next occurrence. */
  recurred: { previousPlannedDate: string; plannedDate: string } | null;
}

/**
 * Ticks a task. A repeating one moves to its next planned date and stays open; any other closes,
 * with the open tasks under it, all at the same instant (so that reopening it reopens them).
 * `seenPlannedDate` is the occurrence the user ticked, required for a repeating task (400 without):
 * one that has already moved on (a second click, another tab) answers 409 instead of moving twice.
 * Ticking a closed task changes nothing.
 */
export async function completeTask(userId: string, id: string, seenPlannedDate?: string, now: Date = new Date()): Promise<CompleteResult> {
  return prisma.$transaction(async (tx) => {
    await lockTask(tx, userId, id);
    const task = await liveTask(tx, userId, id);
    if (task.completedAt) return { task, recurred: null };

    const plannedDay = dayOrNull(task.plannedDate);
    if (task.recurrence && plannedDay) {
      if (seenPlannedDate === undefined) {
        throw new AppError(400, 'Per spuntare un compito che si ripete indica la data spuntata (plannedDate).');
      }
      if (seenPlannedDate !== plannedDay) {
        throw new AppError(409, 'Il compito è già passato alla data successiva.');
      }
      const next = nextOccurrence(task.recurrence as RecurrenceRule, task.recurrenceFrom, plannedDay, romeDay(now), task.recurrenceDay ?? undefined);
      const updated = await tx.task.update({ where: { id }, data: { plannedDate: dayToDate(next) } });
      return { task: updated, recurred: { previousPlannedDate: plannedDay, plannedDate: next } };
    }

    const ids = await subtreeIds(tx, userId, id);
    await tx.task.updateMany({ where: { id: { in: ids }, userId, completedAt: null, deletedAt: null }, data: { completedAt: now } });
    return { task: await tx.task.findUniqueOrThrow({ where: { id } }), recurred: null };
  });
}

/** Reopens a closed task, and the tasks under it that were closed with it. An open task stays as it is. */
export async function reopenTask(userId: string, id: string): Promise<Task> {
  return prisma.$transaction(async (tx) => {
    await lockTask(tx, userId, id);
    const task = await liveTask(tx, userId, id);
    if (!task.completedAt) return task;
    const ids = await subtreeIds(tx, userId, id);
    await tx.task.updateMany({ where: { id: { in: ids }, userId, completedAt: task.completedAt, deletedAt: null }, data: { completedAt: null } });
    return tx.task.findUniqueOrThrow({ where: { id } });
  });
}

/**
 * Manual order within one list: the tasks named, all of the same dossier (or the inbox) and under the
 * same parent, take positions 0, 1, 2… in that order, in one statement. One that is not the user's (or
 * is in the trash) refuses all (404), and so do tasks of two lists (400).
 */
export async function reorderTasks(userId: string, taskIds: string[]): Promise<void> {
  const ids = [...new Set(taskIds)];
  await prisma.$transaction(async (tx) => {
    // Locked in id order: a move to another list in flight finishes first, and is then seen here.
    const rows = await tx.$queryRaw<{ id: string; dossier_id: string | null; parent_id: string | null }[]>`
      SELECT id, dossier_id, parent_id FROM tasks
      WHERE id = ANY(${ids}::text[]) AND user_id = ${userId} AND deleted_at IS NULL
      ORDER BY id FOR UPDATE`;
    if (rows.length !== ids.length) throw new AppError(404, NOT_FOUND);
    const lists = new Set(rows.map((row) => `${row.dossier_id ?? ''}|${row.parent_id ?? ''}`));
    if (lists.size > 1) throw new AppError(400, 'Si ordinano i compiti di una lista alla volta.');
    // `updated_at` is a TIMESTAMP holding UTC, as Prisma writes it.
    await tx.$executeRaw`
      UPDATE tasks AS t SET position = (o.ord - 1)::int, updated_at = (now() AT TIME ZONE 'UTC')
      FROM unnest(${ids}::text[]) WITH ORDINALITY AS o(id, ord)
      WHERE t.id = o.id AND t.user_id = ${userId}`;
  });
}

/** Moves a task, with every task under it still out of the trash, to the trash, at one instant. */
export async function trashTask(userId: string, id: string, now: Date = new Date()): Promise<{ deletedAt: Date; taskCount: number }> {
  await maybeSweep();
  return prisma.$transaction(async (tx) => {
    await lockTask(tx, userId, id);
    await liveTask(tx, userId, id);
    const ids = await subtreeIds(tx, userId, id);
    const { count } = await tx.task.updateMany({ where: { id: { in: ids }, userId, deletedAt: null }, data: { deletedAt: now } });
    return { deletedAt: now, taskCount: count };
  });
}

/**
 * Takes a task out of the trash, with the tasks under it that went with it (same instant). When its
 * parent is still in the trash, it comes back on its own, as a task of the same list.
 */
export async function restoreTask(userId: string, id: string, now: Date = new Date()): Promise<Task> {
  return prisma.$transaction(async (tx) => {
    await lockTask(tx, userId, id);
    const task = await tx.task.findFirst({
      where: { id, userId, deletedAt: { not: null, gt: new Date(now.getTime() - TASK_TRASH_RETENTION_MS) } },
      include: { parent: { select: { deletedAt: true } } },
    });
    if (!task || !task.deletedAt) throw new AppError(404, 'Compito non trovato nel cestino.');
    // It comes back after the last one of its list: its old place may have been taken meanwhile.
    const parentId = task.parent?.deletedAt ? null : task.parentId;
    const position = await nextPosition(tx, userId, task.dossierId, parentId);
    const ids = await subtreeIds(tx, userId, id);
    await tx.task.updateMany({ where: { id: { in: ids }, userId, deletedAt: task.deletedAt }, data: { deletedAt: null } });
    return tx.task.update({ where: { id }, data: { parentId, position } });
  });
}

/** The user's task, in the trash or not. */
export async function getTask(userId: string, id: string): Promise<Task> {
  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) throw new AppError(404, NOT_FOUND);
  return task;
}

export interface ViewResult {
  today: string;
  tasks: Task[];
  truncated: boolean;
}

const datedOrder: Prisma.TaskOrderByWithRelationInput[] = [
  { plannedDate: { sort: 'asc', nulls: 'last' } },
  { plannedTime: { sort: 'asc', nulls: 'last' } },
  { priority: 'asc' },
  { position: 'asc' },
  { createdAt: 'asc' },
  { id: 'asc' },
];
const listOrder: Prisma.TaskOrderByWithRelationInput[] = [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }];

/**
 * A view of the user's open tasks, «today» being the Rome day at `now`:
 * - `today`: planned for today or before, or with a deadline today or past (the overdue ones);
 * - `upcoming`: planned, or with a deadline, from today to six days on;
 * - `inbox`: the tasks of no dossier;
 * - `dossier`: the tasks of one of the user's dossiers;
 * - `trash`: the tasks in the trash, latest first.
 * Subtasks come in the same list, flat, with their `parent_id`.
 */
export async function listTasks(userId: string, view: TaskView, dossierId: string | undefined, now: Date = new Date()): Promise<ViewResult> {
  const today = romeDay(now);
  const open: Prisma.TaskWhereInput = { userId, deletedAt: null, completedAt: null };
  let where: Prisma.TaskWhereInput;
  let orderBy = datedOrder;
  switch (view) {
    case 'today': {
      const until = dayToDate(today);
      where = { ...open, OR: [{ plannedDate: { lte: until } }, { dueDate: { lte: until } }] };
      break;
    }
    case 'upcoming': {
      const range = { gte: dayToDate(today), lte: dayToDate(addDays(today, UPCOMING_DAYS - 1)) };
      where = { ...open, OR: [{ plannedDate: range }, { dueDate: range }] };
      break;
    }
    case 'inbox':
      where = { ...open, dossierId: null };
      orderBy = listOrder;
      break;
    case 'dossier':
      if (!dossierId) throw new AppError(400, 'La vista per dossier richiede il dossier.');
      await assertOwnDossier(prisma, userId, dossierId);
      where = { ...open, dossierId };
      orderBy = listOrder;
      break;
    case 'trash':
      await maybeSweep();
      where = { userId, deletedAt: { not: null, gt: new Date(now.getTime() - TASK_TRASH_RETENTION_MS) } };
      orderBy = [{ deletedAt: 'desc' }, { id: 'asc' }];
      break;
  }
  const rows = await prisma.task.findMany({ where, orderBy, take: VIEW_LIMIT + 1 });
  return { today, tasks: rows.slice(0, VIEW_LIMIT), truncated: rows.length > VIEW_LIMIT };
}

let lastSweep = 0;

/** Removes the tasks in the trash for more than 30 days (and, by the cascade, the tasks under them); returns how many. */
export async function sweepTrashedTasks(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - TASK_TRASH_RETENTION_MS);
  // A subtask out of the trash under a parent that is going (restored alone, or written in a race)
  // stays, on its own: the cascade would otherwise delete a live task.
  await prisma.task.updateMany({ where: { deletedAt: null, parent: { deletedAt: { lt: cutoff } } }, data: { parentId: null } });
  const { count } = await prisma.task.deleteMany({ where: { deletedAt: { lt: cutoff } } });
  return count;
}

/** At most every ten minutes, awaited by the routes that touch the trash, as the dossiers' trash does. */
async function maybeSweep(): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  await sweepTrashedTasks(new Date(now));
}
