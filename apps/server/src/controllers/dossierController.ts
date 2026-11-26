import { Request, Response } from 'express';
import { Prisma, DossierItemType } from '../lib/db';
import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import { boundedTags, boundedText, parseBody } from '../utils/bodyLimits';
import { atMostUnits } from '../utils/utf16Length';
import { ZodError } from 'zod';
import { AppError, validationDetail } from '../middleware/errorHandler';
import { chargeWrites } from '../middleware/rateLimiter';
import { assertDossierRoom, formatThousands, itemRoom, MAX_ITEMS_PER_DOSSIER } from '../utils/dossierCaps';
import { resolveReferences } from '../norms/resolveReference';
import { decisionKeyOf, resolveDecisionReferences, type DecisionOutcome } from '../norms/resolveDecisions';
import { citeStoredAct } from '../norms/citation';
import { citeDecision, citeStoredItem } from '../norms/decisionCitation';
import { decisionItemContentSchema, parseDecisionItemContent } from '../schemas/decisionItem';
import { isRecitalContent, rebuildRecitalEntry } from '../schemas/recitalEntry';
import { citeRecital } from '../norms/recital';
import { BY_THE_USER, trashDossier, trashDossierItems } from '../trash/trash';
import { importStudyDossiers, spendStudyImport } from '../services/studyImport';
import { readableContent } from '../utils/publishedContent';
import { assistantFieldsOf, assistantViewFor, type AssistantView } from '../assistant/notes';
import { partOf } from '../norms/parts';

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

/**
 * Whether a note's text stays out of this answer (G-381 (b)): for a connected application whose token lacks
 * `dossier:text`, or whose grant was approved before the words of that permission named the notes. The server is
 * the gate; `apps/mcp` filters too.
 */
const hidesNoteText = (req: Request): boolean => Boolean(req.delegation && !req.delegation.readsNotes);

/**
 * Whether a norm entry's content is cut to its identity in this answer: for a connected application whose token or
 * grant lacks `dossier:text`. The consent page promises «il testo delle norme» only with that permission, and the web
 * stores the article's text with the entry (`article_text`). The citation is computed from the whole content first,
 * so it stays. The server is the gate, as for the notes; the MCP never reads a norm's content anyway.
 */
const hidesNormText = (req: Request): boolean => Boolean(req.delegation && !req.delegation.readsTexts);

/** A norm entry's identity, as `schemas/normEntry.ts` reads it: nothing else. */
const NORM_IDENTITY_KEYS = [
  'tipo_atto', 'tipo_atto_reale', 'numero_atto', 'data', 'numero_articolo', 'allegato', 'versione', 'data_versione',
  'parte', 'url', 'urn',
] as const;

type JsonObject = Record<string, Prisma.JsonValue | undefined>;
const isObject = (value: unknown): value is JsonObject =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function identityOf(norm: JsonObject): Record<string, Prisma.JsonValue> {
  const kept: Record<string, Prisma.JsonValue> = {};
  for (const key of NORM_IDENTITY_KEYS) {
    const value = norm[key];
    if (value !== undefined) kept[key] = value;
  }
  return kept;
}

/**
 * A norm entry's content without its text: the identity, the older Forum shape's `articleRef` cut the same way, and the
 * dossier's «important» mark rebuilt rather than copied. Anything that is not an object gives nothing: a gate that does
 * not recognise what it holds lets none of it through.
 */
function normContentWithoutText(content: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (!isObject(content)) return null;
  const kept = identityOf(content);
  if (isObject(content.articleRef)) kept.articleRef = identityOf(content.articleRef);
  if (isObject(content._dossierMeta) && content._dossierMeta.important === true) kept._dossierMeta = { important: true };
  return kept;
}

/**
 * A dossier entry as every route answers it. `view` carries the assistant's notes for the user's session
 * (`assistantViewFor`): without it (an exchanged token, the switch off) both fields are null. `hideNotes` drops a
 * note's content (null), never a norm's or a decision's identity.
 */
