import { Router, type NextFunction, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { isSwitchOn } from '../assistant/switches';
import {
  editedNoteSchema,
  editorNames,
  noteEdit,
  noteStateSchema,
  serializeProposal,
  stateChange,
} from '../assistant/notes';
import { serializeItemFor } from '../controllers/dossierController';

/**
 * The web app's side of D7b (first cut): an entry's proposals (the assistant's highlights on it), the
 * state and the text of the assistant's notes (on a passage, or a note entry), the boundaries of a mark,
 * and its removal. The user's session only: none of these routes is in the delegated table, so a
 * connected application can never read or change a state, a comment or an edit. Behind the
 * `assistant_passages` switch: off, every route answers 404.
 */
const router = Router();
router.use('/dossiers/:id/items/:itemId', authenticate);

const OFF = 'Non disponibile';

async function requireSwitch(_req: Request, _res: Response, next: NextFunction) {
  if (!(await isSwitchOn('assistant_passages'))) throw new AppError(404, OFF);
  next();
}

/** The user's dossier and its entry, or the Italian 404 for whichever is missing. */
async function entryOf(req: Request) {
  const { id, itemId } = req.params;
  const dossier = await prisma.dossier.findFirst({ where: { id, userId: req.user!.id }, select: { id: true } });
  if (!dossier) throw new AppError(404, 'Dossier non trovato');
  const item = await prisma.dossierItem.findFirst({ where: { id: itemId, dossierId: dossier.id } });
  if (!item) throw new AppError(404, 'Voce non trovata');
  return item;
}

/** Locks and reads an assistant's mark on this entry, inside the caller's transaction. */
async function lockedProposal(tx: Prisma.TransactionClient, req: Request) {
  const { itemId, proposalId } = req.params;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM highlights
    WHERE id = ${proposalId} AND user_id = ${req.user!.id} AND dossier_item_id = ${itemId} AND created_by_client_id IS NOT NULL
    FOR UPDATE`;
  if (rows.length === 0) throw new AppError(404, 'Proposta non trovata');
  return tx.highlight.findUniqueOrThrow({ where: { id: proposalId } });
}

async function answerProposal(res: Response, row: Prisma.HighlightGetPayload<object>) {
  const usernames = await editorNames([row.noteEditedBy, row.rangeEditedBy]);
  res.json(serializeProposal(row, usernames));
}

router.get('/dossiers/:id/items/:itemId/proposals', requireSwitch, async (req, res) => {
  const item = await entryOf(req);
  const rows = await prisma.highlight.findMany({
    where: { userId: req.user!.id, dossierItemId: item.id, createdByClientId: { not: null } },
    orderBy: [{ startOffset: 'asc' }, { createdAt: 'asc' }],
  });
  const usernames = await editorNames(rows.flatMap((r) => [r.noteEditedBy, r.rangeEditedBy]));
  res.json({ proposals: rows.map((r) => serializeProposal(r, usernames)) });
});

router.put('/dossiers/:id/items/:itemId/proposals/:proposalId/state', requireSwitch, async (req, res) => {
  const wanted = noteStateSchema.parse(req.body);
  await entryOf(req);
  const row = await prisma.$transaction(async (tx) => {
    const current = await lockedProposal(tx, req);
    if (current.noteState === null) throw new AppError(409, 'Questo segno dell’IA non ha una nota da validare.');
    const change = stateChange(current, wanted, new Date());
    return change ? tx.highlight.update({ where: { id: current.id }, data: change }) : current;
  });
  await answerProposal(res, row);
});

router.put('/dossiers/:id/items/:itemId/proposals/:proposalId/note', requireSwitch, async (req, res) => {
  const { text } = editedNoteSchema(0).parse(req.body);
  await entryOf(req);
  const row = await prisma.$transaction(async (tx) => {
    const current = await lockedProposal(tx, req);
    if (current.noteState === null) throw new AppError(409, 'Questo segno dell’IA non ha una nota da modificare.');
    const edit = noteEdit(current.note, text, req.user!.id, new Date());
    return edit ? tx.highlight.update({ where: { id: current.id }, data: { ...edit, note: text } }) : current;
  });
  await answerProposal(res, row);
});

// The boundaries from the user's selection, as the web computes a highlight of its own: the offset in the
// renderer's projection and the projection's slice there. Not checked against the source, as the user's own
// highlights are not (root rule 23: the text never changes, only where the mark sits). Never the note's state.
const rangeSchema = z
  .object({
    startOffset: z.number().int().min(0),
    text: z.string().min(1).max(2000),
  })
  .strict();

router.put('/dossiers/:id/items/:itemId/proposals/:proposalId/range', requireSwitch, async (req, res) => {
  const { startOffset, text } = rangeSchema.parse(req.body);
  await entryOf(req);
  const row = await prisma.$transaction(async (tx) => {
    const current = await lockedProposal(tx, req);
    if (current.startOffset === startOffset && current.text === text) return current;
    return tx.highlight.update({
      where: { id: current.id },
      data: { startOffset, text, endOffset: startOffset + text.length, rangeEditedAt: new Date(), rangeEditedBy: req.user!.id },
    });
  });
  await answerProposal(res, row);
});

// For good: the web keeps «Annulla» by sending this only once its notification has closed.
router.delete('/dossiers/:id/items/:itemId/proposals/:proposalId', requireSwitch, async (req, res) => {
  await entryOf(req);
  await prisma.$transaction(async (tx) => {
    const current = await lockedProposal(tx, req);
    await tx.highlight.delete({ where: { id: current.id } });
  });
  res.status(204).send();
});

/** Locks and reads an assistant's note entry of this dossier, inside the caller's transaction. */
async function lockedNoteEntry(tx: Prisma.TransactionClient, req: Request) {
  const { id, itemId } = req.params;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT i.id FROM dossier_items i JOIN dossiers d ON d.id = i.dossier_id
    WHERE i.id = ${itemId} AND i.dossier_id = ${id} AND d.user_id = ${req.user!.id}
    FOR UPDATE OF i`;
  if (rows.length === 0) throw new AppError(404, 'Voce non trovata');
  const item = await tx.dossierItem.findUniqueOrThrow({ where: { id: itemId } });
  if (item.noteState === null) throw new AppError(409, 'Questa voce non è una nota dell’IA.');
  return item;
}

router.put('/dossiers/:id/items/:itemId/state', requireSwitch, async (req, res) => {
  const wanted = noteStateSchema.parse(req.body);
  await entryOf(req);
  const item = await prisma.$transaction(async (tx) => {
    const current = await lockedNoteEntry(tx, req);
    const change = stateChange(current, wanted, new Date());
    return change ? tx.dossierItem.update({ where: { id: current.id }, data: change }) : current;
  });
  res.json(await serializeItemFor(req, item));
});

router.put('/dossiers/:id/items/:itemId/text', requireSwitch, async (req, res) => {
  const { text } = editedNoteSchema(1).parse(req.body);
  await entryOf(req);
  const item = await prisma.$transaction(async (tx) => {
    const current = await lockedNoteEntry(tx, req);
    const shown = typeof current.content === 'string' ? current.content : null;
    const edit = noteEdit(shown, text, req.user!.id, new Date());
    return edit ? tx.dossierItem.update({ where: { id: current.id }, data: { ...edit, content: text } }) : current;
  });
  res.json(await serializeItemFor(req, item));
});

export default router;
