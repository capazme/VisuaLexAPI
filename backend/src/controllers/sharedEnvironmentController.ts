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

// Suggestion schemas
const MAX_ITEMS_PER_SUGGESTION = 100;
const MAX_SUGGESTION_BYTES = 512 * 1024;

const suggestionItemSchema = z.object({
  itemType: z.enum(['annotation', 'highlight', 'dossier', 'quickNorm', 'alias']),
  payload: z.unknown(),
});

const createSuggestionSchema = z.object({
  message: z.string().max(1000).optional(),
  items: z.array(suggestionItemSchema).min(1).max(MAX_ITEMS_PER_SUGGESTION),
});

const addSuggestionItemsSchema = z.object({
  items: z.array(suggestionItemSchema).min(1).max(MAX_ITEMS_PER_SUGGESTION),
});

const declineItemSchema = z.object({
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
type ItemStatusCounts = { pending: number; taken: number; declined: number };

function deriveSuggestionStatus(counts: ItemStatusCounts): 'open' | 'closed' | 'revoked' {
  const total = counts.pending + counts.taken + counts.declined;
  if (total === 0) return 'revoked';
  if (counts.pending > 0) return 'open';
  return 'closed';
}

function formatSuggestion(suggestion: any, currentUserId: string) {
  const items = (suggestion.items ?? []) as Array<{
    id: string;
    itemType: string;
    payload: unknown;
    status: 'pending' | 'taken' | 'declined';
    reviewNote: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
  }>;

  const counts: ItemStatusCounts = { pending: 0, taken: 0, declined: 0 };
  for (const i of items) counts[i.status] += 1;

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
    message: suggestion.message,
    items: items.map(i => ({
      id: i.id,
      itemType: i.itemType,
      payload: i.payload,
      status: i.status,
      reviewNote: i.reviewNote,
      reviewedAt: i.reviewedAt,
      createdAt: i.createdAt,
    })),
    counts,
    aggregateStatus: deriveSuggestionStatus(counts),
    createdAt: suggestion.createdAt,
    updatedAt: suggestion.updatedAt,
    isOwn: suggestion.suggesterId === currentUserId,
  };
}

// Helper: create a new version snapshot
async function createVersionSnapshot(
  envId: string,
  content: any,
  changelog?: string,
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
    },
  });
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

  const env = await prisma.sharedEnvironment.findFirst({
    where: { id, isActive: true },
  });
  if (!env) throw new AppError(404, 'Shared environment not found or not active');
  if (env.userId === req.user!.id) {
    throw new AppError(400, 'You cannot suggest to your own environment');
  }

  const existingOpen = await prisma.environmentSuggestion.findFirst({
    where: {
      sharedEnvironmentId: id,
      suggesterId: req.user!.id,
      items: { some: { status: 'pending' } },
    },
  });
  if (existingOpen) {
    throw new AppError(400, 'You already have an open suggestion for this environment');
  }

  const totalBytes = JSON.stringify(data.items).length;
  if (totalBytes > MAX_SUGGESTION_BYTES) {
    throw new AppError(400, 'Suggestion payload exceeds maximum size (512KB)');
  }

  const suggestion = await prisma.environmentSuggestion.create({
    data: {
      sharedEnvironmentId: id,
      suggesterId: req.user!.id,
      message: data.message,
      items: {
        create: data.items.map(i => ({
          itemType: i.itemType,
          payload: i.payload as object,
        })),
      },
    },
    include: {
      items: true,
      suggester: { select: { id: true, username: true } },
      sharedEnvironment: {
        select: { id: true, title: true, user: { select: { id: true, username: true } } },
      },
    },
  });

  res.status(201).json(formatSuggestion(suggestion, req.user!.id));
};

/**
 * Get suggestions received for user's environments
 */