function serializeItem(i: ItemRow, view: AssistantView | null, hideNotes = false, hideNormText = false) {
  return {
    id: i.id,
    item_type: i.itemType,
    title: i.title,
    // How a lawyer cites the norm ("art. 3, l. 31 dicembre 2012, n. 247") or the decision
    // ("Cass. civ., sez. un., sent. 6 dicembre 2024, n. 31310"); null for anything else.
    citation: citeStoredItem(i.itemType, i.content),
    // The act alone ("l. 31 dicembre 2012, n. 247"), for a reader that names an act once above its articles.
    act_citation: citeStoredAct(i.itemType, i.content),
    content: hideNotes && i.itemType === 'note' ? null : hideNormText && i.itemType === 'norm' ? normContentWithoutText(i.content) : i.content,
    position: i.position,
    status: i.status,
    created_at: i.createdAt,
    created_by: createdBy(i),
    // The entry a note is about (an article of the same dossier), or null.
    about_item_id: i.aboutItemId,
    // D7b: the light of a norm or a decision (its assistant's notes by state) and an assistant's note
    // entry's own state; null for the user's own rows, for an exchanged token, and with the switch off.
    ...assistantFieldsOf(i, view),
  };
}

/** One entry's answer, with its view of the assistant's notes. */
export async function serializeItemFor(req: Request, item: ItemRow) {
  return serializeItem(item, await assistantViewFor(req, [item]), hidesNoteText(req), hidesNormText(req));
}

/** Several entries' answers, with one view of the assistant's notes for all of them. */
async function serializeItemsFor(req: Request, items: ItemRow[]) {
  const view = await assistantViewFor(req, items);
  const hideNotes = hidesNoteText(req);
  const hideNormText = hidesNormText(req);
  return items.map((item) => serializeItem(item, view, hideNotes, hideNormText));
}

/** Dossiers' answers, with one view of the assistant's notes for all their entries. */
async function serializeDossiersFor(req: Request, dossiers: Parameters<typeof serializeDossier>[0][]) {
  const view = await assistantViewFor(req, dossiers.flatMap((d) => d.items));
  const hideNotes = hidesNoteText(req);
  const hideNormText = hidesNormText(req);
  return dossiers.map((d) => serializeDossier(d, view, hideNotes, hideNormText));
}

/**
 * What a dossier route includes besides the row: the entries in order, the
 * dossier's copy in the Forum (owner-only: every dossier route is scoped to its owner),
 * and how many planner tasks it holds.
 */
const DOSSIER_INCLUDE = {
  items: { orderBy: { position: 'asc' } },
  publishedCopy: { select: { id: true, currentVersion: true, isActive: true, updatedAt: true } },
  _count: { select: { tasks: true } },
} satisfies Prisma.DossierInclude;

type PublishedCopyRow = { id: string; currentVersion: number; isActive: boolean; updatedAt: Date };

/** A dossier as every route answers it. */
function serializeDossier(
  d: Prisma.DossierGetPayload<object> & { items: ItemRow[]; publishedCopy: PublishedCopyRow | null; _count: { tasks: number } },
  view: AssistantView | null,
  hideNotes = false,
  hideNormText = false,
) {
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    color: d.color,
    tags: d.tags,
    // `lavoro` (a practice) or `studio` (a topic studied).
    kind: d.kind,
    is_pinned: d.isPinned,
    // The dossier's copy in the Forum, or null when it was never published (or its copy was deleted).
    published: d.publishedCopy
      ? {
          shared_environment_id: d.publishedCopy.id,
          version: d.publishedCopy.currentVersion,
          is_active: d.publishedCopy.isActive,
          updated_at: d.publishedCopy.updatedAt,
        }
      : null,
    // The admin withdrew its copy from the Forum: it cannot be published again until the admin allows it.
    forum_blocked: d.forumBlockedAt != null,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
    created_by: createdBy(d),
    items: d.items.map((item) => serializeItem(item, view, hideNotes, hideNormText)),
    // Its planner tasks, done and trashed ones too: all go to the trash with the dossier. A count, never
    // a title: a connected application reads it to tell the user, in the deletion's confirmation.
    task_count: d._count.tasks,
  };
}

// Validation schemas
const dossierKindSchema = z.enum(['lavoro', 'studio']);

