import { Request, Response } from 'express';
import { Prisma, DossierItemType } from '@prisma/client';
import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import { resolveReferences } from '../norms/resolveReference';
import { citeStoredNorm } from '../norms/citation';

/** Who created a row: the connected application when the request is delegated, else nobody (the user). */
export function provenanceFromRequest(req: Request) {
  return req.delegation
    ? { createdByClientId: req.delegation.clientId, createdByClientName: req.delegation.clientName }
    : { createdByClientId: null, createdByClientName: null };
}

/** The mark the API shows: the connection that created the row, or null for the user's own. */
const createdBy = (row: { createdByClientId: string | null; createdByClientName: string | null }) =>
  row.createdByClientId ? { clientName: row.createdByClientName } : null;

type ItemRow = Prisma.DossierItemGetPayload<object>;

/** A dossier entry as every route answers it. */
function serializeItem(i: ItemRow) {
  return {
    id: i.id,
    item_type: i.itemType,
    title: i.title,
    // How a lawyer cites the norm ("art. 3, l. 31 dicembre 2012, n. 247"); null for anything else.
    citation: citeStoredNorm(i.itemType, i.content),
    content: i.content,
    position: i.position,
    status: i.status,
    created_at: i.createdAt,
    created_by: createdBy(i),
    // The entry a note is about (an article of the same dossier), or null.
    about_item_id: i.aboutItemId,
  };
}

/** A dossier as every route answers it. */
function serializeDossier(d: Prisma.DossierGetPayload<object> & { items: ItemRow[] }) {
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    color: d.color,
    tags: d.tags,
    is_pinned: d.isPinned,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
    created_by: createdBy(d),
    items: d.items.map(serializeItem),
  };
}

// Validation schemas
const createDossierSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  color: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const updateDossierSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  isPinned: z.boolean().optional(),
});

const createDossierItemSchema = z.object({
  itemType: z.enum(['norm', 'note', 'section']),
  title: z.string().min(1),
  content: z.any().optional(),
  position: z.number().optional(),
  status: z.enum(['unread', 'reading', 'important', 'done']).optional(),
});

const updateDossierItemSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.any().optional(),
  position: z.number().optional(),
  status: z.enum(['unread', 'reading', 'important', 'done']).optional(),
});

const moveDossierItemSchema = z.object({
  targetDossierId: z.string().min(1),
});

/**
 * List all dossiers for current user
 */
export const listDossiers = async (req: Request, res: Response) => {
  const dossiers = await prisma.dossier.findMany({
    where: { userId: req.user!.id },
    include: {
      items: {
        orderBy: { position: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json(dossiers.map(serializeDossier));
};

/**
 * Get single dossier by ID
 */
export const getDossier = async (req: Request, res: Response) => {
  const { id } = req.params;

  const dossier = await prisma.dossier.findFirst({
    where: { id, userId: req.user!.id },
    include: {
      items: {
        orderBy: { position: 'asc' },
      },
    },
  });

  if (!dossier) {
    throw new AppError(404, 'Dossier not found');
  }

  res.json(serializeDossier(dossier));
};

/**
 * Create new dossier
 */
export const createDossier = async (req: Request, res: Response) => {
  const data = createDossierSchema.parse(req.body);

  const dossier = await prisma.dossier.create({
    data: {
      name: data.name,
      description: data.description,
      color: data.color,
      tags: data.tags ?? [],
      userId: req.user!.id,
      ...provenanceFromRequest(req),
    },
    include: {
      items: true,
    },
  });

  res.status(201).json(serializeDossier(dossier));
};

/**
 * Update dossier
 */
export const updateDossier = async (req: Request, res: Response) => {
  const { id } = req.params;
  const data = updateDossierSchema.parse(req.body);

  // Check ownership
  const existing = await prisma.dossier.findFirst({
    where: { id, userId: req.user!.id },
  });

  if (!existing) {
    throw new AppError(404, 'Dossier not found');
  }

  const dossier = await prisma.dossier.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.color !== undefined && { color: data.color }),
      ...(data.tags !== undefined && { tags: data.tags }),
      ...(data.isPinned !== undefined && { isPinned: data.isPinned }),
    },
    include: {
      items: {
        orderBy: { position: 'asc' },
      },
    },
  });

  res.json(serializeDossier(dossier));
};

/**
 * Delete dossier
 */
export const deleteDossier = async (req: Request, res: Response) => {
  const { id } = req.params;

  // Check ownership
  const existing = await prisma.dossier.findFirst({
    where: { id, userId: req.user!.id },
  });

  if (!existing) {
    throw new AppError(404, 'Dossier not found');
  }

  await prisma.dossier.delete({
    where: { id },
  });

  res.status(204).send();
};

/**
 * Add item to dossier
 */
export const addDossierItem = async (req: Request, res: Response) => {
  const { id } = req.params;
  const data = createDossierItemSchema.parse(req.body);

  // Check ownership
  const dossier = await prisma.dossier.findFirst({
    where: { id, userId: req.user!.id },
  });

  if (!dossier) {
    throw new AppError(404, 'Dossier not found');
  }

  // Get max position
  const maxPos = await prisma.dossierItem.aggregate({
    where: { dossierId: id },
    _max: { position: true },
  });

  const item = await prisma.dossierItem.create({
    data: {
      dossierId: id,
      itemType: data.itemType as DossierItemType,
      title: data.title,
      content: data.content || null,
      position: data.position ?? (maxPos._max.position ?? -1) + 1,
      ...(data.status !== undefined && { status: data.status }),
      ...provenanceFromRequest(req),
    },
  });

  res.status(201).json(serializeItem(item));
};

export const MAX_NOTE_LENGTH = 4000;
// Plain text: new lines and tabs, nothing else below U+0020.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const noteSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1)
      .max(MAX_NOTE_LENGTH)
      .refine((text) => !CONTROL.test(text), 'Caratteri di controllo non ammessi.'),
    aboutItemId: z.string().uuid().optional(),
  })
  .strict();

