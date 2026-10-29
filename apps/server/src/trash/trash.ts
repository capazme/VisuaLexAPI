import { Prisma, type TrashKind } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { citeStoredAct } from '../norms/citation';
import { citeStoredItem } from '../norms/decisionCitation';
import { PERSONAL_STATES } from '../lingo/deleteUserAccount';
import { countingModules } from '../lingo/courses';
import { LIMITS } from '../schemas/lingo/corso';

/**
 * The trash (MCP second round, spec §4.3): what a connected application
 * deletes, and a dossier or a study card the user deletes from the web app,
 * is copied here, as the rows were, and then deleted, in one transaction. The user restores it from the web app for 30 days; then the
 * sweep removes it for good. Only the user's session lists, restores or
 * empties it: none of those routes is in the delegated table.
 */

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 10 * 60 * 1000;

/**
 * Which connection deleted: the trash outlives the client and the grant, so
 * plain values. All null when the user deleted from the web app themselves
 * (`BY_THE_USER`: a whole dossier, study cards).
 */
export interface DeletedBy {
  clientId: string | null;
  clientName: string | null;
  grantId: string | null;
}

/** A deletion by the user's own session, listed «Rimosso da te». */
export const BY_THE_USER: DeletedBy = { clientId: null, clientName: null, grantId: null };

export interface TrashListEntry {
  id: string;
  kind: TrashKind;
  dossierId: string | null;
  label: string;
  itemCount: number;
  /** A whole dossier's planner tasks, which went to the trash with it (absent when it had none). */
  taskCount?: number;
  /** A course's or a module's cards, which went with it (Percorsi). */
  cardCount?: number;
  items?: { itemType: string; citation: string | null; actCitation: string | null }[];
  cards?: { istituto: string; domanda: string }[];
  clientName: string | null;
  /** Deleted through a connected application, whose name may still be unknown (null): not the user's own deletion. */
  byApplication: boolean;
  deletedAt: string;
  expiresAt: string;
}

interface ItemSummary {
  itemType: string;
  citation: string | null;
  actCitation: string | null;
}

/** A row as JSON: dates become ISO strings, which is how the payload keeps them. */
const asJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** A card's review state and a line of its log as the payload keeps them (dates as ISO strings). */
interface StoredReviewState {
  cardId: string;
  stability: number;
  difficulty: number;
  dueAt: string;
  lastReviewAt: string;
  reps: number;
  lapses: number;
}
interface StoredReview {
  id: string;
  cardId: string;
  dataRevisione: string;
  rating: number;
  scheduledDays: number;
  stability: number;
  difficulty: number;
  durataMs: number | null;
}

const itemSummary = (item: { itemType: string; content: unknown }): ItemSummary => ({
  itemType: item.itemType,
  citation: citeStoredItem(item.itemType, item.content),
  actCitation: citeStoredAct(item.itemType, item.content),
});

const expiry = (from: Date) => new Date(from.getTime() + TRASH_RETENTION_MS);

/**
 * Locks the user's dossier row for the rest of the transaction: an entry or a
 * snapshot added meanwhile (web, or a parallel tool call) waits, so it can
 * neither be deleted without reaching the payload nor slip between the read
 * and the delete. False when the dossier is not the user's.
 */
