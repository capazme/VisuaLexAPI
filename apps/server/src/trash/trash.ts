import { Prisma, type TrashKind } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { citeStoredAct, citeStoredNorm } from '../norms/citation';

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
  citation: citeStoredNorm(item.itemType, item.content),
  actCitation: citeStoredAct(item.itemType, item.content),
});

const expiry = (from: Date) => new Date(from.getTime() + TRASH_RETENTION_MS);

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

/** Moves a whole dossier, with its entries and snapshots, to the trash. */
export async function trashDossier(userId: string, dossierId: string, by: DeletedBy): Promise<{ trashId: string; itemCount: number }> {
  await maybeSweep();
  return prisma.$transaction(async (tx) => {
    const dossier = await tx.dossier.findFirst({
      where: { id: dossierId, userId },
      include: { items: { orderBy: { position: 'asc' } }, snapshots: { orderBy: { version: 'asc' } } },
    });
    if (!dossier) throw new AppError(404, 'Dossier not found');
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
    await tx.dossierItem.deleteMany({ where: { id: { in: moved }, dossierId } });
    await tx.dossier.update({ where: { id: dossierId }, data: { updatedAt: now } });
    return { trashId: entry.id, moved, notFound: wanted.filter((id) => !moved.includes(id)) };
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
        // A note is about an article of its own dossier: restored elsewhere, it is a plain note.
        const sameDossier = target.id === entry.dossierId;
        await tx.dossierItem.createMany({
          data: items.map((item, i) => itemRow(item, target.id, start + i, sameDossier ? item.aboutItemId : null)),
        });
        await tx.dossier.update({ where: { id: target.id }, data: { updatedAt: new Date() } });
        await tx.trashEntry.delete({ where: { id: entry.id } });
        return { dossierId: target.id };
      }

      throw new AppError(409, 'Questo elemento del cestino non si può ancora ripristinare.');
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