/**
 * A note in a dossier, or about one of its articles as a whole (MCP second
 * round, spec §5): never about a passage of the article's text, whose anchors
 * need exact offsets (root rule 23). Open to the user's session and to an
 * exchanged token; through one, the note carries the connection's mark.
 */
export const addDossierNote = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { text, aboutItemId } = noteSchema.parse(req.body);

  const dossier = await prisma.dossier.findFirst({ where: { id, userId: req.user!.id } });
  if (!dossier) throw new AppError(404, 'Dossier not found');

  if (aboutItemId) {
    const article = await prisma.dossierItem.findFirst({ where: { id: aboutItemId, dossierId: id, itemType: 'norm' } });
    if (!article) throw new AppError(400, 'La voce indicata non è un articolo di questo dossier.');
  }

  const item = await prisma.$transaction(async (tx) => {
    const last = await tx.dossierItem.aggregate({ where: { dossierId: id }, _max: { position: true } });
    return tx.dossierItem.create({
      data: {
        dossierId: id,
        itemType: 'note',
        // As the web app titles a note it adds (`addToDossier`).
        title: 'Nota',
        content: text,
        position: (last._max.position ?? -1) + 1,
        aboutItemId: aboutItemId ?? null,
        ...provenanceFromRequest(req),
      },
    });
  });

  res.status(201).json(serializeItem(item));
};

/**
 * Update dossier item
 */