const createDossierSchema = z.object({
  // In UTF-16 units, as the Forum counts a published dossier's title (`LIMITS.title`).
  name: z.string().min(1).refine(...atMostUnits(200)),
  description: boundedText(5_000, 'descrizione').optional(),
  color: boundedText(50, 'colore').optional(),
  tags: boundedTags(50, 100).optional(),
  kind: dossierKindSchema.optional(),
});

const updateDossierSchema = z.object({
  name: z.string().min(1).refine(...atMostUnits(200)).optional(),
  description: boundedText(5_000, 'descrizione').optional().nullable(),
  color: boundedText(50, 'colore').optional().nullable(),
  tags: boundedTags(50, 100).optional(),
  isPinned: z.boolean().optional(),
  kind: dossierKindSchema.optional(),
});

// An entry's position is a Postgres integer: a fraction or a number past its range is a 400, not a failed write.
const itemPosition = z.number().int().min(-2_147_483_648).max(2_147_483_647);

const createDossierItemSchema = z.object({
  itemType: z.enum(['norm', 'note', 'section', 'sentenza']),
  title: boundedText(1_000, 'titolo').min(1),
  content: z.any().optional(),
  position: itemPosition.optional(),
  status: z.enum(['unread', 'reading', 'important', 'done']).optional(),
});

const updateDossierItemSchema = z.object({
  title: boundedText(1_000, 'titolo').min(1).optional(),
  content: z.any().optional(),
  position: itemPosition.optional(),
  status: z.enum(['unread', 'reading', 'important', 'done']).optional(),
  // A note's article (or null to detach it): how the web app reattaches a note
  // to an article it restored with a new id. User session only: this route is
  // not in the delegated table, so a connected application cannot move notes.
  aboutItemId: boundedText(64, 'articolo della nota').min(1).nullable().optional(),
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
    include: DOSSIER_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });

  res.json(await serializeDossiersFor(req, dossiers));
};

/**
 * Get single dossier by ID
 */
export const getDossier = async (req: Request, res: Response) => {
  const { id } = req.params;

  const dossier = await prisma.dossier.findFirst({
    where: { id, userId: req.user!.id },
    include: DOSSIER_INCLUDE,
  });

  if (!dossier) {
    throw new AppError(404, 'Dossier not found');
  }

  res.json((await serializeDossiersFor(req, [dossier]))[0]);
};

/**
 * Create new dossier
 */
export const createDossier = async (req: Request, res: Response) => {
  const data = parseBody(createDossierSchema, req.body);

  const dossier = await prisma.$transaction(async (tx) => {
    await assertDossierRoom(tx, req.user!.id, { dossiers: 1 });
    return tx.dossier.create({
      data: {
        name: data.name,
        description: data.description,
        color: data.color,
        tags: data.tags ?? [],
        kind: data.kind ?? 'lavoro',
        userId: req.user!.id,
        ...provenanceFromRequest(req),
      },
      include: DOSSIER_INCLUDE,
    });
  });

  res.status(201).json((await serializeDossiersFor(req, [dossier]))[0]);
};

/**
 * Update dossier
 */
export const updateDossier = async (req: Request, res: Response) => {
  const { id } = req.params;
  const data = parseBody(updateDossierSchema, req.body);

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
      ...(data.kind !== undefined && { kind: data.kind }),
    },
    include: DOSSIER_INCLUDE,
  });

  res.json((await serializeDossiersFor(req, [dossier]))[0]);
};

const importStudySchema = z.object({
  content: z.unknown().optional(),
  addNotes: z.boolean().default(true),
  addHighlights: z.boolean().default(true),
});

/**
 * New dossiers di studio from content the web app holds: a ready-made pack, an old environment
 * link (spec docs/superpowers/specs/2026-10-13-environments-into-forum-design.md, D9, D11c, D12).
 * Filtered as Forum content is, then imported as a download is; never an existing dossier
 * changed. User session only: not in the delegated table.
 */
export const importStudyDossiersRoute = async (req: Request, res: Response) => {
  const data = importStudySchema.parse(req.body);
  if (JSON.stringify(data.content ?? null).length > 1024 * 1024) throw new AppError(400, 'Il contenuto supera la dimensione massima (1 MB).');
  const { content, refused } = readableContent(data.content);
  if (content.dossiers.length === 0) throw new AppError(400, 'Nessuna pratica leggibile da aggiungere.');
  await spendStudyImport(req.user!.id);
  const report = await importStudyDossiers(req.user!.id, content, {
    addNotes: data.addNotes,
    addHighlights: data.addHighlights,
    addShortcuts: false,
    attributeTo: null,
    refused,
  });
  res.status(201).json(report);
};

