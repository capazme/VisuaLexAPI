import { Prisma, type TrashKind } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { citeStoredAct } from '../norms/citation';
import { citeStoredItem } from '../norms/decisionCitation';
import { PERSONAL_STATES } from '../lingo/deleteUserAccount';

/**
 * The trash (MCP second round, spec §4.3): what a connected application
 * deletes is copied here, as the rows were, and then deleted, in one
 * transaction. The user restores it from the web app for 30 days; then the
 * sweep removes it for good. Only the user's session lists, restores or
 * empties it: none of those routes is in the delegated table.
 */

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 10 * 60 * 1000;

/** Which connection deleted: the trash outlives the client and the grant, so plain values. */
export interface DeletedBy {
  clientId: string;
  clientName: string | null;
  grantId: string;
}

export interface TrashListEntry {
  id: string;
  kind: TrashKind;
  dossierId: string | null;
  label: string;
  itemCount: number;
  items?: { itemType: string; citation: string | null; actCitation: string | null }[];
  cards?: { istituto: string; domanda: string }[];
  clientName: string | null;
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
 * Moves a whole dossier, with its entries and snapshots, to the trash — only
 * if it still holds exactly the entries the user was shown when confirming
 * (`seenItemIds`): one added or removed meanwhile refuses the move (409).
 */
export async function trashDossier(
  userId: string,
  dossierId: string,
  seenItemIds: string[],
  by: DeletedBy,
): Promise<{ trashId: string; itemCount: number }> {
  await maybeSweep();
  return prisma.$transaction(async (tx) => {
    if (!(await lockDossier(tx, userId, dossierId))) throw new AppError(404, 'Dossier not found');
    const dossier = await tx.dossier.findFirst({
      where: { id: dossierId, userId },
      include: { items: { orderBy: { position: 'asc' } }, snapshots: { orderBy: { version: 'asc' } } },
    });
    if (!dossier) throw new AppError(404, 'Dossier not found');
    const seen = new Set(seenItemIds);
    if (seen.size !== dossier.items.length || dossier.items.some((item) => !seen.has(item.id))) {
      throw new AppError(409, 'Il dossier è cambiato dopo la conferma: nulla è stato eliminato.');
    }
    const { items, snapshots, ...row } = dossier;
    const now = new Date();
    const entry = await tx.trashEntry.create({
      data: {
        userId,
        kind: 'DOSSIER',
        dossierId: dossier.id,
        label: dossier.name,
        summary: { itemCount: items.length },
        payload: asJson({ dossier: row, items, snapshots }),
        clientId: by.clientId,
        clientName: by.clientName,
        grantId: by.grantId,
        deletedAt: now,
        expiresAt: expiry(now),
      },
    });
    // Items and snapshots cascade with the dossier.
    await tx.dossier.delete({ where: { id: dossier.id } });
    return { trashId: entry.id, itemCount: items.length };
  });
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
    const items = await tx.dossierItem.findMany({ where: { id: { in: wanted }, dossierId }, orderBy: { position: 'asc' } });
    if (items.length === 0) throw new AppError(404, 'Nessuna delle voci indicate è in questo dossier.');
    const moved = items.map((item) => item.id);
    const now = new Date();
    const entry = await tx.trashEntry.create({
      data: {
        userId,
        kind: 'DOSSIER_ITEMS',
        dossierId,
        label: dossier.name,
        summary: asJson({ itemCount: items.length, items: items.map(itemSummary) }),
        payload: asJson({ items }),
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
    await tx.dossier.update({ where: { id: dossierId }, data: { updatedAt: now } });
    return { trashId: entry.id, moved, notFound: wanted.filter((id) => !moved.includes(id)) };
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
    const cards = await tx.lingoCard.findMany({ where: { id: { in: wanted }, autoreId: userId }, include: { ancore: true }, orderBy: { createdAt: 'asc' } });
    const movable = cards.filter((card) => PERSONAL_STATES.includes(card.stato));
    const moved = movable.map((card) => card.id);
    const notFound = wanted.filter((id) => !cards.some((card) => card.id === id));
    const notDeletable = cards.filter((card) => !PERSONAL_STATES.includes(card.stato)).map((card) => card.id);
    if (movable.length === 0) return { moved, notFound, notDeletable };
    const now = new Date();
    const entry = await tx.trashEntry.create({
      data: {
        userId,
        kind: 'LINGO_CARDS',
        dossierId: null,
        label: 'Schede LingoLex',
        summary: asJson({
          itemCount: movable.length,
          cards: movable.map((card) => ({ istituto: card.istituto, domanda: card.domanda.length > 120 ? `${card.domanda.slice(0, 119)}…` : card.domanda })),
        }),
        payload: asJson({ cards: movable }),
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
    const summary = entry.summary as { itemCount?: number; items?: ItemSummary[]; cards?: { istituto: string; domanda: string }[] };
    return {
      id: entry.id,
      kind: entry.kind,
      dossierId: entry.dossierId,
      label: entry.label,
      itemCount: summary.itemCount ?? 0,
      ...(summary.items ? { items: summary.items } : {}),
      ...(summary.cards ? { cards: summary.cards } : {}),
      clientName: entry.clientName,
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
};

/** The id when its row still exists, else null (a foreign key to a deleted row would fail the restore). */
async function existingId(value: unknown, count: (id: string) => Promise<number>): Promise<string | null> {
  if (typeof value !== 'string' || !value) return null;
  return (await count(value)) > 0 ? value : null;
}

const jsonOrNull = (value: unknown) => (value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue));

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

      if (entry.kind === 'DOSSIER') {
        const { dossier, items, snapshots } = entry.payload as unknown as {
          dossier: Record<string, unknown> & { id: string; createdAt: string; updatedAt: string };
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
        await tx.trashEntry.delete({ where: { id: entry.id } });
        return { dossierId: dossier.id };
      }

      if (entry.kind === 'DOSSIER_ITEMS') {
        const { items } = entry.payload as unknown as { items: StoredItem[] };
        const targetId = targetDossierId ?? entry.dossierId;
        const target = targetId ? await tx.dossier.findFirst({ where: { id: targetId, userId } }) : null;
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
        await tx.dossier.update({ where: { id: target.id }, data: { updatedAt: new Date() } });
        await tx.trashEntry.delete({ where: { id: entry.id } });
        return { dossierId: target.id };
      }

      if (entry.kind === 'LINGO_CARDS') {
        const { cards } = entry.payload as unknown as {
          cards: (Record<string, unknown> & { id: string; createdAt: string; ancore: (Record<string, unknown> & { id: string; ultimaVerifica: string })[] })[];
        };
        for (const card of cards) {
          const { ancore, createdAt, updatedAt: _updatedAt, autoreId: _autoreId, ...fields } = card;
          await tx.lingoCard.create({
            data: {
              ...(fields as unknown as Omit<Prisma.LingoCardUncheckedCreateInput, 'autoreId' | 'createdAt' | 'ancore'>),
              autoreId: userId,
              createdAt: new Date(createdAt),
              ancore: {
                create: ancore.map(({ cardId: _cardId, ultimaVerifica, ...anchor }) => ({
                  ...(anchor as unknown as Omit<Prisma.LingoCardAncoraCreateWithoutCardInput, 'ultimaVerifica'>),
                  ultimaVerifica: new Date(ultimaVerifica),
                })),
              },
            },
          });
        }
        await tx.trashEntry.delete({ where: { id: entry.id } });
        return { dossierId: null };
      }

      throw new AppError(409, 'Questo elemento del cestino non si può ripristinare.');
    });
  } catch (error) {
    // An id taken again since the deletion (restored twice in a race, or re-created).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'Questi elementi sono già stati ripristinati.');
    }
    throw error;
  }
}

/** Empties one trash entry now. */
export async function purgeTrashEntry(userId: string, trashId: string): Promise<void> {
  const { count } = await prisma.trashEntry.deleteMany({ where: { id: trashId, userId } });
  if (count === 0) throw new AppError(404, 'Elemento del cestino non trovato.');
}
