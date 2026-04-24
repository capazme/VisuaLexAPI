import { Request, Response } from 'express';
import { PrismaClient, AliasType } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';

const prisma = new PrismaClient();

// ── Validation ────────────────────────────────────────────────────────────

// Trigger: 2+ chars, alphanumeric + dash/underscore/dot — same regex the
// frontend enforces client-side (addCustomAlias in useAppStore).
const TRIGGER_RE = /^[a-zA-Z0-9\-_.]+$/;

const aliasTypeEnum = z.enum(['shortcut', 'reference']);

const searchParamsShape = z.object({
  act_type: z.string(),
  act_number: z.string().optional(),
  date: z.string().optional(),
  article: z.string().optional(),
}).optional().nullable();

const createCustomAliasSchema = z.object({
  trigger: z.string().min(2).regex(TRIGGER_RE, 'invalid trigger characters'),
  type: aliasTypeEnum,
  expandTo: z.string().min(1),
  searchParams: searchParamsShape,
  description: z.string().optional().nullable(),
});

const updateCustomAliasSchema = z.object({
  trigger: z.string().min(2).regex(TRIGGER_RE).optional(),
  type: aliasTypeEnum.optional(),
  expandTo: z.string().min(1).optional(),
  searchParams: searchParamsShape,
  description: z.string().optional().nullable(),
  usageCount: z.number().int().nonnegative().optional(),
  lastUsedAt: z.string().datetime().optional().nullable(),
});

type PrismaAlias = {
  id: string;
  trigger: string;
  aliasType: AliasType;
  expandTo: string;
  searchParams: unknown;
  description: string | null;
  usageCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
};

const serialize = (a: PrismaAlias) => ({
  id: a.id,
  trigger: a.trigger,
  // Wire uses `type` (matches the frontend type) rather than aliasType (the
  // Prisma column name), to keep the client shape clean.
  type: a.aliasType,
  expandTo: a.expandTo,
  searchParams: a.searchParams,
  description: a.description,
  usageCount: a.usageCount,
  lastUsedAt: a.lastUsedAt,
  createdAt: a.createdAt,
});

// ── Handlers ──────────────────────────────────────────────────────────────

export const listCustomAliases = async (req: Request, res: Response) => {
  if (!req.user) throw new AppError(401, 'Not authenticated');

  const rows = await prisma.customAlias.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
  });

  res.json(rows.map(serialize));
};

export const createCustomAlias = async (req: Request, res: Response) => {
  if (!req.user) throw new AppError(401, 'Not authenticated');

  const data = createCustomAliasSchema.parse(req.body);
  const triggerLower = data.trigger.toLowerCase().trim();

  // @@unique([userId, trigger]) gives us a DB-level guarantee; catch the
  // Prisma P2002 to surface a clean 409 instead of a 500.
  try {
    const alias = await prisma.customAlias.create({
      data: {
        trigger: triggerLower,
        aliasType: data.type as AliasType,
        expandTo: data.expandTo,
        searchParams: data.searchParams ?? undefined,
        description: data.description ?? null,
        userId: req.user.id,
      },
    });
    res.status(201).json(serialize(alias));
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') {
      throw new AppError(409, `Alias "${triggerLower}" already exists`);
    }
    throw err;
  }
};

export const updateCustomAlias = async (req: Request, res: Response) => {
  if (!req.user) throw new AppError(401, 'Not authenticated');

  const { id } = req.params;
  const data = updateCustomAliasSchema.parse(req.body);

  const existing = await prisma.customAlias.findFirst({
    where: { id, userId: req.user.id },
  });

  if (!existing) {
    throw new AppError(404, 'CustomAlias not found');
  }

  try {
    const alias = await prisma.customAlias.update({
      where: { id },
      data: {
        ...(data.trigger !== undefined && { trigger: data.trigger.toLowerCase().trim() }),
        ...(data.type !== undefined && { aliasType: data.type as AliasType }),
        ...(data.expandTo !== undefined && { expandTo: data.expandTo }),
        ...(data.searchParams !== undefined && { searchParams: data.searchParams ?? undefined }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.usageCount !== undefined && { usageCount: data.usageCount }),
        ...(data.lastUsedAt !== undefined && {
          lastUsedAt: data.lastUsedAt ? new Date(data.lastUsedAt) : null,
        }),
      },
    });
    res.json(serialize(alias));
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') {
      throw new AppError(409, 'Alias trigger already exists');
    }
    throw err;
  }
};

export const deleteCustomAlias = async (req: Request, res: Response) => {
  if (!req.user) throw new AppError(401, 'Not authenticated');

  const { id } = req.params;

  const existing = await prisma.customAlias.findFirst({
    where: { id, userId: req.user.id },
  });

  if (!existing) {
    throw new AppError(404, 'CustomAlias not found');
  }

  await prisma.customAlias.delete({ where: { id } });

  res.status(204).send();
};

// Atomic usage bump — same rationale as quickNormController.useQuickNorm.
export const useCustomAlias = async (req: Request, res: Response) => {
  if (!req.user) throw new AppError(401, 'Not authenticated');

  const { id } = req.params;

  const existing = await prisma.customAlias.findFirst({
    where: { id, userId: req.user.id },
  });

  if (!existing) {
    throw new AppError(404, 'CustomAlias not found');
  }

  const alias = await prisma.customAlias.update({
    where: { id },
    data: {
      usageCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });

  res.json(serialize(alias));
};
