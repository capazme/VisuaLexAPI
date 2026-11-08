import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';

// An offset the column holds (`Int`, PostgreSQL's integer): a larger one was refused by the database with a 500.
const offset = z.number().int().min(0).max(2_147_483_647);

// Validation schemas
const createHighlightSchema = z.object({
  normaKey: z.string().min(1),
  text: z.string().min(1),
  color: z.enum(['yellow', 'green', 'blue', 'red', 'purple']).default('yellow'),
  startOffset: offset,
  endOffset: offset,
  note: z.string().optional(),
  bookmarkId: z.string().guid().optional().nullable(),
  // G-418 (the owner's decision of 3 November 2026): the highlight this one is a part of, when the web's highlighter cuts
  // a piece out of the middle of a highlight (A4) — the first part shrinks in place (`PUT`), this second one is created
  // here and takes the cut highlight's attribution, so a highlight taken from the Forum keeps its first author on both.
  // Null is no part, as before the field existed.
  splitFrom: z.string().guid().nullish(),
});

// A highlight's colour and note; and its range (G-417, the owner's decision of 3 November 2026): the words it covers, in
// the projection the anchors count in (root rule 23), so the web's highlighter can shrink it in place when it cuts a
// piece out (A4) and a highlight taken from the Forum keeps its row, and with it its first author (`originalAuthorId`,
// gotcha 21). The range comes whole — `startOffset`, `endOffset` and `text`, with `endOffset - startOffset` the text's
// length in UTF-16 units, as the web creates one — or not at all; it is not checked against the source's text.
const updateHighlightSchema = z
  .object({
    color: z.enum(['yellow', 'green', 'blue', 'red', 'purple']).optional(),
    note: z.string().optional().nullable(),
    text: z.string().min(1).optional(),
    startOffset: offset.optional(),
    endOffset: offset.optional(),
  })
  .superRefine((data, ctx) => {
    const given = [data.text, data.startOffset, data.endOffset].filter((v) => v !== undefined).length;
    if (given === 0) return;
    if (given < 3) {
      ctx.addIssue({ code: 'custom', message: 'startOffset, endOffset and text go together', path: [] });
      return;
    }
    if (data.endOffset! <= data.startOffset!) {
      ctx.addIssue({ code: 'custom', message: 'endOffset must be greater than startOffset', path: ['endOffset'] });
    } else if (data.endOffset! - data.startOffset! !== data.text!.length) {
      ctx.addIssue({ code: 'custom', message: 'endOffset - startOffset must be the length of text', path: ['text'] });
    }
  });

// Create highlight
export const createHighlight = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const data = createHighlightSchema.parse(req.body);

  // Check if bookmark exists and belongs to user (if bookmarkId provided)
  if (data.bookmarkId) {
    const bookmark = await prisma.bookmark.findFirst({
      where: {
        id: data.bookmarkId,
        userId: req.user.id,
      },
    });

    if (!bookmark) {
      throw new AppError(404, 'Bookmark not found');
    }
  }

  // Validate offsets
  if (data.endOffset <= data.startOffset) {
    throw new AppError(400, 'endOffset must be greater than startOffset');
  }

  // The highlight a part is cut from (G-418): the user's own, never an assistant's (D7b), and on the same text. Refused,
  // not ignored, when it is not: a part made quietly without its author is what the field exists to prevent, and the
  // web takes its gesture back on a refusal. One unknown and one of another user's answer the same 404, as PUT and
  // DELETE do, so an id says nothing of another user's rows.
  const splitFrom = data.splitFrom;
  const userId = req.user.id;
  // Both halves of the attribution contract (gotcha 21 of the web), as the cut highlight holds them now.
  const attributionOf = async (): Promise<{ originalAuthorId: string | null; sourceSuggestionId: string | null } | null> => {
    if (!splitFrom) return null;
    const cut = await prisma.highlight.findFirst({
      where: { id: splitFrom, userId, createdByClientId: null },
      select: { normaKey: true, originalAuthorId: true, sourceSuggestionId: true },
    });
    if (!cut) {
      throw new AppError(404, 'Highlight not found');
    }
    if (cut.normaKey !== data.normaKey) {
      throw new AppError(400, 'splitFrom must name a highlight of the same text');
    }
    return { originalAuthorId: cut.originalAuthorId, sourceSuggestionId: cut.sourceSuggestionId };
  };
  const create = (attribution: Awaited<ReturnType<typeof attributionOf>>) => prisma.highlight.create({
    data: {
      normaKey: data.normaKey,
      text: data.text,
      color: data.color,
      startOffset: data.startOffset,
      endOffset: data.endOffset,
      note: data.note,
      bookmarkId: data.bookmarkId || null,
      userId,
      ...(attribution ?? {}),
    },
    // A part: its original author, as GET /highlights says it, for the web's AttributionChip (gotcha 21). A plain
    // highlight is answered as before.
    ...(attribution && { include: { originalAuthor: { select: { id: true, username: true } } } }),
  });

  const attribution = await attributionOf();
  let highlight;
  try {
    highlight = await create(attribution);
  } catch (error) {
    // What the attribution named went meanwhile (the author's account deleted, the Forum copy and its suggestions
    // removed, which empties the cut highlight's own): read again, as it is now, and try once more.
    if (!attribution || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2003') throw error;
    highlight = await create(await attributionOf());
  }

  res.status(201).json(highlight);
};