async function lockDossier(tx: Prisma.TransactionClient, userId: string, dossierId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM dossiers WHERE id = ${dossierId} AND user_id = ${userId} FOR UPDATE`;
  return rows.length === 1;
}

/**
 * The assistant's marks on these entries (D7b), locked and read: a state change or an edit in flight
 * finishes first and lands in the payload, one that comes after finds no row (404). They belong to the
 * entry: they go to the trash with it, in every state, and come back with it.
 */
async function lockedProposals(tx: Prisma.TransactionClient, userId: string, itemIds: string[]) {
  if (itemIds.length === 0) return [];
  await tx.$queryRaw`
    SELECT id FROM highlights
    WHERE user_id = ${userId} AND dossier_item_id IN (${Prisma.join(itemIds)}) AND created_by_client_id IS NOT NULL
    ORDER BY id FOR UPDATE`;
  return tx.highlight.findMany({
    where: { userId, dossierItemId: { in: itemIds }, createdByClientId: { not: null } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

/**
 * A database error from a move to the trash or a restore, as it reaches the logs: its kind and code
 * only. The rows travel through these queries (a dossier's name, its tasks' titles: a client's name,
 * possibly), and Prisma's message can quote the arguments of the query it refused. The caller gets
 * the usual 500; an `AppError` passes through untouched.
 */
function quietly(where: string, error: unknown): never {
  if (error instanceof AppError) throw error;
  const kind = error instanceof Error ? error.name : typeof error;
  const code = error instanceof Prisma.PrismaClientKnownRequestError ? ` ${error.code}` : '';
  console.error(`${where} failed: ${kind}${code}`);
  throw new AppError(500, 'Internal server error');
}

let lastSweep = 0;

/** Removes the entries past their 30 days; returns how many. */
export async function sweepExpiredTrash(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.trashEntry.deleteMany({ where: { expiresAt: { lt: now } } });
  return count;
}

/**
 * Sweeps at most every ten minutes, awaited by the trash routes: never
 * fire-and-forget work on the database (a background sweep deadlocked the
 * suite's TRUNCATE in phase 1).
 */
async function maybeSweep(): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  await sweepExpiredTrash(new Date(now));
}

/**
 * Moves a whole dossier, with its entries, snapshots and planner tasks, to the trash. A
 * connected application names what the user was shown when confirming (`seen`): the entries,
 * and how many tasks go with them («e 3 compiti», never their titles; owner, 20 October 2026).
 * An entry added or removed meanwhile, or another number of tasks, refuses the move (409). The
 * web app's own deletion passes null: whatever the dossier holds goes, and
 * comes back, together (owner, 13 October 2026, question 160).
 */
export async function trashDossier(
  userId: string,
  dossierId: string,
  seen: { itemIds: string[]; taskCount: number } | null,
  by: DeletedBy,
): Promise<{ trashId: string; itemCount: number; taskCount: number }> {
  await maybeSweep();
  return prisma.$transaction(async (tx) => {
    if (!(await lockDossier(tx, userId, dossierId))) throw new AppError(404, 'Dossier not found');
    // Its tasks are locked too, before they are read: a change in flight (an edit, a tick, a task
    // moved to the trash) is committed first and lands in the payload, and one that comes after
    // waits and then finds no task. Otherwise the payload would keep the task as it was.
    await tx.$queryRaw`SELECT id FROM tasks WHERE dossier_id = ${dossierId} AND user_id = ${userId} ORDER BY id FOR UPDATE`;
    // Its entries too, for an assistant's note whose state or text changes in flight (D7b).
    await tx.$queryRaw`SELECT id FROM dossier_items WHERE dossier_id = ${dossierId} ORDER BY id FOR UPDATE`;
    const dossier = await tx.dossier.findFirst({
      where: { id: dossierId, userId },
      include: {
        items: { orderBy: { position: 'asc' } },
        snapshots: { orderBy: { version: 'asc' } },
        publishedCopy: { select: { id: true } },
        // Its tasks follow it, done and trashed ones too, and come back with it (answer 2 on the task model).
        tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!dossier) throw new AppError(404, 'Dossier not found');
    if (seen) {
      const seenIds = new Set(seen.itemIds);
      const sameItems = seenIds.size === dossier.items.length && dossier.items.every((item) => seenIds.has(item.id));
      if (!sameItems || seen.taskCount !== dossier.tasks.length) {
        throw new AppError(409, 'Il dossier è cambiato dopo la conferma: nulla è stato eliminato.');
      }
    }
    const { items, snapshots, publishedCopy, tasks, ...row } = dossier;
    const proposals = await lockedProposals(tx, userId, items.map((item) => item.id));
    // The course enrolments that study it (Percorsi, §10.3): their link is set null with the row and comes back on restore.
    const iscrizioni = (await tx.lingoCorsoIscrizione.findMany({ where: { dossierId: dossier.id, utenteId: userId }, select: { id: true } })).map((i) => i.id);
    const now = new Date();
    const entry = await tx.trashEntry.create({
      data: {
        userId,
        kind: 'DOSSIER',
        dossierId: dossier.id,
        label: dossier.name,
        summary: tasks.length > 0 ? { itemCount: items.length, taskCount: tasks.length } : { itemCount: items.length },
        // Its copy in the Forum stays published; the link (cleared with the row) comes back on restore.
        payload: asJson({ dossier: row, items, snapshots, publishedCopyId: publishedCopy?.id ?? null, tasks, proposals, iscrizioni }),
        clientId: by.clientId,
        clientName: by.clientName,
        grantId: by.grantId,
        deletedAt: now,
        expiresAt: expiry(now),
      },
    });
    // Items, snapshots and tasks cascade with the dossier; the assistant's marks have no foreign key.
    if (proposals.length > 0) await tx.highlight.deleteMany({ where: { id: { in: proposals.map((p) => p.id) } } });
    await tx.dossier.delete({ where: { id: dossier.id } });
    return { trashId: entry.id, itemCount: items.length, taskCount: tasks.length };
  }).catch((error: unknown) => quietly('Dossier trash', error));
}

/**
 * Moves entries of one dossier to the trash: exactly the ids given that are in
 * that dossier. The others are reported, never deleted; when none is there,
 * nothing is written (404).
 */
export async function trashDossierItems(
  userId: string,
  dossierId: string,
  itemIds: string[],
  by: DeletedBy,
): Promise<{ trashId: string; moved: string[]; notFound: string[] }> {
  await maybeSweep();
  return prisma.$transaction(async (tx) => {
    if (!(await lockDossier(tx, userId, dossierId))) throw new AppError(404, 'Dossier not found');
    const dossier = await tx.dossier.findFirst({ where: { id: dossierId, userId } });
    if (!dossier) throw new AppError(404, 'Dossier not found');
    const wanted = [...new Set(itemIds)];
    // The entries are locked before they are read: a state change or an edit of an assistant's note in flight
    // (D7b, which locks the entry's row alone) lands in the payload, one that comes after finds no entry.
    await tx.$queryRaw`SELECT id FROM dossier_items WHERE id IN (${Prisma.join(wanted)}) AND dossier_id = ${dossierId} ORDER BY id FOR UPDATE`;
    const items = await tx.dossierItem.findMany({ where: { id: { in: wanted }, dossierId }, orderBy: { position: 'asc' } });
    if (items.length === 0) throw new AppError(404, 'Nessuna delle voci indicate è in questo dossier.');
    const moved = items.map((item) => item.id);
    const proposals = await lockedProposals(tx, userId, moved);
    const now = new Date();
    const entry = await tx.trashEntry.create({
      data: {
        userId,
        kind: 'DOSSIER_ITEMS',
        dossierId,
        label: dossier.name,
        summary: asJson({ itemCount: items.length, items: items.map(itemSummary) }),
        payload: asJson(proposals.length > 0 ? { items, proposals } : { items }),
        clientId: by.clientId,
        clientName: by.clientName,
        grantId: by.grantId,
        deletedAt: now,
        expiresAt: expiry(now),
      },
    });
    const deleted = await tx.dossierItem.deleteMany({ where: { id: { in: moved }, dossierId } });
    // An entry moved away by a concurrent request between the read and the delete: undo it all.
    if (deleted.count !== moved.length) throw new AppError(409, 'Il dossier è cambiato nel frattempo: riprova.');
    if (proposals.length > 0) await tx.highlight.deleteMany({ where: { id: { in: proposals.map((p) => p.id) } } });
    await tx.dossier.update({ where: { id: dossierId }, data: { updatedAt: now } });
    const movedIds = new Set(moved);
    return { trashId: entry.id, moved, notFound: wanted.filter((id) => !movedIds.has(id)) };
  });
}

/**
 * Moves the user's own cards to the trash, only in a personal state (draft,
 * archived: owner's answer «28 sì»); a card the community has taken up is
 * reported as not deletable and stays (D-045). Nothing movable: nothing written.
 */
export async function trashLingoCards(
  userId: string,
  cardIds: string[],
  by: DeletedBy,
): Promise<{ trashId?: string; moved: string[]; notFound: string[]; notDeletable: string[] }> {
  await maybeSweep();
  return prisma.$transaction(async (tx) => {
    const wanted = [...new Set(cardIds)];
    // Lock the rows first, in id order: an edit in flight (PATCH) finishes before the payload is read, and one
    // that comes after waits, then finds no card.
    await tx.$queryRaw`SELECT id FROM lingo_cards WHERE id IN (${Prisma.join(wanted)}) AND autore_id = ${userId} ORDER BY id FOR UPDATE`;
    const cards = await tx.lingoCard.findMany({ where: { id: { in: wanted }, autoreId: userId }, include: CARD_PAYLOAD, orderBy: { createdAt: 'asc' } });
    const movable = cards.filter((card) => PERSONAL_STATES.includes(card.stato));
    const moved = movable.map((card) => card.id);
    const notFound = wanted.filter((id) => !cards.some((card) => card.id === id));
    const notDeletable = cards.filter((card) => !PERSONAL_STATES.includes(card.stato)).map((card) => card.id);
    if (movable.length === 0) return { moved, notFound, notDeletable };
    // The author's review state and log cascade with the card: they travel in the payload, so that restoring a
    // studied draft does not make it «nuova» again and the log (kept to fit the weights, spec decision 17) is not lost.
    // Only the author's rows: a personal card is nobody else's to review, and another person's history does not
    // belong in this person's trash.
    const states = await tx.lingoStatoRipasso.findMany({ where: { cardId: { in: moved }, utenteId: userId } });
    const reviews = await tx.lingoRevisioneSRS.findMany({
      where: { cardId: { in: moved }, utenteId: userId },
      orderBy: [{ dataRevisione: 'asc' }, { id: 'asc' }],
    });
    const now = new Date();
    const entry = await tx.trashEntry.create({
      data: {
        userId,
        kind: 'LINGO_CARDS',
        dossierId: null,
        label: 'Schede di studio',
        summary: asJson({
          itemCount: movable.length,
          cards: movable.map((card) => ({ istituto: card.istituto, domanda: card.domanda.length > 120 ? `${card.domanda.slice(0, 119)}…` : card.domanda })),
        }),
        payload: asJson({ cards: movable, states, reviews }),
        clientId: by.clientId,
        clientName: by.clientName,
        grantId: by.grantId,
        deletedAt: now,
        expiresAt: expiry(now),
      },
    });
    // Anchors cascade with their card; the state filter again, against a change since the read.
    const deleted = await tx.lingoCard.deleteMany({ where: { id: { in: moved }, autoreId: userId, stato: { in: PERSONAL_STATES } } });
    if (deleted.count !== moved.length) throw new AppError(409, 'Le schede sono cambiate nel frattempo: riprova.');
    return { trashId: entry.id, moved, notFound, notDeletable };
  });
}

/** The user's trash, newest first, without the stored rows. */
export async function listTrash(userId: string): Promise<TrashListEntry[]> {
  await maybeSweep();
  const entries = await prisma.trashEntry.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { deletedAt: 'desc' },
  });
  return entries.map((entry) => {
    const summary = entry.summary as { itemCount?: number; taskCount?: number; cardCount?: number; items?: ItemSummary[]; cards?: { istituto: string; domanda: string }[] };
    return {
      id: entry.id,
      kind: entry.kind,
      dossierId: entry.dossierId,
      label: entry.label,
      itemCount: summary.itemCount ?? 0,
      ...(summary.taskCount ? { taskCount: summary.taskCount } : {}),
      ...(summary.cardCount !== undefined ? { cardCount: summary.cardCount } : {}),
      ...(summary.items ? { items: summary.items } : {}),
      ...(summary.cards ? { cards: summary.cards } : {}),
      clientName: entry.clientName,
      byApplication: entry.clientId !== null,
      deletedAt: entry.deletedAt.toISOString(),
      expiresAt: entry.expiresAt.toISOString(),
    };
  });
}

type StoredItem = {
  id: string;
  itemType: Prisma.DossierItemCreateManyInput['itemType'];
  title: string;
  content: unknown;
  position: number;
  status: Prisma.DossierItemCreateManyInput['status'];
  createdAt: string;
  createdByClientId: string | null;
  createdByClientName: string | null;
  aboutItemId: string | null;
  // An assistant's note entry's state (D7b); absent from a payload stored before the columns.
  assistantNote?: string | null;
  noteState?: Prisma.DossierItemCreateManyInput['noteState'];
  noteStateChangedAt?: string | null;
  reviewComment?: string | null;
  noteEditedAt?: string | null;
  noteEditedBy?: string | null;
};

/** An assistant's mark on an entry (D7b), as the payload keeps it; absent from a payload stored before. */
type StoredProposal = {
  id: string;
  normaKey: string;
  text: string;
  color: string;
  startOffset: number;
  endOffset: number;
  note: string | null;
  bookmarkId: string | null;
  createdAt: string;
  createdByClientId: string;
  createdByClientName: string | null;
  dossierItemId: string;
  assistantText: string;
  assistantStartOffset: number;
  rangeEditedAt: string | null;
  rangeEditedBy: string | null;
  assistantNote: string | null;
  noteState: Prisma.HighlightCreateManyInput['noteState'];
  noteStateChangedAt: string | null;
  reviewComment: string | null;
  noteEditedAt: string | null;
  noteEditedBy: string | null;
};

const proposalRow = (p: StoredProposal, userId: string): Prisma.HighlightCreateManyInput => ({
  id: p.id,
  userId,
  normaKey: p.normaKey,
  text: p.text,
  color: p.color,
  startOffset: p.startOffset,
  endOffset: p.endOffset,
  note: p.note,
  // A bookmark is the user's and may be gone; the mark never needed one.
  bookmarkId: null,
  createdAt: new Date(p.createdAt),
  createdByClientId: p.createdByClientId,
  createdByClientName: p.createdByClientName,
  dossierItemId: p.dossierItemId,
  assistantText: p.assistantText,
  assistantStartOffset: p.assistantStartOffset,
  rangeEditedAt: dateOrNull(p.rangeEditedAt),
  rangeEditedBy: p.rangeEditedBy,
  assistantNote: p.assistantNote,
  noteState: p.noteState,
  noteStateChangedAt: dateOrNull(p.noteStateChangedAt),
  reviewComment: p.reviewComment,
  noteEditedAt: dateOrNull(p.noteEditedAt),
  noteEditedBy: p.noteEditedBy,
});

/** Brings back the assistant's marks of restored entries, with their ids; one live again is left alone. */
async function restoreProposals(tx: Prisma.TransactionClient, userId: string, proposals: StoredProposal[]): Promise<void> {
  if (proposals.length === 0) return;
  const live = new Set((await tx.highlight.findMany({ where: { id: { in: proposals.map((p) => p.id) } }, select: { id: true } })).map((h) => h.id));
  const back = proposals.filter((p) => !live.has(p.id));
  if (back.length > 0) await tx.highlight.createMany({ data: back.map((p) => proposalRow(p, userId)) });
}

/** The id when its row still exists, else null (a foreign key to a deleted row would fail the restore). */
async function existingId(value: unknown, count: (id: string) => Promise<number>): Promise<string | null> {
  if (typeof value !== 'string' || !value) return null;
  return (await count(value)) > 0 ? value : null;
}

/** A planner task as the payload keeps it (dates as ISO strings; DATE and TIME columns at their UTC instant). */
type StoredTask = {
  id: string;
  dossierItemId: string | null;
  parentId: string | null;
  position: number;
  title: string;
  description: string | null;
  priority: number;
  labels: string[];
  plannedDate: string | null;
  plannedTime: string | null;
  dueDate: string | null;
  dueTime: string | null;
  recurrence: string | null;
  recurrenceFrom: Prisma.TaskCreateManyInput['recurrenceFrom'];
  /** Absent in a payload stored before the column: the repetition then counts from the planned date's day. */
  recurrenceDay?: number | null;
  durationMinutes: number | null;
  assigneeId: string | null;
  origin: Prisma.TaskCreateManyInput['origin'];
  completedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
};

const dateOrNull = (value: string | null) => (value === null ? null : new Date(value));

const jsonOrNull = (value: unknown) => (value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue));

/**
 * An assistant's note entry trashed before D7b's migration has no `noteState` key in its payload: it comes back
 * «da validare», with its text as the original, as the migration made every one outside the trash.
 */
function noteStateOf(item: StoredItem): Pick<Prisma.DossierItemCreateManyInput, 'assistantNote' | 'noteState'> {
  if ('noteState' in item) return { assistantNote: item.assistantNote ?? null, noteState: item.noteState ?? null };
  const before = item.itemType === 'note' && item.createdByClientId && typeof item.content === 'string';
  return before ? { assistantNote: item.content as string, noteState: 'proposed' } : { assistantNote: null, noteState: null };
}

const itemRow = (item: StoredItem, dossierId: string, position: number, aboutItemId: string | null): Prisma.DossierItemCreateManyInput => ({
  id: item.id,
  dossierId,
  itemType: item.itemType,
  title: item.title,
  content: jsonOrNull(item.content),
  position,
  status: item.status,
  createdAt: new Date(item.createdAt),
  createdByClientId: item.createdByClientId,
  createdByClientName: item.createdByClientName,
  aboutItemId,
  ...noteStateOf(item),
  noteStateChangedAt: dateOrNull(item.noteStateChangedAt ?? null),
  reviewComment: item.reviewComment ?? null,
  noteEditedAt: dateOrNull(item.noteEditedAt ?? null),
  noteEditedBy: item.noteEditedBy ?? null,
});

/**
 * Restores a whole trash entry, with the rows' original ids, and removes it
 * from the trash, in one transaction. Entries go back after the dossier's last
 * entry, in their original order; when their dossier is gone, the user names
 * another of theirs. A second restore is a 404.
 */
export async function restoreTrashEntry(userId: string, trashId: string, targetDossierId?: string): Promise<{ dossierId: string | null }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const entry = await tx.trashEntry.findFirst({ where: { id: trashId, userId, expiresAt: { gt: new Date() } } });
      if (!entry) throw new AppError(404, 'Elemento del cestino non trovato.');
      // A dossier's published copy is locked before its entry, in the order the admin's withdraw and
      // republish take them (the copy, then the entry they rewrite): the other way round, a restore and
      // one of those would deadlock.
      const copyId = entry.kind === 'DOSSIER' ? (entry.payload as { publishedCopyId?: unknown }).publishedCopyId : null;
      if (typeof copyId === 'string' && copyId) await tx.$queryRaw`SELECT id FROM shared_environments WHERE id = ${copyId} FOR UPDATE`;
      // The entry goes first, as the one claim on it: a purge, the sweep or another restore that took
      // it meanwhile is waited for and then leaves nothing to delete, a 404; a refusal further on rolls
      // the deletion back. Its payload is the one the deletion returns, read after any wait: an admin's
      // withdrawal that wrote its block into the entry meanwhile comes back with the dossier.
      const claimed = await tx.$queryRaw<{ payload: Prisma.JsonValue }[]>`
        DELETE FROM trash_entries WHERE id = ${entry.id} AND user_id = ${userId} RETURNING payload`;
      if (claimed.length === 0) throw new AppError(404, 'Elemento del cestino non trovato.');
      const payload = claimed[0].payload;

      if (entry.kind === 'DOSSIER') {
        // `tasks` is absent from an entry trashed before the planner.
        // `proposals` is absent from an entry trashed before D7b.
        // `iscrizioni` is absent from an entry trashed before the courses.
        const { dossier, items, snapshots, publishedCopyId, tasks = [], proposals = [], iscrizioni = [] } = payload as unknown as {
          dossier: Record<string, unknown> & { id: string; createdAt: string; updatedAt: string };
          publishedCopyId?: string | null;
          iscrizioni?: string[];
          tasks?: StoredTask[];
          proposals?: StoredProposal[];
          items: StoredItem[];
          snapshots: { id: string; dossierId: string; version: number; label: string | null; content: unknown; fingerprint: string | null; createdAt: string }[];
        };
        await tx.dossier.create({
          data: {
            id: dossier.id,
            userId,
            name: dossier.name as string,
            description: (dossier.description as string | null) ?? null,
            color: (dossier.color as string | null) ?? null,
            tags: (dossier.tags as string[]) ?? [],
            isPinned: Boolean(dossier.isPinned),
            // An entry stored before dossiers had a kind restores as a dossier di lavoro, like every old dossier.
            kind: dossier.kind === 'studio' ? 'studio' : 'lavoro',
            // An admin's block outlives the trash (question 190).
            forumBlockedAt: typeof dossier.forumBlockedAt === 'string' ? new Date(dossier.forumBlockedAt) : null,
            createdAt: new Date(dossier.createdAt),
            createdByClientId: (dossier.createdByClientId as string | null) ?? null,
            createdByClientName: (dossier.createdByClientName as string | null) ?? null,
            // The forum attribution comes back when what it points to still exists.
            sourceSuggestionId: await existingId(dossier.sourceSuggestionId, (id) => tx.environmentSuggestion.count({ where: { id } })),
            originalAuthorId: await existingId(dossier.originalAuthorId, (id) => tx.user.count({ where: { id } })),
          },
        });
        if (items.length > 0) {
          await tx.dossierItem.createMany({ data: items.map((item) => itemRow(item, dossier.id, item.position, item.aboutItemId)) });
        }
        await restoreProposals(tx, userId, proposals);
        if (snapshots.length > 0) {
          await tx.dossierSnapshot.createMany({
            data: snapshots.map((s) => ({
              id: s.id,
              dossierId: dossier.id,
              version: s.version,
              label: s.label,
              content: jsonOrNull(s.content),
              fingerprint: s.fingerprint,
              createdAt: new Date(s.createdAt),
            })),
          });
        }
        if (tasks.length > 0) {
          // A task keeps its entry and its parent when they came back with it (they always do: both
          // are of the same dossier), its assignee when that account still exists.
          const itemIds = new Set(items.map((item) => item.id));
          // A task that is live again elsewhere (it left the dossier in a race with the deletion) stays
          // as it is: restoring the dossier must not fail on it.
          const live = new Set(
            (await tx.task.findMany({ where: { id: { in: tasks.map((task) => task.id) } }, select: { id: true } })).map((task) => task.id),
          );
          const restored = tasks.filter((task) => !live.has(task.id));
          const taskIds = new Set(restored.map((task) => task.id));
          const assignees = new Map<string, string | null>();
          for (const task of tasks) {
            if (taskIds.has(task.id) && task.assigneeId && !assignees.has(task.assigneeId)) {
              assignees.set(task.assigneeId, await existingId(task.assigneeId, (id) => tx.user.count({ where: { id } })));
            }
          }
          // Parents are set in a second step: a large payload is inserted in several statements, and a
          // subtask may come before its parent.
          await tx.task.createMany({
            data: restored.map((task) => ({
              id: task.id,
              userId,
              dossierId: dossier.id,
              dossierItemId: task.dossierItemId && itemIds.has(task.dossierItemId) ? task.dossierItemId : null,
              parentId: null,
              position: task.position,
              title: task.title,
              description: task.description,
              priority: task.priority,
              labels: task.labels,
              plannedDate: dateOrNull(task.plannedDate),
              plannedTime: dateOrNull(task.plannedTime),
              dueDate: dateOrNull(task.dueDate),
              dueTime: dateOrNull(task.dueTime),
              recurrence: task.recurrence,
              recurrenceFrom: task.recurrenceFrom,
              recurrenceDay: task.recurrenceDay ?? null,
              durationMinutes: task.durationMinutes,
              assigneeId: task.assigneeId ? (assignees.get(task.assigneeId) ?? null) : null,
              origin: task.origin,
              completedAt: dateOrNull(task.completedAt),
              deletedAt: dateOrNull(task.deletedAt),
              createdAt: new Date(task.createdAt),
            })),
          });
          const byParent = new Map<string, string[]>();
          for (const task of restored) {
            if (task.parentId && taskIds.has(task.parentId)) byParent.set(task.parentId, [...(byParent.get(task.parentId) ?? []), task.id]);
          }
          for (const [parentId, children] of byParent) {
            await tx.task.updateMany({ where: { id: { in: children } }, data: { parentId } });
          }
        }
        if (iscrizioni.length > 0) {
          // A course's enrolment links it again when it still points nowhere (a course restored meanwhile may not).
          await tx.lingoCorsoIscrizione.updateMany({ where: { id: { in: iscrizioni }, utenteId: userId, dossierId: null }, data: { dossierId: dossier.id } });
        }
        if (typeof publishedCopyId === 'string' && publishedCopyId) {
          // Relinked only when the copy is still the user's and linked to nothing else.
          await tx.sharedEnvironment.updateMany({
            where: { id: publishedCopyId, userId, sourceDossierId: null },
            data: { sourceDossierId: dossier.id },
          });
        }
        return { dossierId: dossier.id };
      }

      if (entry.kind === 'DOSSIER_ITEMS') {
        const { items, proposals = [] } = payload as unknown as { items: StoredItem[]; proposals?: StoredProposal[] };
        const targetId = targetDossierId ?? entry.dossierId;
        // Locked, so a dossier going to the trash meanwhile is waited for and found gone, not half-written to.
        const target = targetId && (await lockDossier(tx, userId, targetId)) ? await tx.dossier.findFirst({ where: { id: targetId, userId } }) : null;
        if (!target) {
          if (targetDossierId) throw new AppError(404, 'Dossier not found');
          throw new AppError(409, 'Il dossier non esiste più: scegli dove ripristinare.');
        }
        const last = await tx.dossierItem.aggregate({ where: { dossierId: target.id }, _max: { position: true } });
        const start = (last._max.position ?? -1) + 1;
        // A note is about an article of its own dossier: restored elsewhere it keeps only an
        // article restored with it, and is otherwise a plain note.
        const sameDossier = target.id === entry.dossierId;
        const restoredIds = new Set(items.map((item) => item.id));
        const about = (item: StoredItem) =>
          item.aboutItemId && (sameDossier || restoredIds.has(item.aboutItemId)) ? item.aboutItemId : null;
        await tx.dossierItem.createMany({
          data: items.map((item, i) => itemRow(item, target.id, start + i, about(item))),
        });
        // They follow their entries' ids, wherever the entries go back.
        await restoreProposals(tx, userId, proposals);
        await tx.dossier.update({ where: { id: target.id }, data: { updatedAt: new Date() } });
        return { dossierId: target.id };
      }

      if (entry.kind === 'LINGO_CARDS') {
        // `states` and `reviews` are absent from an entry trashed before reviews were kept.
        const { cards, states = [], reviews = [] } = payload as unknown as { cards: StoredCard[]; states?: StoredReviewState[]; reviews?: StoredReview[] };
        await restoreCards(tx, userId, cards, states, reviews);
        return { dossierId: null };
      }

      if (entry.kind === 'LINGO_CORSO') {
        await restoreLingoCorso(tx, userId, payload);
        return { dossierId: null };
      }

      if (entry.kind === 'LINGO_CORSO_MODULO') {
        await restoreLingoCorsoModulo(tx, userId, payload);
        return { dossierId: null };
      }

      throw new AppError(409, 'Questo elemento del cestino non si può ripristinare.');
    });
  } catch (error) {
    // An id taken again since the deletion (restored twice in a race, or re-created).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'Questi elementi sono già stati ripristinati.');
    }
    return quietly('Trash restore', error);
  }
}

/** Empties one trash entry now. */
export async function purgeTrashEntry(userId: string, trashId: string): Promise<void> {
  const { count } = await prisma.trashEntry.deleteMany({ where: { id: trashId, userId } });
  if (count === 0) throw new AppError(404, 'Elemento del cestino non trovato.');
}

// ─── Gymnasium's courses (Percorsi, A1; spec 2026-10-23 §10.9) ───────────────────────────────────────────────

/** A card as the payload keeps it, with its anchors and, for a course's card, its competences. */
type StoredCard = Record<string, unknown> & {
  id: string;
  createdAt: string;
  moduloId?: string | null;
  competenze?: { competenzaId: string }[];
  ancore: (Record<string, unknown> & { id: string; ultimaVerifica: string })[];
};

/** The cards' rows that travel with them: anchors and the competences of a course's card. */
const CARD_PAYLOAD = { ancore: true, competenze: { select: { competenzaId: true } } } satisfies Prisma.LingoCardInclude;

/** The author's review state and log of these cards (the card's deletion would cascade them away). */
async function reviewRows(tx: Prisma.TransactionClient, userId: string, cardIds: string[]) {
  if (cardIds.length === 0) return { states: [], reviews: [] };
  const states = await tx.lingoStatoRipasso.findMany({ where: { cardId: { in: cardIds }, utenteId: userId } });
  const reviews = await tx.lingoRevisioneSRS.findMany({ where: { cardId: { in: cardIds }, utenteId: userId }, orderBy: [{ dataRevisione: 'asc' }, { id: 'asc' }] });
  return { states, reviews };
}

/**
 * Brings cards back with their ids, anchors, review state and log. A course's card keeps its module and
 * competences when its module is still there, and comes back detached otherwise (`moduloId` null, no
 * competences, `daPercorso` kept: still never proposed), never a foreign-key 500.
 */
async function restoreCards(tx: Prisma.TransactionClient, userId: string, cards: StoredCard[], states: StoredReviewState[], reviews: StoredReview[]) {
  const moduleIds = [...new Set(cards.flatMap((card) => (typeof card.moduloId === 'string' ? [card.moduloId] : [])))];
  const liveModules = new Set(
    moduleIds.length === 0
      ? []
      : (await tx.lingoCorsoModulo.findMany({ where: { id: { in: moduleIds }, corso: { autoreId: userId } }, select: { id: true } })).map((m) => m.id),
  );
  const competenceIds = [...new Set(cards.flatMap((card) => (card.competenze ?? []).map((c) => c.competenzaId)))];
  const liveCompetences = new Set(
    competenceIds.length === 0 ? [] : (await tx.lingoCorsoCompetenza.findMany({ where: { id: { in: competenceIds } }, select: { id: true } })).map((c) => c.id),
  );
  for (const card of cards) {
    const { ancore, competenze = [], createdAt, updatedAt: _updatedAt, autoreId: _autoreId, moduloId, ...fields } = card;
    const attached = typeof moduloId === 'string' && liveModules.has(moduloId);
    await tx.lingoCard.create({
      data: {
        ...(fields as unknown as Omit<Prisma.LingoCardUncheckedCreateInput, 'autoreId' | 'createdAt' | 'ancore' | 'moduloId' | 'competenze'>),
        autoreId: userId,
        moduloId: attached ? moduloId : null,
        createdAt: new Date(createdAt),
        ancore: {
          create: ancore.map(({ cardId: _cardId, ultimaVerifica, ...anchor }) => ({
            ...(anchor as unknown as Omit<Prisma.LingoCardAncoraCreateWithoutCardInput, 'ultimaVerifica'>),
            ultimaVerifica: new Date(ultimaVerifica),
          })),
        },
        ...(attached ? { competenze: { create: competenze.filter((c) => liveCompetences.has(c.competenzaId)).map((c) => ({ competenzaId: c.competenzaId })) } } : {}),
      },
    });
  }
  await tx.lingoStatoRipasso.createMany({
    data: states.map((state) => ({
      utenteId: userId,
      cardId: state.cardId,
      stability: state.stability,
      difficulty: state.difficulty,
      dueAt: new Date(state.dueAt),
      lastReviewAt: new Date(state.lastReviewAt),
      reps: state.reps,
      lapses: state.lapses,
    })),
  });
  await tx.lingoRevisioneSRS.createMany({
    data: reviews.map((log) => ({
      id: log.id,
      utenteId: userId,
      cardId: log.cardId,
      dataRevisione: new Date(log.dataRevisione),
      rating: log.rating,
      scheduledDays: log.scheduledDays,
      stability: log.stability,
      difficulty: log.difficulty,
      durataMs: log.durataMs,
    })),
  });
}

/** A module's rows under it: its competences, blocks, items with theirs, and its cards (locked by the caller). */
async function moduleRows(tx: Prisma.TransactionClient, moduleIds: string[], examIds: string[] = []) {
  const moduliCompetenze = await tx.lingoCorsoModuloCompetenza.findMany({ where: { moduloId: { in: moduleIds } } });
  const blocchi = await tx.lingoCorsoBlocco.findMany({ where: { moduloId: { in: moduleIds } }, orderBy: [{ moduloId: 'asc' }, { ordine: 'asc' }] });
  const domande = await tx.lingoCorsoDomanda.findMany({
    where: { OR: [{ moduloId: { in: moduleIds } }, { esameId: { in: examIds } }] },
    orderBy: [{ createdAt: 'asc' }, { ordine: 'asc' }, { id: 'asc' }],
  });
  const domandeCompetenze = await tx.lingoCorsoDomandaCompetenza.findMany({ where: { domandaId: { in: domande.map((d) => d.id) } } });
  const cards = await tx.lingoCard.findMany({ where: { moduloId: { in: moduleIds } }, include: CARD_PAYLOAD, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return { moduliCompetenze, blocchi, domande, domandeCompetenze, cards };
}

/** Locks a course's modules, then their cards, in id order: an edit or a card in flight lands in the payload or after it. */
async function lockModulesAndCards(tx: Prisma.TransactionClient, corsoId: string, moduloId?: string) {
  const modules = moduloId
    ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM lingo_corsi_moduli WHERE id = ${moduloId} AND corso_id = ${corsoId} FOR UPDATE`
    : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM lingo_corsi_moduli WHERE corso_id = ${corsoId} ORDER BY id FOR UPDATE`;
  const ids = modules.map((m) => m.id);
  if (ids.length > 0) await tx.$queryRaw`SELECT id FROM lingo_cards WHERE modulo_id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  return ids;
}