/**
 * Delete a dossier from the web app: it goes to the trash for 30 days, with its
 * entries and snapshots, listed «Rimosso da te» (owner, 13 October 2026,
 * question 160; before, it was gone at once). The answer names the trash entry,
 * so the page's «Annulla» restores it. Not in the delegated table: a connected
 * application deletes through `POST /dossiers/:id/trash`.
 */
export const deleteDossier = async (req: Request, res: Response) => {
  // 404 when the dossier is not the user's (checked under the row lock).
  res.json(await trashDossier(req.user!.id, req.params.id, null, BY_THE_USER));
};

const ARTICLE_OR_RECITAL = 'Una voce resta un articolo o un considerando: aggiungila di nuovo.';

/**
 * A recital's content (a `norm` entry with the key `considerando`, spec 2026-11-17 §6.2, G-538),
 * closed and checked, with its title: the citation, set here on every write that carries content.
 * A content that does not hold is a 400 in the fixture's words.
 */
function recitalItem(content: unknown): { content: Prisma.InputJsonObject; title: string } {
  const recital = rebuildRecitalEntry(content);
  if (!recital.ok) throw new AppError(400, recital.reason);
  return {
    content: { ...recital.entry, ...(recital.star ? { _dossierMeta: recital.star } : {}) },
    title: citeRecital(recital.entry),
  };
}

/**
 * One entry as an add checks it, before anything is written: the schema (a field over its limit refused in its
 * Italian words), a decision's content (its identity, design 2026-10-01 §6) and a recital's (spec 2026-11-17 §6.2)
 * checked, the title set from them. Throws what the single route answers. Shared by the single add and the bulk.
 */
function prepareItem(body: unknown) {
  const data = parseBody(createDossierItemSchema, body);
  const decision = data.itemType === 'sentenza' ? parseDecisionItemContent(data.content) : null;
  const recital = data.itemType === 'norm' && isRecitalContent(data.content) ? recitalItem(data.content) : null;
  return {
    itemType: data.itemType as DossierItemType,
    title: decision ? decision.etichetta : recital ? recital.title : data.title,
    // As the single add always wrote it: no content is a plain null.
    content: (decision ?? recital?.content ?? (data.content || null)) as Prisma.InputJsonValue,
    position: data.position,
    status: data.status,
  };
}

/**
 * Add item to dossier
 */
export const addDossierItem = async (req: Request, res: Response) => {
  const { id } = req.params;
  const prepared = prepareItem(req.body);

  // Check ownership
  const dossier = await prisma.dossier.findFirst({
    where: { id, userId: req.user!.id },
  });

  if (!dossier) {
    throw new AppError(404, 'Dossier not found');
  }

  const item = await prisma.$transaction(async (tx) => {
    await assertDossierRoom(tx, req.user!.id, { items: 1, into: { dossierId: id, items: 1 } });
    const maxPos = await tx.dossierItem.aggregate({
      where: { dossierId: id },
      _max: { position: true },
    });
    return tx.dossierItem.create({
      data: {
        dossierId: id,
        itemType: prepared.itemType,
        title: prepared.title,
        content: prepared.content,
        position: prepared.position ?? (maxPos._max.position ?? -1) + 1,
        ...(prepared.status !== undefined && { status: prepared.status }),
        ...provenanceFromRequest(req),
      },
    });
  });

  res.status(201).json(await serializeItemFor(req, item));
};

/** Entries per bulk request: a dossier's whole cap. */
export const MAX_BULK_ITEMS = MAX_ITEMS_PER_DOSSIER;
/** Entries a bulk request carries for the one write point every request costs; each 50 more cost one more. */
export const BULK_ITEMS_PER_WRITE = 50;

const bulkItemsSchema = z.object({
  items: z.array(z.unknown()).min(1, 'Nessuna voce da aggiungere.')
    .max(MAX_BULK_ITEMS, `Al massimo ${formatThousands(MAX_BULK_ITEMS)} voci per richiesta.`),
});

