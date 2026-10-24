import { Request, Response } from 'express';
import { Prisma, EnvironmentCategory, ReportReason } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import { dossierItemFromEntry, rebuildDossierPayload, type EntryItem } from '../utils/suggestionEntries';
import { publishedContent, readableContent, type PublishedContent } from '../utils/publishedContent';
import { importStudyDossiers, spendStudyImport, wireNormaKey } from '../services/studyImport';

// Rate limiting: max 5 publications per day per user
const DAILY_PUBLISH_LIMIT = 5;

const NOT_FOUND = 'Elemento del Forum non trovato';
const NOT_FOUND_OR_NOT_YOURS = 'Elemento del Forum non trovato o non tuo';

/**
 * A Forum item as someone may reach it: a withdrawn one exists only for its owner and the
 * admin (D7). Everyone else gets the same 404 as for an item that never existed.
 */
async function reachableEnvironment(id: string, user: { id: string; isAdmin?: boolean }) {
  const env = await prisma.sharedEnvironment.findUnique({ where: { id } });
  if (!env || (!env.isActive && env.userId !== user.id && !user.isAdmin)) throw new AppError(404, NOT_FOUND);
  return env;
}

/** The content of an item published from a dossier: one dossier, named as the Forum item is. */
function asDossierPublication(
  content: PublishedContent,
  fields: { title: string; description: string | null | undefined; tags: string[] },
  switches: { includeNotes: boolean; includeHighlights: boolean },
): PublishedContent {
  if (content.dossiers.length !== 1) throw new AppError(400, 'Un dossier pubblicato contiene un solo dossier.');
  if (content.quickNorms.length > 0 || (content.customAliases?.length ?? 0) > 0) {
    throw new AppError(400, 'Un dossier pubblicato non contiene norme rapide né alias.');
  }
  if (!switches.includeNotes && content.annotations.length > 0) {
    throw new AppError(400, 'Le note sono escluse, ma il contenuto ne porta.');
  }
  if (!switches.includeHighlights && content.highlights.length > 0) {
    throw new AppError(400, 'Le evidenziazioni sono escluse, ma il contenuto ne porta.');
  }
  // The dossier inside is named by what the dialog showed, never by the private dossier's name.
  const [dossier] = content.dossiers;
  const named: Record<string, unknown> = { ...dossier, title: fields.title, tags: fields.tags };
  if (fields.description) named.description = fields.description;
  else delete named.description;
  return { dossiers: [named], quickNorms: [], annotations: content.annotations, highlights: content.highlights };
}

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
const ALREADY_PUBLISHED = 'Questo dossier è già pubblicato nel Forum: aggiornane la versione pubblicata.';
const DOSSIER_BLOCKED = "L'amministrazione ha ritirato questo dossier dal Forum: non puoi ripubblicarlo.";

// Validation schemas
const publishEnvironmentSchema = z.object({
  title: z.string().min(3).max(100),
  description: z.string().max(500).optional(),
  content: z.object({
    dossiers: z.array(z.any()),
    quickNorms: z.array(z.any()),
    customAliases: z.array(z.any()).optional(),
    annotations: z.array(z.any()),
    highlights: z.array(z.any()),
  }),
  category: z.enum(['compliance', 'civil', 'penal', 'administrative', 'eu', 'other']),
  tags: z.array(z.string().max(30)).max(10).optional(),
  includeNotes: z.boolean().optional(),
  includeHighlights: z.boolean().optional(),
  // The dossier it is published from: the caller's own; never changed afterwards.
  sourceDossierId: z.string().min(1).max(64).optional(),
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
  payload: z.unknown().optional(),
});

const createSuggestionSchema = z.object({
  message: z.string().max(1000).optional(),
  items: z.array(suggestionItemSchema).min(1).max(MAX_ITEMS_PER_SUGGESTION),
});

const addSuggestionItemsSchema = z.object({
  items: z.array(suggestionItemSchema).min(1).max(MAX_ITEMS_PER_SUGGESTION),
});

