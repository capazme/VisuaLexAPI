import { Request, Response } from 'express';
import { PrismaClient, AnnotationType } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';

const prisma = new PrismaClient();

// Validation schemas
const createAnnotationSchema = z.object({
  normaKey: z.string().min(1),
  content: z.string().min(1),
  annotationType: z.enum(['note', 'question', 'important', 'follow_up', 'summary']).default('note'),
  textContext: z.string().optional(),
  position: z.number().int().min(0).optional().nullable(),
  bookmarkId: z.string().uuid().optional().nullable(),
});

const updateAnnotationSchema = z.object({
  content: z.string().min(1).optional(),
  annotationType: z.enum(['note', 'question', 'important', 'follow_up', 'summary']).optional(),
  textContext: z.string().optional().nullable(),
  position: z.number().int().min(0).optional().nullable(),
});

// Create annotation
export const createAnnotation = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const data = createAnnotationSchema.parse(req.body);

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

  const annotation = await prisma.annotation.create({
    data: {
      normaKey: data.normaKey,
      content: data.content,
      annotationType: data.annotationType as AnnotationType,
      textContext: data.textContext,
      position: data.position,
      bookmarkId: data.bookmarkId || null,
      userId: req.user.id,
    },
  });

  res.status(201).json(annotation);
};

// Get annotations by normaKey
export const getAnnotations = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const normaKey = req.query.normaKey as string;
  const annotationType = req.query.type as string | undefined;

  if (!normaKey) {
    throw new AppError(400, 'normaKey query parameter is required');
  }

  const where: any = {
    normaKey,
    userId: req.user.id,
  };

  if (annotationType) {
    where.annotationType = annotationType;
  }

  const annotations = await prisma.annotation.findMany({
    where,
    orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
  });

  res.json(annotations);
};

// Update annotation
export const updateAnnotation = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { id } = req.params;
  const data = updateAnnotationSchema.parse(req.body);

  // Check if annotation exists and belongs to user
  const existingAnnotation = await prisma.annotation.findFirst({
    where: {
      id,
      userId: req.user.id,
    },
  });

  if (!existingAnnotation) {
    throw new AppError(404, 'Annotation not found');
  }

  const annotation = await prisma.annotation.update({
    where: { id },
    data: {
      ...(data.content && { content: data.content }),
      ...(data.annotationType && { annotationType: data.annotationType as AnnotationType }),
      ...(data.textContext !== undefined && { textContext: data.textContext }),
      ...(data.position !== undefined && { position: data.position }),
    },
  });

  res.json(annotation);
};

// Delete annotation
export const deleteAnnotation = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { id } = req.params;

  // Check if annotation exists and belongs to user
  const existingAnnotation = await prisma.annotation.findFirst({
    where: {
      id,
      userId: req.user.id,
    },
  });

  if (!existingAnnotation) {
    throw new AppError(404, 'Annotation not found');
  }

  await prisma.annotation.delete({
    where: { id },
  });

  res.status(204).send();
};