export const updateDossierItem = async (req: Request, res: Response) => {
  const { id, itemId } = req.params;
  const data = updateDossierItemSchema.parse(req.body);

  // Check ownership
  const dossier = await prisma.dossier.findFirst({
    where: { id, userId: req.user!.id },
  });

  if (!dossier) {
    throw new AppError(404, 'Dossier not found');
  }

  let item;
  try {
    item = await prisma.dossierItem.update({
      // Scoped by dossierId: the ownership check above proves the dossier is
      // ours, not that the item belongs to it. Without this an authenticated
      // user could pass their own dossier id together with someone else's
      // item id and mutate a row they do not own.
      where: { id: itemId, dossierId: id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.content !== undefined && { content: data.content }),
        ...(data.position !== undefined && { position: data.position }),
        ...(data.status !== undefined && { status: data.status }),
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new AppError(404, 'Dossier item not found');
    }
    throw err;
  }

  res.json(serializeItem(item));
};

/**
 * Delete dossier item
 */
export const deleteDossierItem = async (req: Request, res: Response) => {
  const { id, itemId } = req.params;

  // Check ownership
  const dossier = await prisma.dossier.findFirst({
    where: { id, userId: req.user!.id },
  });

  if (!dossier) {
    throw new AppError(404, 'Dossier not found');
  }

  try {
    await prisma.dossierItem.delete({
      where: { id: itemId, dossierId: id },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new AppError(404, 'Dossier item not found');
    }
    throw err;
  }

  res.status(204).send();
};

/**
 * Move a dossier item to another dossier of the same user
 *
 * The row itself is moved — only `dossier_id` and `position` change — so its
 * id, its `created_at` and its content survive. The client used to re-create
 * the item on the target and delete it from the source: the new row came back
 * unstarred (the star lives in the `_dossierMeta` envelope inside `content`),
 * its fresh id made the next star or delete 404 against the target dossier,
 * its added-at date became the move date, and a failed delete left the item in
 * both dossiers.
 */
export const moveDossierItem = async (req: Request, res: Response) => {
  const { id, itemId } = req.params;
  const { targetDossierId } = moveDossierItemSchema.parse(req.body ?? {});

  // BOTH dossiers must belong to the caller: the URL proves the source is ours
  // (as in the other item handlers), but the target comes from the body, so it
  // needs the same check or an authenticated user could file an item into — or
  // pull one out of — a dossier they do not own.
  const [source, target] = await Promise.all([
    prisma.dossier.findFirst({ where: { id, userId: req.user!.id }, select: { id: true } }),
    prisma.dossier.findFirst({ where: { id: targetDossierId, userId: req.user!.id }, select: { id: true } }),
  ]);

  if (!source || !target) {
    throw new AppError(404, 'Dossier not found');
  }

  if (source.id === target.id) {
    throw new AppError(400, 'Item is already in that dossier');
  }

  try {
    const item = await prisma.$transaction(async (tx) => {
      // Read the append slot in the same transaction as the write. Under
      // Postgres' default isolation two moves arriving together can still read
      // the same max and claim the same position — the client sends one move at
      // a time, and two items sharing a position only swaps their order until
      // the next reorder rewrites every position, so no lock is taken for it.
      const maxPos = await tx.dossierItem.aggregate({
        where: { dossierId: target.id },
        _max: { position: true },
      });

      return tx.dossierItem.update({
        // Scoped by dossierId: the ownership check above proves the source
        // dossier is ours, not that the item belongs to it.
        where: { id: itemId, dossierId: source.id },
        data: {
          dossierId: target.id,
          position: (maxPos._max.position ?? -1) + 1,
        },
      });
    });

    res.json(serializeItem(item));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new AppError(404, 'Dossier item not found');
    }
    throw err;
  }
};

/**
 * Reorder dossier items
 */
const createSnapshotSchema = z.object({
  label: z.string().trim().max(200).nullish(),
});

export const createDossierSnapshot = async (req: Request, res: Response) => {
  const { label } = createSnapshotSchema.parse(req.body ?? {});
  const dossier = await prisma.dossier.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    include: { items: { orderBy: { position: 'asc' } } },
  });
  if (!dossier) throw new AppError(404, 'Dossier not found');

  const last = await prisma.dossierSnapshot.findFirst({ where: { dossierId: dossier.id }, orderBy: { version: 'desc' } });
  const content = {
    dossier: { name: dossier.name, description: dossier.description, tags: dossier.tags },
    items: dossier.items.map(item => ({ id: item.id, itemType: item.itemType, title: item.title, content: item.content, position: item.position })),
  };
  const fingerprint = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  if (last?.fingerprint === fingerprint) {
    res.json({ id: last.id, version: last.version, createdAt: last.createdAt, fingerprint, unchanged: true });
    return;
  }
  const snapshot = await prisma.dossierSnapshot.create({
    data: { dossierId: dossier.id, version: (last?.version ?? 0) + 1, content, fingerprint, label: label || null },
  });
  res.status(201).json({ id: snapshot.id, version: snapshot.version, label: snapshot.label, createdAt: snapshot.createdAt, fingerprint: snapshot.fingerprint, unchanged: false });
};

export const listDossierSnapshots = async (req: Request, res: Response) => {
  const dossier = await prisma.dossier.findFirst({ where: { id: req.params.id, userId: req.user!.id }, select: { id: true } });
  if (!dossier) throw new AppError(404, 'Dossier not found');
  const snapshots = await prisma.dossierSnapshot.findMany({ where: { dossierId: dossier.id }, orderBy: { version: 'desc' }, take: 50 });
  res.json(snapshots);
};