/**
 * The items of a proposal as they are stored: a dossier's entries rebuilt from closed values
 * (`rebuildDossierPayload`), so a proposer's free text never reaches a citation its owner reads;
 * a refused entry refuses the proposal with the entry, the field and why.
 */
function storableSuggestionItems(items: z.infer<typeof suggestionItemSchema>[]) {
  return items.map((i) => {
    if (i.itemType !== 'dossier') return { itemType: i.itemType, payload: i.payload as Prisma.InputJsonValue };
    const rebuilt = rebuildDossierPayload(i.payload);
    if (!rebuilt.ok) throw new AppError(400, `${rebuilt.reason}: la proposta non può essere salvata`);
    return { itemType: i.itemType, payload: rebuilt.payload };
  });
}

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

  const isOwner = env.userId === userId;
  return {
    id: env.id,
    title: env.title,
    description: env.description,
    // Never the stored JSON as it is: only what the allow-list lets through (D6).
    content: publishedContent(env.content, 'read'),
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
    isOwner,
    // The owner's alone: the dossier it came from, and whether the admin withdrew it.
    sourceDossierId: isOwner ? env.sourceDossierId ?? null : undefined,
    withdrawnByAdmin: isOwner ? env.withdrawnByAdminAt != null : undefined,
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
    // A withdrawn item's name and author are its owner's alone (D7): the proposer gets nothing of it
    // (the web already reads the field as optional).
    sharedEnvironment: suggestion.sharedEnvironment
      && !(suggestion.sharedEnvironment.isActive === false && suggestion.sharedEnvironment.user?.id !== currentUserId)
      ? { id: suggestion.sharedEnvironment.id, title: suggestion.sharedEnvironment.title, user: suggestion.sharedEnvironment.user }
      : undefined,
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
  client: Prisma.TransactionClient,
  envId: string,
  content: any,
  changelog?: string,
) {
  // Get next version number
  const latestVersion = await client.sharedEnvironmentVersion.findFirst({
    where: { sharedEnvironmentId: envId },
    orderBy: { version: 'desc' },
  });

  const nextVersion = (latestVersion?.version ?? 0) + 1;

  return client.sharedEnvironmentVersion.create({
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

  const where: any = { isActive: true };

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

  await reachableEnvironment(id, req.user!);
  const env = await prisma.sharedEnvironment.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, username: true } },
      likes: { where: { userId: req.user!.id }, select: { userId: true } },
      _count: { select: { likes: true } },
    },
  });

  if (!env) {
    throw new AppError(404, NOT_FOUND);
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
  let content = publishedContent(data.content, 'publish');
  if (data.sourceDossierId) {
    // The caller's own dossier, or the same 404 as for one that does not exist.
    const source = await prisma.dossier.findFirst({ where: { id: data.sourceDossierId, userId: req.user!.id }, select: { id: true, forumBlockedAt: true } });
    if (!source) throw new AppError(404, 'Dossier non trovato');
    if (source.forumBlockedAt) throw new AppError(403, DOSSIER_BLOCKED);
    if (await prisma.sharedEnvironment.count({ where: { sourceDossierId: source.id } })) throw new AppError(409, ALREADY_PUBLISHED);
    content = asDossierPublication(
      content,
      { title: data.title, description: data.description, tags: data.tags ?? [] },
      { includeNotes: data.includeNotes ?? true, includeHighlights: data.includeHighlights ?? true },
    );
  }

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
    throw new AppError(429, `Puoi pubblicare al massimo ${DAILY_PUBLISH_LIMIT} dossier al giorno: riprova domani.`);
  }

  // Validate content size (max 1MB)
  const contentSize = JSON.stringify(content).length;
  if (contentSize > 1024 * 1024) {
    throw new AppError(400, 'Il contenuto supera la dimensione massima (1 MB).');
  }

  let env;
  try {
    env = await prisma.sharedEnvironment.create({
      data: {
        title: data.title,
        description: data.description,
        content: content as unknown as Prisma.InputJsonValue,
        category: data.category as EnvironmentCategory,
        tags: data.tags || [],
        includeNotes: data.includeNotes ?? true,
        includeHighlights: data.includeHighlights ?? true,
        sourceDossierId: data.sourceDossierId ?? null,
        userId: req.user!.id,
      },
      include: {
        user: { select: { id: true, username: true } },
        _count: { select: { likes: true } },
      },
    });
  } catch (err) {
    // Two publications of one dossier at once: the unique index lets one through.
    if (isUniqueViolation(err)) throw new AppError(409, ALREADY_PUBLISHED);
    // The dossier went to the trash between the check and the write.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') throw new AppError(404, 'Dossier non trovato');
    throw err;
  }

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
    throw new AppError(404, NOT_FOUND_OR_NOT_YOURS);
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
    throw new AppError(404, NOT_FOUND_OR_NOT_YOURS);
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

  await reachableEnvironment(id, req.user!);

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
const downloadSwitchesSchema = z.object({ addNotes: z.boolean(), addHighlights: z.boolean() });