/** Why one entry of a bulk write was refused: the single route's code and its words. */
function entryRefusal(err: unknown): { error: string; detail: string } {
  if (err instanceof AppError) return { error: err.code ?? 'invalid', detail: err.message };
  if (err instanceof ZodError) return { error: 'invalid', detail: validationDetail(err) };
  throw err;
}

/**
 * A dossier's entries in one request (G-595, the owner's words: «il server riceve tutte le voci in una richiesta,
 * applica i limiti della G-576 in una volta e risponde con quante sono entrate»). One transaction: every entry is
 * checked as a single add checks it; the caps once, for the batch, the account's row locked first; the entries that
 * hold go in, in order, up to the room left, after the dossier's last entry. The answer says how many entered and,
 * for each one that did not (by its index in the request), why: the single route's code and Italian sentence, or
 * the cap's.
 *
 * At most `MAX_BULK_ITEMS` entries and 8 MB per request (app.ts): beyond that a client sends several requests, in
 * order. On the write limiter it costs one write, as any request, plus one for each `BULK_ITEMS_PER_WRITE` entries
 * past the first 50: a full batch of 2,000 costs 40 of the 200 writes a minute, so at most five a minute, 10,000
 * entries, the account's own ceiling. Session only: not in the delegated table.
 */
export const addDossierItemsBulk = async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.user!.id;
  const { items } = parseBody(bulkItemsSchema, req.body);
  const extra = Math.ceil(Math.max(0, items.length - BULK_ITEMS_PER_WRITE) / BULK_ITEMS_PER_WRITE);
  if (!(await chargeWrites(req, res, extra))) return;

  const dossier = await prisma.dossier.findFirst({ where: { id, userId }, select: { id: true } });
  if (!dossier) throw new AppError(404, 'Dossier not found');

  const valid: { index: number; entry: ReturnType<typeof prepareItem> }[] = [];
  const refused: { index: number; error: string; detail: string }[] = [];
  items.forEach((body, index) => {
    try {
      valid.push({ index, entry: prepareItem(body) });
    } catch (err) {
      refused.push({ index, ...entryRefusal(err) });
    }
  });

  // Each entry's id is set here, so the answer can say which entry of the request each created one is.
  const indexOf = new Map<string, number>();
  const created = await prisma.$transaction(async (tx) => {
    const { room, refusalAfter } = await itemRoom(tx, userId, id);
    const fits = valid.slice(0, room);
    // The cap's sentence as a single add would read it after these went in («Questa ne ha già 2.000.»).
    const refusal = refusalAfter(fits.length);
    for (const over of valid.slice(room)) refused.push({ index: over.index, ...refusal });
    if (fits.length === 0) return [];
    const last = await tx.dossierItem.aggregate({ where: { dossierId: id }, _max: { position: true } });
    // As one add after another: an entry without a position goes after the last one, its own or one the
    // request set.
    let next = (last._max.position ?? -1) + 1;
    const provenance = provenanceFromRequest(req);
    return tx.dossierItem.createManyAndReturn({
      data: fits.map(({ index, entry }) => {
        const itemId = randomUUID();
        indexOf.set(itemId, index);
        const position = entry.position ?? next;
        next = Math.max(next, position + 1);
        return {
          id: itemId,
          dossierId: id,
          itemType: entry.itemType,
          title: entry.title,
          content: entry.content,
          position,
          ...(entry.status !== undefined && { status: entry.status }),
          ...provenance,
        };
      }),
    });
  }, { maxWait: 10_000, timeout: 60_000 });

  refused.sort((a, b) => a.index - b.index);
  const ordered = created.sort((a, b) => indexOf.get(a.id)! - indexOf.get(b.id)!);
  const serialized = await serializeItemsFor(req, ordered);
  res.status(created.length > 0 ? 201 : 200).json({
    entered: created.length,
    total: items.length,
    // In the request's order, each with its index in the request.
    items: serialized.map((item, i) => ({ index: indexOf.get(ordered[i].id)!, ...item })),
    refused,
  });
};