/**
 * Moves a course to the trash (§10.9): the course row `FOR UPDATE`, its modules, its cards in id order; the
 * payload is the content, the enrolments with their states, outcomes and attempts, and the cards with their
 * review state and log; then one delete, the rest by cascade. The XP ledger is never touched, and the study
 * dossier is not in the payload: it stays in Dossier, and the answer names it for the web's toast.
 */
export async function trashLingoCorso(userId: string, corsoId: string, by: DeletedBy): Promise<{ trashId: string; dossier: { id: string; name: string } | null }> {
  await maybeSweep();
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM lingo_corsi WHERE id = ${corsoId} AND autore_id = ${userId} FOR UPDATE`;
    if (locked.length === 0) throw new AppError(404, 'Percorso non trovato.');
    const moduleIds = await lockModulesAndCards(tx, corsoId);
    const corso = await tx.lingoCorso.findUniqueOrThrow({ where: { id: corsoId } });
    const competenze = await tx.lingoCorsoCompetenza.findMany({ where: { corsoId }, orderBy: { ordine: 'asc' } });
    const moduli = await tx.lingoCorsoModulo.findMany({ where: { corsoId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const esami = await tx.lingoCorsoEsame.findMany({ where: { corsoId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const rows = await moduleRows(tx, moduleIds, esami.map((e) => e.id));
    const iscrizioni = await tx.lingoCorsoIscrizione.findMany({ where: { corsoId } });
    const enrolmentIds = iscrizioni.map((i) => i.id);
    const stati = await tx.lingoCorsoModuloStato.findMany({ where: { iscrizioneId: { in: enrolmentIds } } });
    const tentativi = await tx.lingoCorsoTentativo.findMany({ where: { iscrizioneId: { in: enrolmentIds } } });
    const esiti = await tx.lingoCorsoEsito.findMany({ where: { iscrizioneId: { in: enrolmentIds } } });
    const { states, reviews } = await reviewRows(tx, userId, rows.cards.map((c) => c.id));
    const own = iscrizioni.find((i) => i.utenteId === userId);
    const dossier = own?.dossierId ? await tx.dossier.findFirst({ where: { id: own.dossierId, userId }, select: { id: true, name: true } }) : null;
    const now = new Date();
    const entry = await tx.trashEntry.create({
      data: {
        userId,
        kind: 'LINGO_CORSO',
        dossierId: null,
        label: corso.titolo,
        summary: { itemCount: moduli.length, cardCount: rows.cards.length },
        payload: asJson({ corso, competenze, moduli, esami, ...rows, iscrizioni, stati, tentativi, esiti, states, reviews }),
        clientId: by.clientId,
        clientName: by.clientName,
        grantId: by.grantId,
        deletedAt: now,
        expiresAt: expiry(now),
      },
    });
    await tx.lingoCorso.delete({ where: { id: corsoId } });
    return { trashId: entry.id, dossier };
  }).catch((error: unknown) => quietly('Course trash', error));
}

/**
 * Moves a module never opened to the trash (§10.9): its rows and cards, and the ids of the corrections that name
 * it (their link is set null by the delete and comes back on restore). An opened module is frozen: 409, it can
 * only be withdrawn once a correction supersedes it. `moduliPrevisti` never changes with it.
 */
export async function trashLingoCorsoModulo(userId: string, corsoId: string, moduloId: string, by: DeletedBy): Promise<{ trashId: string }> {
  await maybeSweep();
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ titolo: string }[]>`SELECT titolo FROM lingo_corsi WHERE id = ${corsoId} AND autore_id = ${userId} FOR UPDATE`;
    if (locked.length === 0) throw new AppError(404, 'Percorso non trovato.');
    const ids = await lockModulesAndCards(tx, corsoId, moduloId);
    if (ids.length === 0) throw new AppError(404, 'Modulo non trovato.');
    if ((await tx.lingoCorsoModuloStato.count({ where: { moduloId } })) > 0) {
      throw new AppError(409, 'Il modulo è già stato aperto: si può solo ritirare, quando una correzione lo sostituisce.');
    }
    const modulo = await tx.lingoCorsoModulo.findUniqueOrThrow({ where: { id: moduloId } });
    const rows = await moduleRows(tx, [moduloId]);
    const correzioni = (await tx.lingoCorsoModulo.findMany({ where: { sostituisceId: moduloId }, select: { id: true } })).map((m) => m.id);
    const { states, reviews } = await reviewRows(tx, userId, rows.cards.map((c) => c.id));
    const now = new Date();
    const entry = await tx.trashEntry.create({
      data: {
        userId,
        kind: 'LINGO_CORSO_MODULO',
        dossierId: null,
        label: `${modulo.titolo} · ${locked[0].titolo}`,
        summary: { itemCount: 1, cardCount: rows.cards.length },
        payload: asJson({ modulo, ...rows, correzioni, states, reviews }),
        clientId: by.clientId,
        clientName: by.clientName,
        grantId: by.grantId,
        deletedAt: now,
        expiresAt: expiry(now),
      },
    });
    await tx.lingoCorsoModulo.delete({ where: { id: moduloId } });
    return { trashId: entry.id };
  }).catch((error: unknown) => quietly('Course module trash', error));
}

type Row = Record<string, unknown>;
/** A JSON column's value for a write: SQL NULL for null. */
const dbJson = (value: unknown) => (value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue));

interface StoredModuleRows {
  moduliCompetenze: Row[];
  blocchi: Row[];
  domande: Row[];
  domandeCompetenze: Row[];
  cards: StoredCard[];
  states: StoredReviewState[];
  reviews: StoredReview[];
}

/** Writes back modules' blocks, items and competences (the modules themselves exist), then their cards. */
async function restoreModuleRows(tx: Prisma.TransactionClient, userId: string, rows: StoredModuleRows) {
  if (rows.moduliCompetenze.length > 0) await tx.lingoCorsoModuloCompetenza.createMany({ data: rows.moduliCompetenze as unknown as Prisma.LingoCorsoModuloCompetenzaCreateManyInput[] });
  if (rows.blocchi.length > 0) {
    await tx.lingoCorsoBlocco.createMany({ data: rows.blocchi.map((b) => ({ ...b, citazioni: dbJson(b.citazioni) }) as unknown as Prisma.LingoCorsoBloccoCreateManyInput) });
  }
  if (rows.domande.length > 0) {
    await tx.lingoCorsoDomanda.createMany({
      data: rows.domande.map((d) => ({ ...d, opzioni: dbJson(d.opzioni), rubrica: dbJson(d.rubrica) }) as unknown as Prisma.LingoCorsoDomandaCreateManyInput),
    });
  }
  if (rows.domandeCompetenze.length > 0) await tx.lingoCorsoDomandaCompetenza.createMany({ data: rows.domandeCompetenze as unknown as Prisma.LingoCorsoDomandaCompetenzaCreateManyInput[] });
  await restoreCards(tx, userId, rows.cards, rows.states, rows.reviews);
}

/** A course's restore (inside `restoreTrashEntry`): every row with its id, the dossier linked again if still the user's. */
async function restoreLingoCorso(tx: Prisma.TransactionClient, userId: string, payload: Prisma.JsonValue) {
  const p = payload as unknown as StoredModuleRows & {
    corso: Row & { id: string };
    competenze: Row[];
    moduli: (Row & { id: string; sostituisceId: string | null })[];
    esami: Row[];
    iscrizioni: (Row & { id: string; dossierId: string | null; utenteId: string })[];
    stati: Row[];
    tentativi: Row[];
    esiti: Row[];
  };
  // The limits hold on the way back too: the user may have written others meanwhile.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('lingo_corsi:' || ${userId}::text))`;
  if ((await tx.lingoCorso.count({ where: { autoreId: userId } })) >= LIMITS.coursesPerUser) {
    throw new AppError(409, `Hai già ${LIMITS.coursesPerUser} percorsi: eliminane uno prima di ripristinare questo.`);
  }
  await tx.lingoCorso.create({ data: { ...(p.corso as unknown as Prisma.LingoCorsoUncheckedCreateInput), autoreId: userId } });
  if (p.competenze.length > 0) await tx.lingoCorsoCompetenza.createMany({ data: p.competenze as unknown as Prisma.LingoCorsoCompetenzaCreateManyInput[] });
  // The corrections' links in a second step, so that the order of the rows never matters.
  if (p.moduli.length > 0) {
    await tx.lingoCorsoModulo.createMany({
      data: p.moduli.map((m) => ({ ...m, sostituisceId: null }) as unknown as Prisma.LingoCorsoModuloCreateManyInput),
    });
    for (const m of p.moduli.filter((m) => m.sostituisceId)) await tx.lingoCorsoModulo.update({ where: { id: m.id }, data: { sostituisceId: m.sostituisceId } });
  }
  // The enrolments before the exams written for one of them; a dossier only when it is still the user's.
  const dossierIds = [...new Set(p.iscrizioni.flatMap((i) => (i.dossierId ? [i.dossierId] : [])))];
  const ownDossiers = new Set(
    dossierIds.length === 0 ? [] : (await tx.dossier.findMany({ where: { id: { in: dossierIds }, userId }, select: { id: true } })).map((d) => d.id),
  );
  const enrolments = p.iscrizioni.filter((i) => i.utenteId === userId);
  if (enrolments.length > 0) {
    await tx.lingoCorsoIscrizione.createMany({
      data: enrolments.map((i) => ({ ...i, dossierId: i.dossierId && ownDossiers.has(i.dossierId) ? i.dossierId : null }) as unknown as Prisma.LingoCorsoIscrizioneCreateManyInput),
    });
  }
  if (p.esami.length > 0) await tx.lingoCorsoEsame.createMany({ data: p.esami as unknown as Prisma.LingoCorsoEsameCreateManyInput[] });
  await restoreModuleRows(tx, userId, p);
  if (p.stati.length > 0) await tx.lingoCorsoModuloStato.createMany({ data: p.stati as unknown as Prisma.LingoCorsoModuloStatoCreateManyInput[] });
  if (p.tentativi.length > 0) {
    await tx.lingoCorsoTentativo.createMany({ data: p.tentativi.map((t) => ({ ...t, perCompetenza: dbJson(t.perCompetenza) }) as unknown as Prisma.LingoCorsoTentativoCreateManyInput) });
  }
  if (p.esiti.length > 0) await tx.lingoCorsoEsito.createMany({ data: p.esiti as unknown as Prisma.LingoCorsoEsitoCreateManyInput[] });
}