export const recordDownload = async (req: Request, res: Response) => {
  const { id } = req.params;

  const env = await reachableEnvironment(id, req.user!);

  // «Aggiungi ai miei dossier» (D8): with the two switches in the body, the item becomes the user's study
  // dossiers in one request. Without a body an older client gets the content, as before.
  const body = req.body as Record<string, unknown> | undefined;
  if (body && typeof body === 'object' && ('addNotes' in body || 'addHighlights' in body)) {
    const switches = downloadSwitchesSchema.parse(body);
    await spendStudyImport(req.user!.id);
    const own = env.userId === req.user!.id;
    const { content, refused } = readableContent(env.content);
    const report = await importStudyDossiers(req.user!.id, content, {
      addNotes: switches.addNotes && env.includeNotes,
      addHighlights: switches.addHighlights && env.includeHighlights,
      addShortcuts: true,
      // The publisher's, for the «da @utente» chip; one's own item is one's own work.
      attributeTo: own ? null : env.userId,
      refused,
      // Counted with the rows, so a failure cannot answer 500 after the dossiers exist.
      alsoInTransaction: own ? undefined : (tx) => tx.sharedEnvironment.update({ where: { id }, data: { downloadCount: { increment: 1 } } }),
    });
    res.status(201).json(report);
    return;
  }

  // Increment download count (don't count own downloads)
  if (env.userId !== req.user!.id) {
    await prisma.sharedEnvironment.update({
      where: { id },
      data: { downloadCount: { increment: 1 } },
    });
  }

  res.json({
    content: publishedContent(env.content, 'read'),
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

  const env = await reachableEnvironment(id, req.user!);

  // Can't report own environment
  if (env.userId === req.user!.id) {
    throw new AppError(400, 'Non puoi segnalare un tuo elemento.');
  }

  // Check if already reported
  const existingReport = await prisma.sharedEnvironmentReport.findUnique({
    where: {
      envId_userId: { envId: id, userId: req.user!.id },
    },
  });

  if (existingReport) {
    throw new AppError(400, 'Hai già segnalato questo elemento.');
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

  let report;
  try {
    report = await prisma.sharedEnvironmentReport.update({
      where: { id },
      data: { status },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new AppError(404, 'Report not found');
    }
    throw err;
  }

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
    throw new AppError(404, NOT_FOUND);
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
    throw new AppError(404, NOT_FOUND);
  }

  // Stamped: its author cannot republish what the admin withdrew (owner, 14 October 2026, question 190) —
  // also when the author had withdrawn it first, else the author could put it back. The dossier it came
  // from is stamped too, so deleting this copy and publishing the dossier again does not undo it.
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.sharedEnvironment.update({
      where: { id },
      data: { isActive: false, withdrawnByAdminAt: env.withdrawnByAdminAt ?? now },
    });
    // Both, whatever the link said when it was read: the dossier may have gone to the trash meanwhile
    // (the link is cleared there). The block then goes into the trash entry, and comes back with the
    // dossier on restore. Each statement is idempotent.
    if (env.sourceDossierId) {
      await tx.dossier.updateMany({ where: { id: env.sourceDossierId, forumBlockedAt: null }, data: { forumBlockedAt: now } });
    }
    await tx.$executeRaw`
      UPDATE "trash_entries"
      SET "payload" = jsonb_set("payload", '{dossier,forumBlockedAt}', to_jsonb(${now.toISOString()}::text))
      WHERE "user_id" = ${env.userId} AND "kind" = 'DOSSIER'
        AND "payload"->>'publishedCopyId' = ${env.id}
        AND ("payload"->'dossier'->>'forumBlockedAt') IS NULL`;
    return row;
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
    throw new AppError(404, NOT_FOUND);
  }

  if (env.isActive) {
    throw new AppError(400, "L'elemento è già pubblicato.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.sharedEnvironment.update({
      where: { id },
      data: { isActive: true, withdrawnByAdminAt: null },
    });
    if (env.sourceDossierId) await tx.dossier.updateMany({ where: { id: env.sourceDossierId }, data: { forumBlockedAt: null } });
    // Its dossier in the trash comes back unblocked too.
    await tx.$executeRaw`
      UPDATE "trash_entries" SET "payload" = jsonb_set("payload", '{dossier,forumBlockedAt}', 'null'::jsonb)
      WHERE "user_id" = ${env.userId} AND "kind" = 'DOSSIER' AND "payload"->>'publishedCopyId' = ${env.id}`;
    return row;
  });

  res.json({ id: updated.id, isActive: updated.isActive });
};