/**
 * What a note may be about: an article of the same dossier, as a whole. The one
 * check behind POST /notes and the PUT that reattaches a note; a new kind of
 * target (a decision) is added here once.
 */
async function assertArticleOfDossier(dossierId: string, itemId: string): Promise<void> {
  const article = await prisma.dossierItem.findFirst({ where: { id: itemId, dossierId, itemType: 'norm' } });
  if (!article) throw new AppError(400, 'La voce indicata non è un articolo di questa pratica.');
}

export const MAX_NOTE_LENGTH = 4000;
// Plain text: new lines and tabs, nothing else below U+0020.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const noteSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1)
      // In UTF-16 units, as the Forum's and the proposals' checks count a note.
      .refine(...atMostUnits(MAX_NOTE_LENGTH))
      .refine((text) => !CONTROL.test(text), 'Caratteri di controllo non ammessi.'),
    // Not `.uuid()`: any id that is not a norm of this dossier gets the same answer below.
    aboutItemId: z.string().min(1).max(64).optional(),
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

  if (aboutItemId) await assertArticleOfDossier(id, aboutItemId);

  const item = await prisma.$transaction(async (tx) => {
    await assertDossierRoom(tx, req.user!.id, { items: 1, into: { dossierId: id, items: 1 } });
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
        // D7b: an assistant's note starts «da validare», its text kept as the original.
        ...(req.delegation ? { assistantNote: text, noteState: 'proposed' as const } : {}),
      },
    });
  });

  res.status(201).json(await serializeItemFor(req, item));
};

/**
 * Update dossier item
 */
export const updateDossierItem = async (req: Request, res: Response) => {
  const { id, itemId } = req.params;
  const data = parseBody(updateDossierItemSchema, req.body);

  // Check ownership
  const dossier = await prisma.dossier.findFirst({
    where: { id, userId: req.user!.id },
  });

  if (!dossier) {
    throw new AppError(404, 'Dossier not found');
  }

  if (data.aboutItemId !== undefined) {
    const current = await prisma.dossierItem.findFirst({ where: { id: itemId, dossierId: id }, select: { itemType: true } });
    if (!current) throw new AppError(404, 'Dossier item not found');
    if (current.itemType !== 'note') throw new AppError(400, 'Solo una nota può riferirsi a un articolo.');
    if (data.aboutItemId !== null) await assertArticleOfDossier(id, data.aboutItemId);
  }

  // A decision is checked like a creation, and its title is its label: never set apart from it.
  if (data.content !== undefined || data.title !== undefined) {
    const existing = await prisma.dossierItem.findFirst({
      where: { id: itemId, dossierId: id },
      select: { itemType: true, noteState: true, content: true },
    });
    // An assistant's note (D7b) changes its text only through `PUT …/text`, behind the switch and the row's lock,
    // which keeps the original and stamps the edit: here its content stays as stored. The web sends the whole
    // content back with a change of star or position, and that must never make the note «modificata da te».
    if (existing?.noteState) delete data.content;
    if (existing?.itemType === 'sentenza') {
      if (data.content !== undefined) {
        const decision = parseDecisionItemContent(data.content);
        data.content = decision;
        data.title = decision.etichetta;
      } else {
        delete data.title;
      }
    }
    // A recital stays a recital and an article an article (spec 2026-11-17 §6.2): its content is
    // checked and its title is its citation, as for a decision.
    if (existing?.itemType === 'norm') {
      const storedRecital = isRecitalContent(existing.content);
      if (data.content !== undefined) {
        if (isRecitalContent(data.content) !== storedRecital) throw new AppError(400, ARTICLE_OR_RECITAL);
        if (storedRecital) {
          const recital = recitalItem(data.content);
          data.content = recital.content;
          data.title = recital.title;
        }
      } else if (storedRecital) {
        delete data.title;
      }
    }
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
        ...(data.aboutItemId !== undefined && { aboutItemId: data.aboutItemId }),
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new AppError(404, 'Dossier item not found');
    }
    throw err;
  }

  res.json(await serializeItemFor(req, item));
};