/** A module's restore: into its course if still there (404 otherwise), its corrections linked again. */
async function restoreLingoCorsoModulo(tx: Prisma.TransactionClient, userId: string, payload: Prisma.JsonValue) {
  const p = payload as unknown as StoredModuleRows & { modulo: Row & { id: string; corsoId: string; sostituisceId: string | null }; correzioni: string[] };
  // Locked as a module's addition locks it: the limits below cannot be passed by a module added at the same time.
  const course = await tx.$queryRaw<{ moduli_previsti: number }[]>`
    SELECT moduli_previsti FROM lingo_corsi WHERE id = ${p.modulo.corsoId} AND autore_id = ${userId} FOR NO KEY UPDATE`;
  if (course.length === 0) throw new AppError(404, 'Il percorso di questo modulo non c’è più.');
  const modules = await tx.lingoCorsoModulo.findMany({ where: { corsoId: p.modulo.corsoId }, select: { id: true, sostituisceId: true } });
  const withdrawn = await tx.lingoCorsoModuloStato.findMany({
    where: { moduloId: { in: modules.map((m) => m.id) }, ritiratoIl: { not: null }, iscrizione: { utenteId: userId } },
    select: { moduloId: true },
  });
  const counting = countingModules([...modules, { id: p.modulo.id, sostituisceId: p.modulo.sostituisceId }], new Set(withdrawn.map((w) => w.moduloId))).length;
  if (modules.length + 1 > LIMITS.moduleRows || counting > Math.min(LIMITS.liveModules, course[0].moduli_previsti)) {
    throw new AppError(409, 'Il percorso ha già tutti i suoi moduli: abbassa il programma o elimina un modulo prima di ripristinare questo.');
  }
  const corrected = p.modulo.sostituisceId
    ? await tx.lingoCorsoModulo.count({ where: { id: p.modulo.sostituisceId, corsoId: p.modulo.corsoId } })
    : 0;
  await tx.lingoCorsoModulo.create({
    data: {
      ...(p.modulo as unknown as Prisma.LingoCorsoModuloUncheckedCreateInput),
      domandePrima: p.modulo.domandePrima as Prisma.InputJsonValue,
      sostituisceId: corrected > 0 ? p.modulo.sostituisceId : null,
    },
  });
  await restoreModuleRows(tx, userId, p);
  if (p.correzioni.length > 0) {
    await tx.lingoCorsoModulo.updateMany({ where: { id: { in: p.correzioni }, corsoId: p.modulo.corsoId, sostituisceId: null }, data: { sostituisceId: p.modulo.id } });
  }
}