export const getReceivedSuggestions = async (req: Request, res: Response) => {
  const statusFilter = req.query.status as 'open' | 'closed' | 'revoked' | undefined;

  const suggestions = await prisma.environmentSuggestion.findMany({
    where: { sharedEnvironment: { userId: req.user!.id } },
    include: {
      items: true,
      suggester: { select: { id: true, username: true } },
      sharedEnvironment: {
        select: { id: true, title: true, user: { select: { id: true, username: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  let formatted = suggestions.map(s => formatSuggestion(s, req.user!.id));
  if (statusFilter) {
    formatted = formatted.filter(s => s.aggregateStatus === statusFilter);
  }
  res.json(formatted);
};

/**
 * Get suggestions sent by current user
 */
export const getSentSuggestions = async (req: Request, res: Response) => {
  const suggestions = await prisma.environmentSuggestion.findMany({
    where: { suggesterId: req.user!.id },
    include: {
      items: true,
      suggester: { select: { id: true, username: true } },
      sharedEnvironment: {
        select: { id: true, title: true, user: { select: { id: true, username: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json(suggestions.map(s => formatSuggestion(s, req.user!.id)));
};

/**
 * Get count of pending suggestion items for user's environments
 */
export const getPendingSuggestionsCount = async (req: Request, res: Response) => {
  const count = await prisma.suggestionItem.count({
    where: {
      status: 'pending',
      suggestion: { sharedEnvironment: { userId: req.user!.id } },
    },
  });
  res.json({ count });
};

/**
 * Take a suggestion item — lands it in the owner's private workspace
 */
export const takeSuggestionItem = async (req: Request, res: Response) => {
  const { id: suggestionId, itemId } = req.params;

  const item = await prisma.suggestionItem.findUnique({
    where: { id: itemId },
    include: {
      suggestion: {
        include: {
          sharedEnvironment: true,
          suggester: { select: { id: true, username: true } },
        },
      },
    },
  });

  if (!item || item.suggestion.id !== suggestionId) {
    throw new AppError(404, 'Suggestion item not found');
  }
  if (item.suggestion.sharedEnvironment.userId !== req.user!.id) {
    throw new AppError(403, 'You can only take items from suggestions to your own environments');
  }
  if (item.status !== 'pending') {
    throw new AppError(409, 'Item already reviewed');
  }

  const attribution = {
    sourceSuggestionId: item.suggestion.id,
    originalAuthorId: item.suggestion.suggesterId,
  };

  let createdRow: unknown = null;
  try {
    createdRow = await prisma.$transaction(async (tx) => {
      const payload = item.payload as any;
      switch (item.itemType) {
        case 'annotation':
          return tx.annotation.create({
            data: {
              userId: req.user!.id,
              normaKey: payload.articleId ?? payload.normaKey ?? '',
              content: payload.text,
              textContext: payload.anchorText,
              position: payload.startOffset,
              ...attribution,
            },
          });
        case 'highlight':
          return tx.highlight.create({
            data: {
              userId: req.user!.id,
              normaKey: payload.articleId ?? payload.normaKey ?? '',
              text: payload.anchorText ?? '',
              color: payload.colorVar ?? 'yellow',
              startOffset: payload.startOffset ?? 0,
              endOffset: payload.endOffset ?? 0,
              ...attribution,
            },
          });
        case 'dossier': {
          const entries = Array.isArray(payload.entries) ? payload.entries : [];
          return tx.dossier.create({
            data: {
              userId: req.user!.id,
              name: payload.title,
              description: payload.description,
              ...attribution,
              items: {
                create: entries.map((e: any, idx: number) => ({
                  itemType: e.articleRef ? 'norm' : 'note',
                  title: e.articleRef?.label ?? e.note?.slice(0, 60) ?? `Item ${idx + 1}`,
                  content: e,
                  position: idx,
                })),
              },
            },
            include: { items: true },
          });
        }
        case 'quickNorm':
          return tx.quickNorm.create({
            data: {
              userId: req.user!.id,
              label: payload.label,
              searchParams: payload.searchParams,
              sourceUrl: payload.sourceUrl,
              ...attribution,
            },
          });
        case 'alias':
          return tx.customAlias.create({
            data: {
              userId: req.user!.id,
              trigger: payload.trigger,
              aliasType: payload.aliasType,
              expandTo: payload.expandTo,
              searchParams: payload.searchParams,
              description: payload.description,
              ...attribution,
            },
          });
        default:
          throw new AppError(400, `Unsupported itemType: ${item.itemType}`);
      }
    });
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'P2002' &&
      item.itemType === 'alias'
    ) {
      const existing = await prisma.customAlias.findFirst({
        where: {
          userId: req.user!.id,
          trigger: (item.payload as any).trigger,
        },
      });
      res.status(409).json({
        error: 'alias_trigger_conflict',
        existingAliasId: existing?.id,
        suggestedTrigger: (item.payload as any).trigger,
      });
      return;
    }
    throw err;
  }

  await prisma.suggestionItem.update({
    where: { id: itemId },
    data: { status: 'taken', reviewedAt: new Date() },
  });

  res.json({ item: { id: itemId, status: 'taken' }, created: createdRow });
};

/**
 * Decline a suggestion item
 */
export const declineSuggestionItem = async (req: Request, res: Response) => {
  const { id: suggestionId, itemId } = req.params;
  const data = declineItemSchema.parse(req.body);

  const item = await prisma.suggestionItem.findUnique({
    where: { id: itemId },
    include: { suggestion: { include: { sharedEnvironment: true } } },
  });

  if (!item || item.suggestion.id !== suggestionId) {
    throw new AppError(404, 'Suggestion item not found');
  }
  if (item.suggestion.sharedEnvironment.userId !== req.user!.id) {
    throw new AppError(403, 'You can only decline items from suggestions to your own environments');
  }
  if (item.status !== 'pending') {
    throw new AppError(409, 'Item already reviewed');
  }

  const updated = await prisma.suggestionItem.update({
    where: { id: itemId },
    data: { status: 'declined', reviewNote: data.reviewNote, reviewedAt: new Date() },
  });

  res.json({
    id: updated.id,
    status: updated.status,
    reviewNote: updated.reviewNote,
    reviewedAt: updated.reviewedAt,
  });
};

/**
 * Revoke a suggestion item (suggester-only, pending-only)
 */
export const revokeSuggestionItem = async (req: Request, res: Response) => {
  const { id: suggestionId, itemId } = req.params;

  const item = await prisma.suggestionItem.findUnique({
    where: { id: itemId },
    include: { suggestion: true },
  });

  if (!item || item.suggestion.id !== suggestionId) {
    throw new AppError(404, 'Suggestion item not found');
  }
  if (item.suggestion.suggesterId !== req.user!.id) {
    throw new AppError(403, 'You can only revoke your own suggestion items');
  }
  if (item.status !== 'pending') {
    throw new AppError(403, 'Only pending items can be revoked');
  }

  await prisma.suggestionItem.delete({ where: { id: itemId } });
  res.status(204).send();
};

/**
 * Add items to an existing open suggestion thread (suggester-only)
 */
export const addSuggestionItems = async (req: Request, res: Response) => {
  const { id: suggestionId } = req.params;
  const data = addSuggestionItemsSchema.parse(req.body);

  const suggestion = await prisma.environmentSuggestion.findUnique({
    where: { id: suggestionId },
    include: { items: true },
  });

  if (!suggestion) throw new AppError(404, 'Suggestion not found');
  if (suggestion.suggesterId !== req.user!.id) {
    throw new AppError(403, 'You can only add items to your own suggestions');
  }

  const pendingCount = suggestion.items.filter(i => i.status === 'pending').length;
  const reviewedCount = suggestion.items.length - pendingCount;
  if (pendingCount === 0 && reviewedCount > 0) {
    throw new AppError(409, 'Thread is closed — create a new suggestion');
  }

  if (suggestion.items.length + data.items.length > MAX_ITEMS_PER_SUGGESTION) {
    throw new AppError(400, 'Maximum items per suggestion exceeded');
  }

  await prisma.suggestionItem.createMany({
    data: data.items.map(i => ({
      suggestionId,
      itemType: i.itemType,
      payload: i.payload as object,
    })),
  });

  const refreshed = await prisma.environmentSuggestion.findUnique({
    where: { id: suggestionId },
    include: {
      items: true,
      suggester: { select: { id: true, username: true } },
      sharedEnvironment: {
        select: { id: true, title: true, user: { select: { id: true, username: true } } },
      },
    },
  });

  res.status(201).json(formatSuggestion(refreshed!, req.user!.id));
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
    orderBy: { version: 'desc' },
  });

  res.json(versions.map(v => ({
    id: v.id,
    version: v.version,
    changelog: v.changelog,
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