/**
 * Remove a dossier item from the web app: it goes to the trash for 30 days,
 * listed «Rimosso da te» (owner, 13 October 2026, question 181; before, it was
 * gone at once). The answer names the trash entry, so the page's «Annulla»
 * restores it. 404 when the dossier is not the user's or the entry is not in
 * it. Not in the delegated table: a connected application uses `trash-items`.
 */
export const deleteDossierItem = async (req: Request, res: Response) => {
  const { id, itemId } = req.params;
  res.json(await trashDossierItems(req.user!.id, id, [itemId], BY_THE_USER));
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
      // Moved within the account: the target's cap counts, the account's total does not change.
      await assertDossierRoom(tx, req.user!.id, { into: { dossierId: target.id, items: 1 } });
      // Read the append slot in the same transaction as the write. Under
      // Postgres' default isolation two moves arriving together can still read
      // the same max and claim the same position — the client sends one move at
      // a time, and two items sharing a position only swaps their order until
      // the next reorder rewrites every position, so no lock is taken for it.
      const maxPos = await tx.dossierItem.aggregate({
        where: { dossierId: target.id },
        _max: { position: true },
      });

      const moved = await tx.dossierItem.update({
        // Scoped by dossierId: the ownership check above proves the source
        // dossier is ours, not that the item belongs to it.
        where: { id: itemId, dossierId: source.id },
        data: {
          dossierId: target.id,
          position: (maxPos._max.position ?? -1) + 1,
          // A note is about an article of its own dossier: the one it leaves stays behind.
          aboutItemId: null,
        },
      });
      // A task is about an entry of its own dossier too: the tasks stay in the source, without the entry.
      await tx.task.updateMany({ where: { dossierItemId: moved.id }, data: { dossierItemId: null } });
      return moved;
    });

    res.json(await serializeItemFor(req, item));
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

type NormIdentityFields = { urn: string; numero_articolo: string; allegato: string | null; parte?: string };

/**
 * Which article of which act a stored norm is. The urn alone is not enough:
 * the Python API gives an EU article the urn of its act (no `~art<N>`), so
 * every article of the GDPR would read as the same one. The article number
 * (and the annex, for a code that has them) is part of the identity; for a
 * Normattiva norm it repeats what the urn already says.
 */