/**
 * Dossiers whose copy the admin withdrew (question 190): they cannot be published again until the
 * admin allows it — also after their owner deleted that copy. The dossier's name is private, so
 * the list names the owner and the date only.
 */
export const adminListForumBlocks = async (_req: Request, res: Response) => {
  const blocked = await prisma.dossier.findMany({
    where: { forumBlockedAt: { not: null } },
    select: { id: true, forumBlockedAt: true, user: { select: { id: true, username: true } }, publishedCopy: { select: { id: true, title: true } } },
    orderBy: { forumBlockedAt: 'desc' },
  });
  res.json(blocked.map((d) => ({ dossierId: d.id, blockedAt: d.forumBlockedAt, owner: d.user, publishedCopy: d.publishedCopy })));
};

/** The admin allows a blocked dossier to be published again. */
export const adminClearForumBlock = async (req: Request, res: Response) => {
  const { dossierId } = req.params;
  const [cleared, inTrash] = await prisma.$transaction([
    prisma.dossier.updateMany({ where: { id: dossierId, forumBlockedAt: { not: null } }, data: { forumBlockedAt: null } }),
    // A blocked dossier in the trash comes back unblocked.
    prisma.$executeRaw`
      UPDATE "trash_entries" SET "payload" = jsonb_set("payload", '{dossier,forumBlockedAt}', 'null'::jsonb)
      WHERE "kind" = 'DOSSIER' AND "payload"->'dossier'->>'id' = ${dossierId}
        AND ("payload"->'dossier'->>'forumBlockedAt') IS NOT NULL`,
  ]);
  if (cleared.count === 0 && inTrash === 0) throw new AppError(404, 'Nessun blocco per questo dossier.');
  res.status(204).send();
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
    throw new AppError(404, NOT_FOUND_OR_NOT_YOURS);
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
    throw new AppError(404, NOT_FOUND_OR_NOT_YOURS);
  }
  if (existing.withdrawnByAdminAt) {
    throw new AppError(403, "Questo elemento è stato ritirato dall'amministrazione: non puoi ripubblicarlo.");
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
  let content = data.content ? publishedContent(data.content, 'update') : undefined;

  // Check ownership
  const existing = await prisma.sharedEnvironment.findFirst({
    where: { id, userId: req.user!.id },
    include: {
      user: { select: { id: true, username: true } },
    },
  });

  if (!existing) {
    throw new AppError(404, NOT_FOUND_OR_NOT_YOURS);
  }

  // A copy side by side would be a new, active item: never for one the admin withdrew.
  if (existing.withdrawnByAdminAt && data.versionMode === 'coexist' && data.content) {
    throw new AppError(403, "Questo elemento è stato ritirato dall'amministrazione: non puoi ripubblicarlo.");
  }

  // An item published from a dossier stays one dossier, named as the item is: its content is
  // rewritten when its name, description or tags change, even with no new content (no new version).
  let renamedOnly = false;
  // A new version of a dossier carries the notes and highlights its author ticked this time: the two
  // switches follow what it holds (the first publication's choice must not refuse a later note).
  let switches: { includeNotes: boolean; includeHighlights: boolean } | null = null;
  if (existing.sourceDossierId) {
    if (data.versionMode === 'coexist' && data.content) {
      throw new AppError(400, 'Un dossier pubblicato ha una sola versione corrente: aggiornala invece di affiancarne una.');
    }
    const fieldsChange = data.title !== undefined || data.description !== undefined || data.tags !== undefined;
    if (content || fieldsChange) {
      renamedOnly = !content;
      switches = content
        ? { includeNotes: content.annotations.length > 0, includeHighlights: content.highlights.length > 0 }
        : { includeNotes: existing.includeNotes, includeHighlights: existing.includeHighlights };
      content = asDossierPublication(
        content ?? publishedContent(existing.content, 'read'),
        {
          title: data.title ?? existing.title,
          description: data.description !== undefined ? data.description : existing.description,
          tags: data.tags ?? existing.tags,
        },
        switches,
      );
    }
  }

  // Validate content size if updating content
  if (content) {
    const contentSize = JSON.stringify(content).length;
    if (contentSize > 1024 * 1024) {
      throw new AppError(400, 'Il contenuto supera la dimensione massima (1 MB).');
    }
  }

  // Handle coexist mode: create a NEW environment, keep original as is
  if (data.versionMode === 'coexist' && content) {
    const newContent = content as unknown as Prisma.InputJsonValue;
    const newEnv = await prisma.$transaction(async (tx) => {
      // Create a version snapshot of the original
      await createVersionSnapshot(tx, id, existing.content, 'Versione originale (prima di coesistenza)');

      // Create NEW environment with updated content
      const created = await tx.sharedEnvironment.create({
        data: {
          title: data.title ?? existing.title,
          description: data.description !== undefined ? data.description : existing.description,
          content: newContent,
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
        await createVersionSnapshot(tx, created.id, newContent, data.changelog);
      }

      return created;
    });

    // Original environment stays active and unchanged
    // User now has both versions in their "I miei ambienti"

    res.json(formatSharedEnvironment(newEnv, req.user!.id));
    return;
  }

  // Handle replace mode (default): update existing environment in place
  const updateData: any = {
    ...(data.title !== undefined && { title: data.title }),
    ...(data.description !== undefined && { description: data.description }),
    ...(data.category !== undefined && { category: data.category as EnvironmentCategory }),
    ...(data.tags !== undefined && { tags: data.tags }),
  };

  if (content) {
    updateData.content = content;
    // A new name alone is not a new version.
    if (!renamedOnly) updateData.currentVersion = existing.currentVersion + 1;
  }
  if (switches) {
    updateData.includeNotes = switches.includeNotes;
    updateData.includeHighlights = switches.includeHighlights;
  }

  const env = await prisma.$transaction(async (tx) => {
    if (content && !renamedOnly) {
      // Save current content as a version before replacing
      await createVersionSnapshot(tx, id, existing.content, 'Versione precedente');
    }

    const updated = await tx.sharedEnvironment.update({
      where: { id },
      data: updateData,
      include: {
        user: { select: { id: true, username: true } },
        likes: { where: { userId: req.user!.id }, select: { userId: true } },
        _count: { select: { likes: true } },
      },
    });

    // Create new version snapshot with changelog
    if (content && !renamedOnly && data.changelog) {
      await createVersionSnapshot(tx, id, content, data.changelog);
    }

    return updated;
  });

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
  if (!env) throw new AppError(404, NOT_FOUND);
  if (env.userId === req.user!.id) {
    throw new AppError(400, 'Non puoi proporre contenuti a un tuo elemento.');
  }

  const existingOpen = await prisma.environmentSuggestion.findFirst({
    where: {
      sharedEnvironmentId: id,
      suggesterId: req.user!.id,
      items: { some: { status: 'pending' } },
    },
  });
  if (existingOpen) {
    throw new AppError(400, 'Hai già una proposta aperta per questo elemento.');
  }

  const totalBytes = JSON.stringify(data.items).length;
  if (totalBytes > MAX_SUGGESTION_BYTES) {
    throw new AppError(400, 'Suggestion payload exceeds maximum size (512KB)');
  }

  const items = storableSuggestionItems(data.items);

  const suggestion = await prisma.environmentSuggestion.create({
    data: {
      sharedEnvironmentId: id,
      suggesterId: req.user!.id,
      message: data.message,
      items: {
        create: items,
      },
    },
    include: {
      items: true,
      suggester: { select: { id: true, username: true } },
      sharedEnvironment: {
        select: { id: true, title: true, isActive: true, user: { select: { id: true, username: true } } },
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
        select: { id: true, title: true, isActive: true, user: { select: { id: true, username: true } } },
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
        select: { id: true, title: true, isActive: true, user: { select: { id: true, username: true } } },
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
// Rename-on-conflict: same trigger rules as customAliasController's
// createCustomAliasSchema (2+ chars, alphanumeric + dash/underscore/dot).
const TRIGGER_RE = /^[a-zA-Z0-9\-_.]+$/;

export const takeSuggestionItem = async (req: Request, res: Response) => {
  const { id: suggestionId, itemId } = req.params;
  const triggerOverride = (req.body as { triggerOverride?: string } | undefined)?.triggerOverride;
  let normalizedTriggerOverride: string | undefined;
  if (triggerOverride !== undefined) {
    normalizedTriggerOverride = triggerOverride.toLowerCase().trim();
    if (normalizedTriggerOverride.length < 2 || !TRIGGER_RE.test(normalizedTriggerOverride)) {
      throw new AppError(400, 'Invalid triggerOverride: must be at least 2 characters, alphanumeric plus dash/underscore/dot');
    }
  }

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
      // The article view loads notes/highlights by the wire-encoded key
      // `${itemKey}::art::${articleId}` (storeApiMappers.buildWireNormaKey). A
      // raw articleId never matches that prefix query, so a taken note would be
      // invisible in-context. Reconstruct the wire key when the payload carries
      // both parts; fall back to the raw value for legacy payloads (no normaKey).
      // A decision's notes have an empty article id and live under `<decisionKey>::art::` (before
      // 14 October 2026 they were stored under an empty key, invisible).
      const normaKey =
        typeof payload.normaKey === 'string' && payload.normaKey
          ? wireNormaKey(payload.normaKey, typeof payload.articleId === 'string' ? payload.articleId : '')
          : payload.articleId ?? '';
      const row = await (async () => {
        switch (item.itemType) {
          case 'annotation':
            return tx.annotation.create({
              data: {
                userId: req.user!.id,
                normaKey,
                content: payload.text,
                textContext: payload.anchorText,
                position: payload.startOffset,
                ...attribution,
              },
            });
          case 'highlight':
            // A highlight is anchored by its offset: without one it would mark the article's first characters.
            if (typeof payload.startOffset !== 'number' || !Number.isInteger(payload.startOffset) || payload.startOffset < 0) {
              throw new AppError(400, 'Evidenziazione senza posizione nel testo: non può essere aggiunta.');
            }
            return tx.highlight.create({
              data: {
                userId: req.user!.id,
                normaKey,
                text: payload.anchorText ?? '',
                color: payload.colorVar ?? 'yellow',
                startOffset: payload.startOffset,
                // As the web writes it: where the marked text ends.
                endOffset: payload.endOffset ?? payload.startOffset + String(payload.anchorText ?? '').length,
                ...attribution,
              },
            });
          case 'dossier': {
            const entries: unknown[] = Array.isArray(payload.entries) ? payload.entries : [];
            const items: EntryItem[] = [];
            for (const [idx, e] of entries.entries()) {
              const made = dossierItemFromEntry(e, idx);
              // Nothing partial: the transaction rolls back and the item stays pending.
              if (!made.ok) throw new AppError(400, `Voce ${idx + 1}: ${made.reason}: la proposta non è stata applicata`);
              items.push(made.item);
            }
            return tx.dossier.create({
              data: {
                userId: req.user!.id,
                name: payload.title,
                description: payload.description,
                // Someone else's proposal: a topic to study, never one of the owner's practices.
                kind: 'studio',
                ...attribution,
                items: { create: items },
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
                trigger: normalizedTriggerOverride ?? payload.trigger,
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
      })();

      await tx.suggestionItem.update({
        where: { id: itemId },
        data: { status: 'taken', reviewedAt: new Date() },
      });

      return row;
    });
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'P2002' &&
      item.itemType === 'alias'
    ) {
      const conflictingTrigger = normalizedTriggerOverride ?? (item.payload as any).trigger;
      const existing = await prisma.customAlias.findFirst({
        where: {
          userId: req.user!.id,
          trigger: conflictingTrigger,
        },
      });
      res.status(409).json({
        error: 'alias_trigger_conflict',
        existingAliasId: existing?.id,
        suggestedTrigger: conflictingTrigger,
      });
      return;
    }
    throw err;
  }

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
    include: { items: true, sharedEnvironment: { select: { isActive: true } } },
  });

  if (!suggestion) throw new AppError(404, 'Suggestion not found');
  if (suggestion.suggesterId !== req.user!.id) {
    throw new AppError(403, 'Puoi aggiungere voci solo alle tue proposte.');
  }
  // A withdrawn item takes no new proposals, as `createSuggestion` already refused.
  if (!suggestion.sharedEnvironment.isActive) throw new AppError(404, NOT_FOUND);

  const pendingCount = suggestion.items.filter(i => i.status === 'pending').length;
  const reviewedCount = suggestion.items.length - pendingCount;
  if (pendingCount === 0 && reviewedCount > 0) {
    throw new AppError(409, 'Thread is closed — create a new suggestion');
  }

  if (suggestion.items.length + data.items.length > MAX_ITEMS_PER_SUGGESTION) {
    throw new AppError(400, 'Maximum items per suggestion exceeded');
  }

  await prisma.suggestionItem.createMany({
    data: storableSuggestionItems(data.items).map((i) => ({ suggestionId, ...i })),
  });

  const refreshed = await prisma.environmentSuggestion.findUnique({
    where: { id: suggestionId },
    include: {
      items: true,
      suggester: { select: { id: true, username: true } },
      sharedEnvironment: {
        select: { id: true, title: true, isActive: true, user: { select: { id: true, username: true } } },
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

  await reachableEnvironment(id, req.user!);

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
    throw new AppError(404, NOT_FOUND_OR_NOT_YOURS);
  }

  // Get the version to restore
  const version = await prisma.sharedEnvironmentVersion.findFirst({
    where: { id: versionId, sharedEnvironmentId: id },
  });

  if (!version) {
    throw new AppError(404, 'Versione non trovata.');
  }

  const updatedEnv = await prisma.$transaction(async (tx) => {
    // Create snapshot of current state before restoring
    await createVersionSnapshot(tx, id, env.content, 'Prima del ripristino');

    // Restore the content through the allow-list: an old version's entries (norms, decisions, notes) are rebuilt like a
    // publication's, and its other rows lose what a publication may not carry (a version stored before the check would
    // otherwise put them back as they were). An item published from a dossier keeps its one dossier and its name.
    let content = publishedContent(version.content, 'restore');
    if (env.sourceDossierId) {
      content = asDossierPublication(
        content,
        { title: env.title, description: env.description, tags: env.tags },
        { includeNotes: env.includeNotes, includeHighlights: env.includeHighlights },
      );
    }
    const updated = await tx.sharedEnvironment.update({
      where: { id },
      data: {
        content: content as object,
        currentVersion: env.currentVersion + 1,
      },
      include: {
        user: { select: { id: true, username: true } },
        likes: { where: { userId: req.user!.id }, select: { userId: true } },
        _count: { select: { likes: true } },
      },
    });

    // Create version entry for the restore
    await createVersionSnapshot(tx, id, version.content, `Ripristinato alla versione ${version.version}`);

    return updated;
  });

  res.json(formatSharedEnvironment(updatedEnv, req.user!.id));
};
