import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import { readDecisionKey } from '../norms/decisionKey';

// A history row is a norm or a court decision, never both. The messages are Italian: the first
// one alone is the answer, as in the discussion controller. Unknown fields are ignored, as they
// always were; parseHistory refuses the two kinds together before the schemas see the body.
const normFields = z.object({
  act_type: z.string().min(1),
  act_number: z.string().optional(),
  article: z.string().optional(),
  date: z.string().optional(),
  version: z.string().optional().default('vigente'),
});

const decisionFields = z.object({
  decision_key: z.string({ message: 'La chiave della sentenza non è valida' })
    .refine((key) => readDecisionKey(key) !== null, 'La chiave della sentenza non è valida'),
});

type HistoryInput = z.infer<typeof normFields> | z.infer<typeof decisionFields>;

function parseHistory(body: unknown): HistoryInput {
  const record = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const hasDecision = record.decision_key !== undefined;
  const hasNorm = record.act_type !== undefined;
  if (hasDecision && hasNorm) throw new AppError(400, 'Una voce della cronologia è una norma o una sentenza, non entrambe');
  if (!hasDecision && !hasNorm) throw new AppError(400, 'Manca la norma o la sentenza');
  const result = (hasDecision ? decisionFields : normFields).safeParse(body);
  if (!result.success) {
    throw new AppError(400, hasDecision ? 'La chiave della sentenza non è valida' : 'La norma della cronologia non è valida');
  }
  return result.data;
}

type HistoryRow = {
  id: string; actType: string | null; actNumber: string | null; article: string | null;
  date: string | null; version: string | null; decisionKey: string | null; createdAt: Date;
};

const toJson = (item: HistoryRow) => ({
  id: item.id,
  act_type: item.actType,
  act_number: item.actNumber,
  article: item.article,
  date: item.date,
  version: item.version,
  decision_key: item.decisionKey,
  created_at: item.createdAt,
});

/**
 * Get user's search history
 * GET /history
 */
export const getHistory = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const offset = parseInt(req.query.offset as string) || 0;

  const history = await prisma.searchHistory.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });

  res.json(history.map(toJson));
};

/**
 * Add item to search history
 * POST /history
 */
export const addHistory = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const data = parseHistory(req.body);
  const since = new Date(Date.now() - 5 * 60 * 1000); // duplicates within the last 5 minutes

  // Check for a duplicate recent entry
  const recentDuplicate = await prisma.searchHistory.findFirst({
    where: 'decision_key' in data
      ? { userId: req.user.id, decisionKey: data.decision_key, createdAt: { gte: since } }
      : {
          userId: req.user.id,
          actType: data.act_type,
          actNumber: data.act_number || null,
          article: data.article || null,
          date: data.date || null,
          createdAt: { gte: since },
        },
  });

  if (recentDuplicate) {
    // Update timestamp of existing entry instead of creating duplicate
    const updated = await prisma.searchHistory.update({
      where: { id: recentDuplicate.id },
      data: { createdAt: new Date() },
    });
    res.json(toJson(updated));
    return;
  }

  // Create new history entry
  const item = await prisma.searchHistory.create({
    data: 'decision_key' in data
      ? { decisionKey: data.decision_key, userId: req.user.id }
      : {
          actType: data.act_type,
          actNumber: data.act_number,
          article: data.article,
          date: data.date,
          version: data.version,
          userId: req.user.id,
        },
  });

  res.status(201).json(toJson(item));
};

/**
 * Delete single history item
 * DELETE /history/:id
 */
export const deleteHistoryItem = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { id } = req.params;

  // Check if item exists and belongs to user
  const item = await prisma.searchHistory.findUnique({
    where: { id },
  });

  if (!item) {
    throw new AppError(404, 'History item not found');
  }

  if (item.userId !== req.user.id) {
    throw new AppError(403, 'Not authorized to delete this item');
  }

  await prisma.searchHistory.delete({
    where: { id },
  });

  res.status(204).send();
};

/**
 * Clear all user's search history
 * DELETE /history
 */
export const clearHistory = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  await prisma.searchHistory.deleteMany({
    where: { userId: req.user.id },
  });

  res.status(204).send();
};