// Get highlights by normaKey (exact) or normaKeyPrefix (startsWith).
// The prefix form lets the client pull the article body + all brocardi
// sub-section highlights in one round trip instead of fanning out.
export const getHighlights = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const normaKey = req.query.normaKey as string | undefined;
  const normaKeyPrefix = req.query.normaKeyPrefix as string | undefined;

  if (!normaKey && !normaKeyPrefix) {
    throw new AppError(400, 'normaKey or normaKeyPrefix query parameter is required');
  }

  const highlights = await prisma.highlight.findMany({
    where: {
      userId: req.user.id,
      // An assistant's mark (D7b) shows only on the dossier entry it was proposed on, in every state of its
      // note: never here, so the general reader, Study Mode, review, the Forum's publication, environments
      // and the PDF never receive one. Its own routes are under /dossiers/:id/items/:itemId/proposals.
      createdByClientId: null,
      ...(normaKeyPrefix
        ? { normaKey: { startsWith: normaKeyPrefix } }
        : { normaKey: normaKey! }),
    },
    orderBy: { createdAt: 'desc' },
    // Include the original author so forum-imported highlights keep their
    // AttributionChip across reloads (gotcha #21).
    include: { originalAuthor: { select: { id: true, username: true } } },
  });

  res.json(highlights);
};

// Update highlight
export const updateHighlight = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { id } = req.params;
  const data = updateHighlightSchema.parse(req.body);

  // Check if highlight exists and belongs to user
  // The user's own highlights only: an assistant's mark changes through its entry's routes, which keep
  // the model's original and stamp the edit (D7b).
  const existingHighlight = await prisma.highlight.findFirst({
    where: {
      id,
      userId: req.user.id,
      createdByClientId: null,
    },
  });

  if (!existingHighlight) {
    throw new AppError(404, 'Highlight not found');
  }

  // The same row: its id, its owner and its first author (`originalAuthorId`, `sourceSuggestionId`) never change here.
  const highlight = await prisma.highlight.update({
    where: { id },
    data: {
      ...(data.color && { color: data.color }),
      ...(data.note !== undefined && { note: data.note }),
      ...(data.text !== undefined && { text: data.text, startOffset: data.startOffset, endOffset: data.endOffset }),
    },
    // As GET /highlights: the original author, for the web's AttributionChip (gotcha 21).
    include: { originalAuthor: { select: { id: true, username: true } } },
  });

  res.json(highlight);
};

// Delete highlight
export const deleteHighlight = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { id } = req.params;

  // Check if highlight exists and belongs to user
  // The user's own highlights only: an assistant's mark changes through its entry's routes, which keep
  // the model's original and stamp the edit (D7b).
  const existingHighlight = await prisma.highlight.findFirst({
    where: {
      id,
      userId: req.user.id,
      createdByClientId: null,
    },
  });

  if (!existingHighlight) {
    throw new AppError(404, 'Highlight not found');
  }

  await prisma.highlight.delete({
    where: { id },
  });

  res.status(204).send();
};
