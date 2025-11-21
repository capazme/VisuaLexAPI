import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';

const prisma = new PrismaClient();

// Validation schemas
const createHighlightSchema = z.object({
  normaKey: z.string().min(1),
  text: z.string().min(1),
  color: z.enum(['yellow', 'green', 'blue', 'red', 'purple']).default('yellow'),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  note: z.string().optional(),
  bookmarkId: z.string().uuid().optional().nullable(),
});

const updateHighlightSchema = z.object({
  color: z.enum(['yellow', 'green', 'blue', 'red', 'purple']).optional(),
  note: z.string().optional().nullable(),
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

  const highlight = await prisma.highlight.create({
    data: {
      normaKey: data.normaKey,
      text: data.text,
      color: data.color,
      startOffset: data.startOffset,
      endOffset: data.endOffset,
      note: data.note,
      bookmarkId: data.bookmarkId || null,
      userId: req.user.id,
    },
  });

  res.status(201).json(highlight);
};

// Get highlights by normaKey
export const getHighlights = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const normaKey = req.query.normaKey as string;

  if (!normaKey) {
    throw new AppError(400, 'normaKey query parameter is required');
  }

  const highlights = await prisma.highlight.findMany({
    where: {
      normaKey,
      userId: req.user.id,
    },
    orderBy: { createdAt: 'desc' },
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
  const existingHighlight = await prisma.highlight.findFirst({
    where: {
      id,
      userId: req.user.id,
    },
  });

  if (!existingHighlight) {
    throw new AppError(404, 'Highlight not found');
  }

  const highlight = await prisma.highlight.update({
    where: { id },
    data: {
      ...(data.color && { color: data.color }),
      ...(data.note !== undefined && { note: data.note }),
    },
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
  const existingHighlight = await prisma.highlight.findFirst({
    where: {
      id,
      userId: req.user.id,
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
