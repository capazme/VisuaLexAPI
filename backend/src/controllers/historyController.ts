import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';

const prisma = new PrismaClient();

// Validation schemas
const addHistorySchema = z.object({
  act_type: z.string().min(1),
  act_number: z.string().optional(),
  article: z.string().optional(),
  date: z.string().optional(),
  version: z.string().optional().default('vigente'),
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

  res.json(history.map(item => ({
    id: item.id,
    act_type: item.actType,
    act_number: item.actNumber,
    article: item.article,
    date: item.date,
    version: item.version,
    created_at: item.createdAt,
  })));
};

/**
 * Add item to search history
 * POST /history
 */
export const addHistory = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const data = addHistorySchema.parse(req.body);

  // Check for duplicate recent entry (within last 5 minutes)
  const recentDuplicate = await prisma.searchHistory.findFirst({
    where: {
      userId: req.user.id,
      actType: data.act_type,
      actNumber: data.act_number || null,
      article: data.article || null,
      date: data.date || null,
      createdAt: {
        gte: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
      },
    },
  });

  if (recentDuplicate) {
    // Update timestamp of existing entry instead of creating duplicate
    const updated = await prisma.searchHistory.update({
      where: { id: recentDuplicate.id },
      data: { createdAt: new Date() },
    });

    res.json({
      id: updated.id,
      act_type: updated.actType,
      act_number: updated.actNumber,
      article: updated.article,
      date: updated.date,
      version: updated.version,
      created_at: updated.createdAt,
    });
    return;
  }

  // Create new history entry
  const item = await prisma.searchHistory.create({
    data: {
      actType: data.act_type,
      actNumber: data.act_number,
      article: data.article,
      date: data.date,
      version: data.version,
      userId: req.user.id,
    },
  });

  res.status(201).json({
    id: item.id,
    act_type: item.actType,
    act_number: item.actNumber,
    article: item.article,
    date: item.date,
    version: item.version,
    created_at: item.createdAt,
  });
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
