import { Request, Response } from 'express';
import { PrismaClient, EnvironmentCategory, ReportReason } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';

const prisma = new PrismaClient();

// Rate limiting: max 5 publications per day per user
const DAILY_PUBLISH_LIMIT = 5;

// Validation schemas
const publishEnvironmentSchema = z.object({
  title: z.string().min(3).max(100),
  description: z.string().max(500).optional(),
  content: z.object({
    dossiers: z.array(z.any()),
    quickNorms: z.array(z.any()),
    annotations: z.array(z.any()),
    highlights: z.array(z.any()),
  }),
  category: z.enum(['compliance', 'civil', 'penal', 'administrative', 'eu', 'other']),
  tags: z.array(z.string().max(30)).max(10).optional(),
  includeNotes: z.boolean().optional(),
  includeHighlights: z.boolean().optional(),
});

const updateEnvironmentSchema = z.object({
  title: z.string().min(3).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  category: z.enum(['compliance', 'civil', 'penal', 'administrative', 'eu', 'other']).optional(),
  tags: z.array(z.string().max(30)).max(10).optional(),
});

const reportSchema = z.object({
  reason: z.enum(['spam', 'inappropriate', 'copyright', 'other']),
  details: z.string().max(500).optional(),
});

// Helper: format shared environment for response
function formatSharedEnvironment(env: any, userId: string) {
  const likeCount = env._count?.likes ?? env.likes?.length ?? 0;
  const userLiked = env.likes?.some((l: any) => l.userId === userId) ?? false;

  return {
    id: env.id,
    title: env.title,
    description: env.description,
    content: env.content,
    category: env.category,
    tags: env.tags,
    includeNotes: env.includeNotes,
    includeHighlights: env.includeHighlights,
    viewCount: env.viewCount,
    downloadCount: env.downloadCount,
    likeCount,
    user: {
      id: env.user.id,
      username: env.user.username,
    },
    userLiked,
    isOwner: env.userId === userId,
    createdAt: env.createdAt,
    updatedAt: env.updatedAt,
  };
}

/**
 * List shared environments with filtering and pagination
 */
export const listSharedEnvironments = async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 12));
  const category = req.query.category as string;
  const tags = req.query.tags as string;
  const sort = (req.query.sort as string) || 'newest';
  const search = req.query.search as string;

  const where: any = {};

  // Category filter
  if (category && category !== 'all') {
    where.category = category as EnvironmentCategory;
  }

  // Tags filter (any match)
  if (tags) {
    const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
    if (tagList.length > 0) {
      where.tags = { hasSome: tagList };
    }
  }

  // Search in title and description
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  // Sorting
  let orderBy: any = { createdAt: 'desc' };
  if (sort === 'popular') {
    orderBy = [{ likes: { _count: 'desc' } }, { createdAt: 'desc' }];
  } else if (sort === 'mostDownloaded') {
    orderBy = [{ downloadCount: 'desc' }, { createdAt: 'desc' }];
  }

  const [environments, total] = await Promise.all([
    prisma.sharedEnvironment.findMany({
      where,
      include: {
        user: { select: { id: true, username: true } },
        likes: { where: { userId: req.user!.id }, select: { userId: true } },
        _count: { select: { likes: true } },
      },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.sharedEnvironment.count({ where }),
  ]);

  res.json({
    data: environments.map(env => formatSharedEnvironment(env, req.user!.id)),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
};

/**
 * Get shared environments published by current user
 */
export const getMySharedEnvironments = async (req: Request, res: Response) => {
  const environments = await prisma.sharedEnvironment.findMany({
    where: { userId: req.user!.id },
    include: {
      user: { select: { id: true, username: true } },
      likes: { where: { userId: req.user!.id }, select: { userId: true } },
      _count: { select: { likes: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json(environments.map(env => formatSharedEnvironment(env, req.user!.id)));
};

/**
 * Get single shared environment by ID
 */
export const getSharedEnvironmentDetail = async (req: Request, res: Response) => {
  const { id } = req.params;

  const env = await prisma.sharedEnvironment.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, username: true } },
      likes: { where: { userId: req.user!.id }, select: { userId: true } },
      _count: { select: { likes: true } },
    },
  });

  if (!env) {
    throw new AppError(404, 'Shared environment not found');
  }

  // Increment view count (don't count own views)
  if (env.userId !== req.user!.id) {
    await prisma.sharedEnvironment.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });
  }

  res.json(formatSharedEnvironment(env, req.user!.id));
};

/**
 * Publish new shared environment
 */
export const publishEnvironment = async (req: Request, res: Response) => {
  const data = publishEnvironmentSchema.parse(req.body);

  // Check daily limit
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const publishedToday = await prisma.sharedEnvironment.count({
    where: {
      userId: req.user!.id,
      createdAt: { gte: today },
    },
  });

  if (publishedToday >= DAILY_PUBLISH_LIMIT) {
    throw new AppError(429, `You can only publish ${DAILY_PUBLISH_LIMIT} environments per day`);
  }

  // Validate content size (max 1MB)
  const contentSize = JSON.stringify(data.content).length;
  if (contentSize > 1024 * 1024) {
    throw new AppError(400, 'Environment content exceeds maximum size (1MB)');
  }

  const env = await prisma.sharedEnvironment.create({
    data: {
      title: data.title,
      description: data.description,
      content: data.content,
      category: data.category as EnvironmentCategory,
      tags: data.tags || [],
      includeNotes: data.includeNotes ?? true,
      includeHighlights: data.includeHighlights ?? true,
      userId: req.user!.id,
    },
    include: {
      user: { select: { id: true, username: true } },
      _count: { select: { likes: true } },
    },
  });

  res.status(201).json(formatSharedEnvironment({ ...env, likes: [] }, req.user!.id));
};

/**
 * Update shared environment (owner only)
 */
export const updateSharedEnvironment = async (req: Request, res: Response) => {
  const { id } = req.params;
  const data = updateEnvironmentSchema.parse(req.body);

  // Check ownership
  const existing = await prisma.sharedEnvironment.findFirst({
    where: { id, userId: req.user!.id },
  });

  if (!existing) {
    throw new AppError(404, 'Shared environment not found or not owned by you');
  }

  const env = await prisma.sharedEnvironment.update({
    where: { id },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.category !== undefined && { category: data.category as EnvironmentCategory }),
      ...(data.tags !== undefined && { tags: data.tags }),
    },
    include: {
      user: { select: { id: true, username: true } },
      likes: { where: { userId: req.user!.id }, select: { userId: true } },
      _count: { select: { likes: true } },
    },
  });

  res.json(formatSharedEnvironment(env, req.user!.id));
};

