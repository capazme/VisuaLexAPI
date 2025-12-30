import { Request, Response } from 'express';
import { PrismaClient, EnvironmentCategory, ReportReason, SuggestionStatus } from '@prisma/client';
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

// Suggestion schemas
const createSuggestionSchema = z.object({
  content: z.object({
    dossiers: z.array(z.any()),
    quickNorms: z.array(z.any()),
    customAliases: z.array(z.any()),
  }),
  message: z.string().max(500).optional(),
});

const approveSuggestionSchema = z.object({
  changelog: z.string().max(500).optional(),
  versionMode: z.enum(['replace', 'coexist']).default('replace'),
  mergeMode: z.enum(['merge', 'replace']).default('merge'),
});

const rejectSuggestionSchema = z.object({
  reviewNote: z.string().max(500).optional(),
});

// Update with versioning schema
const updateWithVersionSchema = z.object({
  title: z.string().min(3).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  content: z.object({
    dossiers: z.array(z.any()),
    quickNorms: z.array(z.any()),
    customAliases: z.array(z.any()).optional(),
    annotations: z.array(z.any()),
    highlights: z.array(z.any()),
  }).optional(),
  category: z.enum(['compliance', 'civil', 'penal', 'administrative', 'eu', 'other']).optional(),
  tags: z.array(z.string().max(30)).max(10).optional(),
  changelog: z.string().max(500).optional(),
  versionMode: z.enum(['replace', 'coexist']).default('replace'),
});