function normIdentity(norm: Partial<NormIdentityFields>): string | null {
  if (typeof norm.urn !== 'string') return null;
  const article = typeof norm.numero_articolo === 'string' ? norm.numero_articolo.toLowerCase().trim().replace(/[\s-]+/g, '-').replace(/^(\d+)([a-z])/, '$1-$2') : '';
  // A part of a split article is another entry than its article (G-387 (a)); the first part has no `parte`.
  const part = partOf(norm.parte) ? `|${norm.parte}` : '';
  return `${norm.urn}|${norm.allegato ?? ''}|${article}${part}`;
}

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
    dossier.items.flatMap((item) => {
      const key = item.content && typeof item.content === 'object' ? normIdentity(item.content as Partial<NormIdentityFields>) : null;
      return key ? [key] : [];
    }),
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
      const identity = normIdentity(resolution.norm);
      if (identity && present.has(identity)) return { ...base, outcome: 'already_present' as const, detail: undefined };
      if (identity) present.add(identity);
      toCreate.push({ index, urn: resolution.norm.urn });
      return { ...base, outcome: 'added' as const };
    });

  if (toCreate.length > 0) {
    const created = await prisma.$transaction(async (tx) => {
      await assertDossierRoom(tx, req.user!.id, { items: toCreate.length, into: { dossierId: dossier.id, items: toCreate.length } });
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

export const MAX_DECISIONS_PER_CALL = 10;

const addDecisionsSchema = z.object({
  references: z.array(z.string().trim().min(1).max(300)).min(1).max(MAX_DECISIONS_PER_CALL),
}).strict();

type DecisionResultOutcome = Exclude<DecisionOutcome, 'resolved'> | 'added' | 'already_present';

/**
 * Adds court decisions to a dossier from references in words («Cass. civ., sez. un., n.
 * 31310/2024»), 1 to 10 per call (design 2026-10-12 §2.2). The Python API reads the words and
 * confirms each decision at its source (`norms/resolveDecisions.ts`); one that is not recognised,
 * of a court VisuaLex cannot read, ambiguous, missing or unverifiable is reported and does not
 * stop the others. The confirmed ones are created in one transaction as `sentenza` items, after
 * the dossier's last item, with the label the server computes; a decision already in the dossier
 * (by its key) or twice in the call is added once. Nothing is updated, moved or deleted.
 */
export const addDossierDecisions = async (req: Request, res: Response) => {
  const { references } = addDecisionsSchema.parse(req.body);
  const dossier = await prisma.dossier.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    include: { items: { where: { itemType: 'sentenza' }, select: { content: true } } },
  });
  if (!dossier) throw new AppError(404, 'Dossier not found');

  const resolutions = await resolveDecisionReferences(references);
  // The decisions already kept, by key; a stored content the schema refuses names none.
  const present = new Set(
    dossier.items.flatMap((item) => {
      const parsed = decisionItemContentSchema.safeParse(item.content);
      return parsed.success ? [decisionKeyOf(parsed.data)] : [];
    }),
  );

  type DecisionResult = {
    reference: string; outcome: DecisionResultOutcome; citation?: string; court?: string; candidates?: string[]; detail?: string; itemId?: string;
  };
  const toCreate: number[] = [];
  const results: DecisionResult[] = resolutions.map((resolution, index): DecisionResult => {
    const base = { reference: references[index], ...(resolution.detail ? { detail: resolution.detail } : {}) };
    if (resolution.outcome !== 'resolved') {
      return {
        ...base, outcome: resolution.outcome,
        ...(resolution.court ? { court: resolution.court } : {}),
        ...(resolution.candidates ? { candidates: resolution.candidates } : {}),
      };
    }
    const decision = resolution.decision!;
    const citation = citeDecision(decision);
    if (present.has(resolution.key!)) return { ...base, outcome: 'already_present', citation };
    present.add(resolution.key!);
    toCreate.push(index);
    return { ...base, outcome: 'added', citation };
  });

  if (toCreate.length > 0) {
    const created = await prisma.$transaction(async (tx) => {
      // The lookups took up to the budget: read again, in the transaction, what the dossier holds
      // now (another call may have added the same decision, or the dossier may be gone).
      const current = await tx.dossier.findFirst({
        where: { id: dossier.id, userId: req.user!.id },
        include: { items: { where: { itemType: 'sentenza' }, select: { content: true } } },
      });
      if (!current) throw new AppError(404, 'Dossier not found');
      const kept = new Set(current.items.flatMap((item) => {
        const parsed = decisionItemContentSchema.safeParse(item.content);
        return parsed.success ? [decisionKeyOf(parsed.data)] : [];
      }));
      // The caps, on what this call will add: a decision already present adds nothing. The reads above take no lock,
      // so the account's row is still the first lock of this transaction.
      const adding = toCreate.filter((index) => !kept.has(resolutions[index].key!)).length;
      await assertDossierRoom(tx, req.user!.id, { items: adding, into: { dossierId: dossier.id, items: adding } });
      const last = await tx.dossierItem.aggregate({ where: { dossierId: dossier.id }, _max: { position: true } });
      let position = (last._max.position ?? -1) + 1;
      const rows: { index: number; id: string }[] = [];
      for (const index of toCreate) {
        if (kept.has(resolutions[index].key!)) {
          results[index].outcome = 'already_present';
          continue;
        }
        // Checked by the item schema like any other write, the label recomputed (D9).
        const decision = parseDecisionItemContent(resolutions[index].decision);
        rows.push(
          await tx.dossierItem.create({
            data: {
              dossierId: dossier.id,
              itemType: 'sentenza',
              title: decision.etichetta,
              content: decision as unknown as Prisma.InputJsonValue,
              position: position++,
              ...provenanceFromRequest(req),
            },
          }).then((row) => ({ index, id: row.id })),
        );
      }
      if (rows.length > 0) await tx.dossier.update({ where: { id: dossier.id }, data: { updatedAt: new Date() } });
      return rows;
    });
    for (const { index, id } of created) results[index].itemId = id;
  }

  // Under an exchanged token each reference is charged two points; one the sources could not
  // check is handed back (middleware/delegated.ts).
  res.locals.delegatedRefund = results.filter((r) => r.outcome === 'unavailable').length * 2;
  res.json({ results });
};