/**
 * Delete shared environment (owner only)
 */
export const deleteSharedEnvironment = async (req: Request, res: Response) => {
  const { id } = req.params;

  // Check ownership
  const existing = await prisma.sharedEnvironment.findFirst({
    where: { id, userId: req.user!.id },
  });

  if (!existing) {
    throw new AppError(404, 'Shared environment not found or not owned by you');
  }

  await prisma.sharedEnvironment.delete({
    where: { id },
  });

  res.status(204).send();
};

/**
 * Toggle like on shared environment
 */
export const toggleLike = async (req: Request, res: Response) => {
  const { id } = req.params;

  // Check environment exists
  const env = await prisma.sharedEnvironment.findUnique({
    where: { id },
  });

  if (!env) {
    throw new AppError(404, 'Shared environment not found');
  }

  // Check if already liked
  const existingLike = await prisma.sharedEnvironmentLike.findUnique({
    where: {
      envId_userId: { envId: id, userId: req.user!.id },
    },
  });

  let liked: boolean;

  if (existingLike) {
    // Unlike
    await prisma.sharedEnvironmentLike.delete({
      where: { id: existingLike.id },
    });
    liked = false;
  } else {
    // Like
    await prisma.sharedEnvironmentLike.create({
      data: {
        envId: id,
        userId: req.user!.id,
      },
    });
    liked = true;
  }

  // Get updated like count
  const likeCount = await prisma.sharedEnvironmentLike.count({
    where: { envId: id },
  });

  res.json({ liked, likeCount });
};

/**
 * Record download and return environment content
 */
export const recordDownload = async (req: Request, res: Response) => {
  const { id } = req.params;

  const env = await prisma.sharedEnvironment.findUnique({
    where: { id },
  });

  if (!env) {
    throw new AppError(404, 'Shared environment not found');
  }

  // Increment download count (don't count own downloads)
  if (env.userId !== req.user!.id) {
    await prisma.sharedEnvironment.update({
      where: { id },
      data: { downloadCount: { increment: 1 } },
    });
  }

  res.json({
    content: env.content,
    includeNotes: env.includeNotes,
    includeHighlights: env.includeHighlights,
  });
};

/**
 * Report shared environment
 */
export const reportEnvironment = async (req: Request, res: Response) => {
  const { id } = req.params;
  const data = reportSchema.parse(req.body);

  // Check environment exists
  const env = await prisma.sharedEnvironment.findUnique({
    where: { id },
  });

  if (!env) {
    throw new AppError(404, 'Shared environment not found');
  }

  // Can't report own environment
  if (env.userId === req.user!.id) {
    throw new AppError(400, 'You cannot report your own environment');
  }

  // Check if already reported
  const existingReport = await prisma.sharedEnvironmentReport.findUnique({
    where: {
      envId_userId: { envId: id, userId: req.user!.id },
    },
  });

  if (existingReport) {
    throw new AppError(400, 'You have already reported this environment');
  }

  await prisma.sharedEnvironmentReport.create({
    data: {
      envId: id,
      userId: req.user!.id,
      reason: data.reason as ReportReason,
      details: data.details,
    },
  });

  res.status(201).json({ message: 'Report submitted successfully' });
};

// ============================================
// ADMIN ENDPOINTS
// ============================================

/**
 * Get all reports (admin only)
 */
export const getReports = async (req: Request, res: Response) => {
  const status = req.query.status as string;

  const where: any = {};
  if (status && status !== 'all') {
    where.status = status;
  }

  const reports = await prisma.sharedEnvironmentReport.findMany({
    where,
    include: {
      environment: {
        select: { id: true, title: true, userId: true },
      },
      user: {
        select: { id: true, username: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json(reports.map(r => ({
    id: r.id,
    reason: r.reason,
    details: r.details,
    status: r.status,
    createdAt: r.createdAt,
    environment: r.environment,
    reporter: r.user,
  })));
};

/**
 * Update report status (admin only)
 */
export const updateReportStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['pending', 'reviewed', 'dismissed'].includes(status)) {
    throw new AppError(400, 'Invalid status');
  }

  const report = await prisma.sharedEnvironmentReport.update({
    where: { id },
    data: { status },
  });

  res.json({
    id: report.id,
    status: report.status,
  });
};

/**
 * Admin delete shared environment
 */
export const adminDeleteEnvironment = async (req: Request, res: Response) => {
  const { id } = req.params;

  const env = await prisma.sharedEnvironment.findUnique({
    where: { id },
  });

  if (!env) {
    throw new AppError(404, 'Shared environment not found');
  }

  await prisma.sharedEnvironment.delete({
    where: { id },
  });

  res.status(204).send();
};