export const reorderDossierItems = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { itemIds } = req.body as { itemIds: string[] };

  if (!Array.isArray(itemIds)) {
    throw new AppError(400, 'itemIds must be an array');
  }

  // Check ownership
  const dossier = await prisma.dossier.findFirst({
    where: { id, userId: req.user!.id },
  });

  if (!dossier) {
    throw new AppError(404, 'Dossier not found');
  }

  // Update positions
  try {
    await prisma.$transaction(
      itemIds.map((itemId, index) =>
        prisma.dossierItem.update({
          where: { id: itemId, dossierId: id },
          data: { position: index },
        })
      )
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new AppError(404, 'Dossier item not found');
    }
    throw err;
  }

  res.json({ message: 'Items reordered successfully' });
};

export const MAX_REFERENCES_PER_CALL = 50;

const addNormsSchema = z.object({
  references: z.array(z.string().trim().min(1).max(200)).min(1).max(MAX_REFERENCES_PER_CALL),
}).strict();

type NormOutcome = 'added' | 'already_present' | 'not_recognised' | 'does_not_exist' | 'ambiguous' | 'unavailable';

/**
 * Adds norms to a dossier from references in free text ("art. 2043 c.c."),
 * 1 to 50 per call (MCP spike, spec section 7). Each reference is resolved
 * and checked for existence by the Python API (`norms/resolveReference.ts`);
 * one that is not recognised, ambiguous, missing or unverifiable is reported
 * and does not stop the others. The resolved ones are created in one
 * transaction as `norm` items whose content is the norm as the reader stores
 * it, after the dossier's last item; an article already in the dossier (or
 * twice in the call) is added once. Nothing is updated, moved or deleted.
 */
export const addDossierNorms = async (req: Request, res: Response) => {
  const { references } = addNormsSchema.parse(req.body);
  const dossier = await prisma.dossier.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    include: { items: { where: { itemType: 'norm' }, select: { content: true } } },
  });
  if (!dossier) throw new AppError(404, 'Dossier not found');

  const resolutions = await resolveReferences(references);
  const present = new Set(
    dossier.items
      .map((item) => (item.content && typeof item.content === 'object' ? (item.content as { urn?: unknown }).urn : undefined))
      .filter((urn): urn is string => typeof urn === 'string'),
  );

  const toCreate: { index: number; urn: string }[] = [];
  type NormResult = { reference: string; outcome: NormOutcome; display?: string; detail?: string; itemId?: string };
  const results: NormResult[] =
    resolutions.map((resolution, index): NormResult => {
      const base = { reference: references[index], display: resolution.display, detail: resolution.detail };
      if (resolution.outcome !== 'resolved' || !resolution.norm) {
        // `resolved` without a norm cannot happen; reported as unavailable rather than added.
        return { ...base, outcome: resolution.outcome === 'resolved' ? 'unavailable' : resolution.outcome };
      }
      if (present.has(resolution.norm.urn)) return { ...base, outcome: 'already_present' as const, detail: undefined };
      present.add(resolution.norm.urn);
      toCreate.push({ index, urn: resolution.norm.urn });
      return { ...base, outcome: 'added' as const };
    });

  if (toCreate.length > 0) {
    const created = await prisma.$transaction(async (tx) => {
      const last = await tx.dossierItem.aggregate({ where: { dossierId: dossier.id }, _max: { position: true } });
      let position = (last._max.position ?? -1) + 1;
      const rows = [];
      for (const { index } of toCreate) {
        const norm = resolutions[index].norm!;
        rows.push(
          await tx.dossierItem.create({
            data: {
              dossierId: dossier.id,
              itemType: 'norm',
              // As the web app titles a norm it adds (`addToDossier`).
              title: norm.tipo_atto,
              content: norm as unknown as Prisma.InputJsonValue,
              position: position++,
              ...provenanceFromRequest(req),
            },
          }),
        );
      }
      await tx.dossier.update({ where: { id: dossier.id }, data: { updatedAt: new Date() } });
      return rows;
    });
    toCreate.forEach(({ index }, i) => {
      results[index].itemId = created[i].id;
    });
  }

  // Under an exchanged token each reference is charged two points; one the
  // sources could not check is handed back (middleware/delegated.ts).
  res.locals.delegatedRefund = results.filter((r) => r.outcome === 'unavailable').length * 2;
  res.json({ results });
};
