import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';

const prisma = new PrismaClient();

// Validation schemas
const createBookmarkSchema = z.object({
  normaKey: z.string().min(1),
  normaData: z.any(), // JSON data from VisualEx API
  title: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
  folderId: z.string().uuid().optional().nullable(),
});

const updateBookmarkSchema = z.object({
  title: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  folderId: z.string().uuid().optional().nullable(),
});

const moveBookmarkSchema = z.object({
  folderId: z.string().uuid().optional().nullable(),
});

const bulkDeleteSchema = z.object({
  bookmarkIds: z.array(z.string().uuid()).min(1),
});

const bulkMoveSchema = z.object({
  bookmarkIds: z.array(z.string().uuid()).min(1),
  folderId: z.string().uuid().optional().nullable(),
});

// Create bookmark
export const createBookmark = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const data = createBookmarkSchema.parse(req.body);

  // Check if folder exists and belongs to user (if folderId provided)
  if (data.folderId) {
    const folder = await prisma.folder.findFirst({
      where: {
        id: data.folderId,
        userId: req.user.id,
      },
    });

    if (!folder) {
      throw new AppError(404, 'Folder not found');
    }
  }

  // Check if bookmark already exists for this normaKey
  const existingBookmark = await prisma.bookmark.findFirst({
    where: {
      normaKey: data.normaKey,
      userId: req.user.id,
    },
  });

  if (existingBookmark) {
    throw new AppError(400, 'Bookmark already exists for this article');
  }

  const bookmark = await prisma.bookmark.create({
    data: {
      normaKey: data.normaKey,
      normaData: data.normaData,
      title: data.title,
      notes: data.notes,
      tags: data.tags,
      folderId: data.folderId || null,
      userId: req.user.id,
    },
  });

  res.status(201).json(bookmark);
};

// Get all bookmarks
export const getBookmarks = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const folderId = req.query.folderId as string | undefined;
  const tags = req.query.tags as string | undefined;

  const where: any = {
    userId: req.user.id,
  };

  if (folderId !== undefined) {
    where.folderId = folderId || null;
  }

  if (tags) {
    const tagArray = tags.split(',');
    where.tags = {
      hasSome: tagArray,
    };
  }

  const bookmarks = await prisma.bookmark.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      folder: {
        select: {
          id: true,
          name: true,
          color: true,
        },
      },
    },
  });

  res.json(bookmarks);
};

// Get single bookmark
export const getBookmark = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { id } = req.params;

  const bookmark = await prisma.bookmark.findFirst({
    where: {
      id,
      userId: req.user.id,
    },
    include: {
      folder: {
        select: {
          id: true,
          name: true,
          color: true,
        },
      },
      annotations: true,
      highlights: true,
    },
  });

  if (!bookmark) {
    throw new AppError(404, 'Bookmark not found');
  }

  res.json(bookmark);
};

// Update bookmark
export const updateBookmark = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { id } = req.params;
  const data = updateBookmarkSchema.parse(req.body);

  // Check if bookmark exists and belongs to user
  const existingBookmark = await prisma.bookmark.findFirst({
    where: {
      id,
      userId: req.user.id,
    },
  });

  if (!existingBookmark) {
    throw new AppError(404, 'Bookmark not found');
  }

  // Check if folder exists and belongs to user (if folderId provided)
  if (data.folderId) {
    const folder = await prisma.folder.findFirst({
      where: {
        id: data.folderId,
        userId: req.user.id,
      },
    });

    if (!folder) {
      throw new AppError(404, 'Folder not found');
    }
  }

  const bookmark = await prisma.bookmark.update({
    where: { id },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.notes !== undefined && { notes: data.notes }),
      ...(data.tags && { tags: data.tags }),
      ...(data.folderId !== undefined && { folderId: data.folderId }),
    },
  });

  res.json(bookmark);
};

// Move bookmark to folder
export const moveBookmark = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { id } = req.params;
  const data = moveBookmarkSchema.parse(req.body);

  // Check if bookmark exists and belongs to user
  const existingBookmark = await prisma.bookmark.findFirst({
    where: {
      id,
      userId: req.user.id,
    },
  });

  if (!existingBookmark) {
    throw new AppError(404, 'Bookmark not found');
  }

  // Check if folder exists and belongs to user (if folderId provided)
  if (data.folderId) {
    const folder = await prisma.folder.findFirst({
      where: {
        id: data.folderId,
        userId: req.user.id,
      },
    });

    if (!folder) {
      throw new AppError(404, 'Folder not found');
    }
  }

  const bookmark = await prisma.bookmark.update({
    where: { id },
    data: {
      folderId: data.folderId || null,
    },
  });

  res.json(bookmark);
};

// Delete bookmark
export const deleteBookmark = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { id } = req.params;

  // Check if bookmark exists and belongs to user
  const existingBookmark = await prisma.bookmark.findFirst({
    where: {
      id,
      userId: req.user.id,
    },
  });

  if (!existingBookmark) {
    throw new AppError(404, 'Bookmark not found');
  }

  await prisma.bookmark.delete({
    where: { id },
  });

  res.status(204).send();
};

// Bulk delete bookmarks
export const bulkDeleteBookmarks = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { bookmarkIds } = bulkDeleteSchema.parse(req.body);

  // Verify all bookmarks belong to user
  const bookmarks = await prisma.bookmark.findMany({
    where: {
      id: { in: bookmarkIds },
      userId: req.user.id,
    },
  });

  if (bookmarks.length !== bookmarkIds.length) {
    throw new AppError(404, 'One or more bookmarks not found');
  }

  const result = await prisma.bookmark.deleteMany({
    where: {
      id: { in: bookmarkIds },
      userId: req.user.id,
    },
  });

  res.json({ deleted_count: result.count });
};

// Bulk move bookmarks
export const bulkMoveBookmarks = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { bookmarkIds, folderId } = bulkMoveSchema.parse(req.body);

  // Verify all bookmarks belong to user
  const bookmarks = await prisma.bookmark.findMany({
    where: {
      id: { in: bookmarkIds },
      userId: req.user.id,
    },
  });

  if (bookmarks.length !== bookmarkIds.length) {
    throw new AppError(404, 'One or more bookmarks not found');
  }

  // Check if folder exists and belongs to user (if folderId provided)
  if (folderId) {
    const folder = await prisma.folder.findFirst({
      where: {
        id: folderId,
        userId: req.user.id,
      },
    });

    if (!folder) {
      throw new AppError(404, 'Folder not found');
    }
  }

  await prisma.bookmark.updateMany({
    where: {
      id: { in: bookmarkIds },
      userId: req.user.id,
    },
    data: {
      folderId: folderId || null,
    },
  });

  res.json({ updated_count: bookmarkIds.length });
};