// Helper: format shared environment for response
function formatSharedEnvironment(env: any, userId: string) {
  const likeCount = env._count?.likes ?? env.likes?.length ?? 0;
  const userLiked = env.likes?.some((l: any) => l.userId === userId) ?? false;
  const pendingSuggestionsCount = env._count?.suggestions ?? 0;

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
    // Versioning fields
    currentVersion: env.currentVersion ?? 1,
    isActive: env.isActive ?? true,
    replacedById: env.replacedById,
    // Suggestions count (only for owner)
    pendingSuggestionsCount: env.userId === userId ? pendingSuggestionsCount : undefined,
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

// Helper: format suggestion for response
function formatSuggestion(suggestion: any, currentUserId: string) {
  return {
    id: suggestion.id,
    sharedEnvironmentId: suggestion.sharedEnvironmentId,
    sharedEnvironment: suggestion.sharedEnvironment ? {
      id: suggestion.sharedEnvironment.id,
      title: suggestion.sharedEnvironment.title,
      user: suggestion.sharedEnvironment.user,
    } : undefined,
    suggester: {
      id: suggestion.suggester.id,
      username: suggestion.suggester.username,
    },
    content: suggestion.content,
    message: suggestion.message,
    status: suggestion.status,
    reviewedAt: suggestion.reviewedAt,
    reviewNote: suggestion.reviewNote,
    createdAt: suggestion.createdAt,
    isOwn: suggestion.suggesterId === currentUserId,
  };
}

// Helper: create a new version snapshot
async function createVersionSnapshot(
  envId: string,
  content: any,
  changelog?: string,
  suggestionId?: string
) {
  // Get next version number
  const latestVersion = await prisma.sharedEnvironmentVersion.findFirst({
    where: { sharedEnvironmentId: envId },
    orderBy: { version: 'desc' },
  });

  const nextVersion = (latestVersion?.version ?? 0) + 1;

  return prisma.sharedEnvironmentVersion.create({
    data: {
      sharedEnvironmentId: envId,
      version: nextVersion,
      content,
      changelog,
      suggestionId,
    },
  });
}

// Helper: merge content arrays avoiding duplicates by ID
function mergeContentArrays(existing: any[], incoming: any[]): any[] {
  const existingIds = new Set(existing.map(item => item.id));
  const merged = [...existing];

  for (const item of incoming) {
    if (!existingIds.has(item.id)) {
      merged.push(item);
      existingIds.add(item.id);
    }
  }

  return merged;
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

/**
 * Admin list all shared environments
 */
export const adminListEnvironments = async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
  const status = req.query.status as string; // 'active', 'withdrawn', 'all'
  const search = req.query.search as string;

  const where: any = {};

  // Filter by status
  if (status === 'active') {
    where.isActive = true;
  } else if (status === 'withdrawn') {
    where.isActive = false;
  }
  // 'all' or undefined: no filter

  // Search
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { user: { username: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [environments, total] = await Promise.all([
    prisma.sharedEnvironment.findMany({
      where,
      include: {
        user: { select: { id: true, username: true, email: true } },
        _count: { select: { likes: true, versions: true, suggestions: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.sharedEnvironment.count({ where }),
  ]);

  res.json({
    data: environments.map(env => ({
      id: env.id,
      title: env.title,
      description: env.description,
      category: env.category,
      tags: env.tags,
      currentVersion: env.currentVersion,
      isActive: env.isActive,
      viewCount: env.viewCount,
      downloadCount: env.downloadCount,
      likeCount: env._count.likes,
      versionCount: env._count.versions,
      suggestionsCount: env._count.suggestions,
      user: env.user,
      createdAt: env.createdAt,
      updatedAt: env.updatedAt,
    })),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
};

/**
 * Admin withdraw any environment
 */
export const adminWithdrawEnvironment = async (req: Request, res: Response) => {
  const { id } = req.params;

  const env = await prisma.sharedEnvironment.findUnique({
    where: { id },
  });

  if (!env) {
    throw new AppError(404, 'Shared environment not found');
  }

  if (!env.isActive) {
    throw new AppError(400, 'Environment is already withdrawn');
  }

  const updated = await prisma.sharedEnvironment.update({
    where: { id },
    data: { isActive: false },
  });

  res.json({ id: updated.id, isActive: updated.isActive });
};

/**
 * Admin republish any environment
 */
export const adminRepublishEnvironment = async (req: Request, res: Response) => {
  const { id } = req.params;

  const env = await prisma.sharedEnvironment.findUnique({
    where: { id },
  });

  if (!env) {
    throw new AppError(404, 'Shared environment not found');
  }

  if (env.isActive) {
    throw new AppError(400, 'Environment is already active');
  }

  const updated = await prisma.sharedEnvironment.update({
    where: { id },
    data: { isActive: true },
  });

  res.json({ id: updated.id, isActive: updated.isActive });
};

// ============================================
// ENVIRONMENT MANAGEMENT (OWNER)
// ============================================

/**
 * Withdraw/unpublish a shared environment (soft delete)
 */
export const withdrawEnvironment = async (req: Request, res: Response) => {
  const { id } = req.params;

  // Check ownership
  const existing = await prisma.sharedEnvironment.findFirst({
    where: { id, userId: req.user!.id },
  });

  if (!existing) {
    throw new AppError(404, 'Shared environment not found or not owned by you');
  }

  const env = await prisma.sharedEnvironment.update({
    where: { id },
    data: { isActive: false },
    include: {
      user: { select: { id: true, username: true } },
      likes: { where: { userId: req.user!.id }, select: { userId: true } },
      _count: { select: { likes: true } },
    },
  });

  res.json(formatSharedEnvironment(env, req.user!.id));
};

/**
 * Republish a withdrawn environment
 */
export const republishEnvironment = async (req: Request, res: Response) => {
  const { id } = req.params;

  // Check ownership
  const existing = await prisma.sharedEnvironment.findFirst({
    where: { id, userId: req.user!.id },
  });

  if (!existing) {
    throw new AppError(404, 'Shared environment not found or not owned by you');
  }

  const env = await prisma.sharedEnvironment.update({
    where: { id },
    data: { isActive: true },
    include: {
      user: { select: { id: true, username: true } },
      likes: { where: { userId: req.user!.id }, select: { userId: true } },
      _count: { select: { likes: true } },
    },
  });

  res.json(formatSharedEnvironment(env, req.user!.id));
};

/**
 * Update shared environment with versioning
 */
export const updateEnvironmentWithVersion = async (req: Request, res: Response) => {
  const { id } = req.params;
  const data = updateWithVersionSchema.parse(req.body);

  // Check ownership
  const existing = await prisma.sharedEnvironment.findFirst({
    where: { id, userId: req.user!.id },
    include: {
      user: { select: { id: true, username: true } },
    },
  });

  if (!existing) {
    throw new AppError(404, 'Shared environment not found or not owned by you');
  }

  // Validate content size if updating content
  if (data.content) {
    const contentSize = JSON.stringify(data.content).length;
    if (contentSize > 1024 * 1024) {
      throw new AppError(400, 'Environment content exceeds maximum size (1MB)');
    }
  }

  // Handle coexist mode: create a NEW environment, keep original as is
  if (data.versionMode === 'coexist' && data.content) {
    // Create a version snapshot of the original
    await createVersionSnapshot(id, existing.content, 'Versione originale (prima di coesistenza)');

    // Create NEW environment with updated content
    const newEnv = await prisma.sharedEnvironment.create({
      data: {
        title: data.title ?? existing.title,
        description: data.description !== undefined ? data.description : existing.description,
        content: data.content,
        category: (data.category ?? existing.category) as EnvironmentCategory,
        tags: data.tags ?? (existing.tags as string[]),
        includeNotes: existing.includeNotes,
        includeHighlights: existing.includeHighlights,
        userId: req.user!.id,
        currentVersion: existing.currentVersion + 1,
        isActive: true,
        // Link to original via replacedById (new version points to old)
        // This allows tracking the lineage
      },
      include: {
        user: { select: { id: true, username: true } },
        likes: { where: { userId: req.user!.id }, select: { userId: true } },
        _count: { select: { likes: true } },
      },
    });

    // Create version snapshot for new environment
    if (data.changelog) {
      await createVersionSnapshot(newEnv.id, data.content, data.changelog);
    }

    // Original environment stays active and unchanged
    // User now has both versions in their "I miei ambienti"

    res.json(formatSharedEnvironment(newEnv, req.user!.id));
    return;
  }

  // Handle replace mode (default): update existing environment in place
  if (data.content) {
    // Save current content as a version before replacing
    await createVersionSnapshot(id, existing.content, 'Versione precedente');
  }

  const updateData: any = {
    ...(data.title !== undefined && { title: data.title }),
    ...(data.description !== undefined && { description: data.description }),
    ...(data.category !== undefined && { category: data.category as EnvironmentCategory }),
    ...(data.tags !== undefined && { tags: data.tags }),
  };

  if (data.content) {
    updateData.content = data.content;
    updateData.currentVersion = existing.currentVersion + 1;
  }

  const env = await prisma.sharedEnvironment.update({
    where: { id },
    data: updateData,
    include: {
      user: { select: { id: true, username: true } },
      likes: { where: { userId: req.user!.id }, select: { userId: true } },
      _count: { select: { likes: true } },
    },
  });

  // Create new version snapshot with changelog
  if (data.content && data.changelog) {
    await createVersionSnapshot(id, data.content, data.changelog);
  }

  res.json(formatSharedEnvironment(env, req.user!.id));
};

// ============================================
// SUGGESTIONS
// ============================================

/**
 * Create a suggestion for a shared environment
 */
export const createSuggestion = async (req: Request, res: Response) => {
  const { id } = req.params;
  const data = createSuggestionSchema.parse(req.body);

  // Check environment exists and is active
  const env = await prisma.sharedEnvironment.findFirst({
    where: { id, isActive: true },
  });

  if (!env) {
    throw new AppError(404, 'Shared environment not found or not active');
  }

  // Can't suggest to own environment
  if (env.userId === req.user!.id) {
    throw new AppError(400, 'You cannot suggest to your own environment');
  }

  // Check if user already has a pending suggestion for this environment
  const existingPending = await prisma.environmentSuggestion.findFirst({
    where: {
      sharedEnvironmentId: id,
      suggesterId: req.user!.id,
      status: 'pending',
    },
  });

  if (existingPending) {
    throw new AppError(400, 'You already have a pending suggestion for this environment');
  }

  // Validate content size
  const contentSize = JSON.stringify(data.content).length;
  if (contentSize > 512 * 1024) {
    throw new AppError(400, 'Suggestion content exceeds maximum size (512KB)');
  }

  const suggestion = await prisma.environmentSuggestion.create({
    data: {
      sharedEnvironmentId: id,
      suggesterId: req.user!.id,
      content: data.content,
      message: data.message,
    },
    include: {
      suggester: { select: { id: true, username: true } },
      sharedEnvironment: {
        select: {
          id: true,
          title: true,
          user: { select: { id: true, username: true } },
        },
      },
    },
  });

  res.status(201).json(formatSuggestion(suggestion, req.user!.id));
};

/**
 * Get suggestions received for user's environments
 */
export const getReceivedSuggestions = async (req: Request, res: Response) => {
  const status = req.query.status as SuggestionStatus | undefined;

  const where: any = {
    sharedEnvironment: {
      userId: req.user!.id,
    },
  };

  if (status) {
    where.status = status;
  }

  const suggestions = await prisma.environmentSuggestion.findMany({
    where,
    include: {
      suggester: { select: { id: true, username: true } },
      sharedEnvironment: {
        select: {
          id: true,
          title: true,
          user: { select: { id: true, username: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json(suggestions.map(s => formatSuggestion(s, req.user!.id)));
};

/**
 * Get suggestions sent by current user
 */
export const getSentSuggestions = async (req: Request, res: Response) => {
  const suggestions = await prisma.environmentSuggestion.findMany({
    where: {
      suggesterId: req.user!.id,
    },
    include: {
      suggester: { select: { id: true, username: true } },
      sharedEnvironment: {
        select: {
          id: true,
          title: true,
          user: { select: { id: true, username: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json(suggestions.map(s => formatSuggestion(s, req.user!.id)));
};

/**
 * Get count of pending suggestions for user's environments
 */
export const getPendingSuggestionsCount = async (req: Request, res: Response) => {
  const count = await prisma.environmentSuggestion.count({
    where: {
      sharedEnvironment: {
        userId: req.user!.id,
      },
      status: 'pending',
    },
  });

  res.json({ count });
};

/**
 * Approve a suggestion (creates new version)
 */
export const approveSuggestion = async (req: Request, res: Response) => {
  const { suggestionId } = req.params;
  const data = approveSuggestionSchema.parse(req.body);

  // Get suggestion with environment
  const suggestion = await prisma.environmentSuggestion.findUnique({
    where: { id: suggestionId },
    include: {
      sharedEnvironment: {
        include: {
          user: { select: { id: true, username: true } },
        },
      },
      suggester: { select: { id: true, username: true } },
    },
  });

  if (!suggestion) {
    throw new AppError(404, 'Suggestion not found');
  }

  // Check ownership of the environment
  if (suggestion.sharedEnvironment.userId !== req.user!.id) {
    throw new AppError(403, 'You can only approve suggestions for your own environments');
  }

  // Check suggestion is pending
  if (suggestion.status !== 'pending') {
    throw new AppError(400, 'This suggestion has already been reviewed');
  }

  const env = suggestion.sharedEnvironment;
  const existingContent = env.content as any;
  const suggestedContent = suggestion.content as any;

  // Create version snapshot of current state
  await createVersionSnapshot(env.id, existingContent, 'Prima del suggerimento');

  // Merge or replace content
  let newContent: any;
  if (data.mergeMode === 'merge') {
    newContent = {
      ...existingContent,
      dossiers: mergeContentArrays(existingContent.dossiers || [], suggestedContent.dossiers || []),
      quickNorms: mergeContentArrays(existingContent.quickNorms || [], suggestedContent.quickNorms || []),
      customAliases: mergeContentArrays(existingContent.customAliases || [], suggestedContent.customAliases || []),
    };
  } else {
    newContent = {
      ...existingContent,
      dossiers: suggestedContent.dossiers || [],
      quickNorms: suggestedContent.quickNorms || [],
      customAliases: suggestedContent.customAliases || [],
    };
  }

  // Update suggestion status
  await prisma.environmentSuggestion.update({
    where: { id: suggestionId },
    data: {
      status: 'approved',
      reviewedAt: new Date(),
      reviewNote: data.changelog,
    },
  });

  // Update environment with new content
  const changelog = data.changelog || `Approvato suggerimento da @${suggestion.suggester.username}`;

  const updatedEnv = await prisma.sharedEnvironment.update({
    where: { id: env.id },
    data: {
      content: newContent,
      currentVersion: env.currentVersion + 1,
    },
    include: {
      user: { select: { id: true, username: true } },
      likes: { where: { userId: req.user!.id }, select: { userId: true } },
      _count: { select: { likes: true } },
    },
  });

  // Create new version with reference to suggestion
  await createVersionSnapshot(env.id, newContent, changelog, suggestionId);

  res.json(formatSharedEnvironment(updatedEnv, req.user!.id));
};

/**
 * Reject a suggestion
 */
export const rejectSuggestion = async (req: Request, res: Response) => {
  const { suggestionId } = req.params;
  const data = rejectSuggestionSchema.parse(req.body);

  // Get suggestion with environment
  const suggestion = await prisma.environmentSuggestion.findUnique({
    where: { id: suggestionId },
    include: {
      sharedEnvironment: true,
    },
  });

  if (!suggestion) {
    throw new AppError(404, 'Suggestion not found');
  }

  // Check ownership of the environment
  if (suggestion.sharedEnvironment.userId !== req.user!.id) {
    throw new AppError(403, 'You can only reject suggestions for your own environments');
  }

  // Check suggestion is pending
  if (suggestion.status !== 'pending') {
    throw new AppError(400, 'This suggestion has already been reviewed');
  }

  await prisma.environmentSuggestion.update({
    where: { id: suggestionId },
    data: {
      status: 'rejected',
      reviewedAt: new Date(),
      reviewNote: data.reviewNote,
    },
  });

  res.json({ message: 'Suggestion rejected' });
};

// ============================================
// VERSIONING
// ============================================

/**
 * Get version history for an environment
 */
export const getVersions = async (req: Request, res: Response) => {
  const { id } = req.params;

  // Check environment exists
  const env = await prisma.sharedEnvironment.findUnique({
    where: { id },
  });

  if (!env) {
    throw new AppError(404, 'Shared environment not found');
  }

  const versions = await prisma.sharedEnvironmentVersion.findMany({
    where: { sharedEnvironmentId: id },
    include: {
      suggestion: {
        select: {
          id: true,
          suggester: { select: { id: true, username: true } },
        },
      },
    },
    orderBy: { version: 'desc' },
  });

  res.json(versions.map(v => ({
    id: v.id,
    version: v.version,
    changelog: v.changelog,
    suggestion: v.suggestion ? {
      id: v.suggestion.id,
      suggester: v.suggestion.suggester,
    } : undefined,
    createdAt: v.createdAt,
  })));
};

/**
 * Restore a previous version
 */
export const restoreVersion = async (req: Request, res: Response) => {
  const { id, versionId } = req.params;

  // Check ownership
  const env = await prisma.sharedEnvironment.findFirst({
    where: { id, userId: req.user!.id },
  });

  if (!env) {
    throw new AppError(404, 'Shared environment not found or not owned by you');
  }

  // Get the version to restore
  const version = await prisma.sharedEnvironmentVersion.findFirst({
    where: { id: versionId, sharedEnvironmentId: id },
  });

  if (!version) {
    throw new AppError(404, 'Version not found');
  }

  // Create snapshot of current state before restoring
  await createVersionSnapshot(id, env.content, 'Prima del ripristino');

  // Restore the content
  const updatedEnv = await prisma.sharedEnvironment.update({
    where: { id },
    data: {
      content: version.content as object,
      currentVersion: env.currentVersion + 1,
    },
    include: {
      user: { select: { id: true, username: true } },
      likes: { where: { userId: req.user!.id }, select: { userId: true } },
      _count: { select: { likes: true } },
    },
  });

  // Create version entry for the restore
  await createVersionSnapshot(id, version.content, `Ripristinato alla versione ${version.version}`);

  res.json(formatSharedEnvironment(updatedEnv, req.user!.id));
};
