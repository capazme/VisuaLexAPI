import { Request, Response } from 'express';
import { PrismaClient, FeedbackType, FeedbackStatus } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';

const prisma = new PrismaClient();

// Validation schemas
const createFeedbackSchema = z.object({
  type: z.enum(['bug', 'suggestion', 'other']),
  message: z.string().min(10, 'Il messaggio deve essere di almeno 10 caratteri'),
});

const updateFeedbackStatusSchema = z.object({
  status: z.enum(['new', 'read', 'resolved', 'dismissed']),
});

// Create feedback (authenticated user)
export const createFeedback = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const data = createFeedbackSchema.parse(req.body);

  const feedback = await prisma.feedback.create({
    data: {
      type: data.type as FeedbackType,
      message: data.message,
      userId: req.user.id,
    },
  });

  res.status(201).json(feedback);
};

// List all feedbacks (admin only)
export const listFeedbacks = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const status = req.query.status as string | undefined;
  const type = req.query.type as string | undefined;

  const where: any = {};

  if (status) {
    where.status = status;
  }

  if (type) {
    where.type = type;
  }

  const feedbacks = await prisma.feedback.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          email: true,
          username: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Transform to snake_case for frontend consistency
  const transformed = feedbacks.map((f) => ({
    id: f.id,
    type: f.type,
    message: f.message,
    status: f.status,
    user_id: f.userId,
    created_at: f.createdAt,
    user: f.user,
  }));

  res.json(transformed);
};

// Get feedback stats (admin only)
export const getFeedbackStats = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const [total, newCount, bugCount, suggestionCount] = await Promise.all([
    prisma.feedback.count(),
    prisma.feedback.count({ where: { status: 'new' } }),
    prisma.feedback.count({ where: { type: 'bug' } }),
    prisma.feedback.count({ where: { type: 'suggestion' } }),
  ]);

  res.json({
    total,
    new: newCount,
    bugs: bugCount,
    suggestions: suggestionCount,
  });
};

// Update feedback status (admin only)
export const updateFeedbackStatus = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { id } = req.params;
  const data = updateFeedbackStatusSchema.parse(req.body);

  const existing = await prisma.feedback.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new AppError(404, 'Feedback not found');
  }

  const feedback = await prisma.feedback.update({
    where: { id },
    data: {
      status: data.status as FeedbackStatus,
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          username: true,
        },
      },
    },
  });

  res.json({
    id: feedback.id,
    type: feedback.type,
    message: feedback.message,
    status: feedback.status,
    user_id: feedback.userId,
    created_at: feedback.createdAt,
    user: feedback.user,
  });
};

// Delete feedback (admin only)
export const deleteFeedback = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { id } = req.params;

  const existing = await prisma.feedback.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new AppError(404, 'Feedback not found');
  }

  await prisma.feedback.delete({
    where: { id },
  });

  res.status(204).send();
};
