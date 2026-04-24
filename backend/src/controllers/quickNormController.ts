import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';

const prisma = new PrismaClient();

// ── Validation ────────────────────────────────────────────────────────────

const createQuickNormSchema = z.object({
  label: z.string().min(1).max(300),
  // SearchParams shape is owned by the frontend — we validate only the
  // keys that the server actually reads (none) and ship the blob as-is.
  searchParams: z.any(),
  sourceUrl: z.string().optional().nullable(),
});

const updateQuickNormSchema = z.object({
  label: z.string().min(1).max(300).optional(),
  searchParams: z.any().optional(),
  sourceUrl: z.string().optional().nullable(),
  // usageCount + lastUsedAt are updated by the dedicated `use` endpoint,
  // but allowing them here keeps the surface flexible for batch resets.
  usageCount: z.number().int().nonnegative().optional(),
  lastUsedAt: z.string().datetime().optional().nullable(),
});

type PrismaQuickNorm = {
  id: string;
  label: string;
  searchParams: unknown;
  sourceUrl: string | null;
  usageCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
};

const serialize = (qn: PrismaQuickNorm) => ({
  id: qn.id,
  label: qn.label,
  searchParams: qn.searchParams,
  sourceUrl: qn.sourceUrl,
  usageCount: qn.usageCount,
  lastUsedAt: qn.lastUsedAt,
  createdAt: qn.createdAt,
});

// ── Handlers ──────────────────────────────────────────────────────────────

export const listQuickNorms = async (req: Request, res: Response) => {
  if (!req.user) throw new AppError(401, 'Not authenticated');

  const rows = await prisma.quickNorm.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
  });

  res.json(rows.map(serialize));
};

export const createQuickNorm = async (req: Request, res: Response) => {
  if (!req.user) throw new AppError(401, 'Not authenticated');

  const data = createQuickNormSchema.parse(req.body);

  const qn = await prisma.quickNorm.create({
    data: {
      label: data.label,
      searchParams: data.searchParams ?? {},
      sourceUrl: data.sourceUrl ?? null,
      userId: req.user.id,
    },
  });

  res.status(201).json(serialize(qn));
};

export const updateQuickNorm = async (req: Request, res: Response) => {
  if (!req.user) throw new AppError(401, 'Not authenticated');

  const { id } = req.params;
  const data = updateQuickNormSchema.parse(req.body);

  const existing = await prisma.quickNorm.findFirst({
    where: { id, userId: req.user.id },
  });

  if (!existing) {
    throw new AppError(404, 'QuickNorm not found');
  }

  const qn = await prisma.quickNorm.update({
    where: { id },
    data: {
      ...(data.label !== undefined && { label: data.label }),
      ...(data.searchParams !== undefined && { searchParams: data.searchParams }),
      ...(data.sourceUrl !== undefined && { sourceUrl: data.sourceUrl }),
      ...(data.usageCount !== undefined && { usageCount: data.usageCount }),
      ...(data.lastUsedAt !== undefined && {
        lastUsedAt: data.lastUsedAt ? new Date(data.lastUsedAt) : null,
      }),
    },
  });

  res.json(serialize(qn));
};

export const deleteQuickNorm = async (req: Request, res: Response) => {
  if (!req.user) throw new AppError(401, 'Not authenticated');

  const { id } = req.params;

  const existing = await prisma.quickNorm.findFirst({
    where: { id, userId: req.user.id },
  });

  if (!existing) {
    throw new AppError(404, 'QuickNorm not found');
  }

  await prisma.quickNorm.delete({ where: { id } });

  res.status(204).send();
};

// Dedicated "use" endpoint: atomic increment so concurrent clicks don't
// race on the usage counter, and so the client can fire-and-forget after
// a click without needing to PATCH a read-modify-write.
export const useQuickNorm = async (req: Request, res: Response) => {
  if (!req.user) throw new AppError(401, 'Not authenticated');

  const { id } = req.params;

  const existing = await prisma.quickNorm.findFirst({
    where: { id, userId: req.user.id },
  });

  if (!existing) {
    throw new AppError(404, 'QuickNorm not found');
  }

  const qn = await prisma.quickNorm.update({
    where: { id },
    data: {
      usageCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });

  res.json(serialize(qn));
};
