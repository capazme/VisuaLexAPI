import { Request, Response } from 'express';
import { PrismaClient, EnvironmentCategory } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';

const prisma = new PrismaClient();

// ── Validation ────────────────────────────────────────────────────────────

const categoryEnum = z.enum([
  'compliance',
  'civil',
  'penal',
  'administrative',
  'eu',
  'other',
]);

const createEnvironmentSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional().nullable(),
  author: z.string().optional().nullable(),
  version: z.string().optional().nullable(),
  category: categoryEnum.optional().nullable(),
  color: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  // The environment "content" is an opaque JSON blob holding dossiers,
  // quickNorms, customAliases, annotations, highlights. We don't validate
  // its internal shape here because the frontend owns the schema and we
  // always hydrate the whole thing.
  content: z.any(),
});

const updateEnvironmentSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional().nullable(),
  author: z.string().optional().nullable(),
  version: z.string().optional().nullable(),
  category: categoryEnum.optional().nullable(),
  color: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  content: z.any().optional(),
});

// Small helper so every response shape stays in lock-step.
// Snake_case keys match the existing dossier/bookmark conventions.
type PrismaEnvironment = {
  id: string;
  name: string;
  description: string | null;
  author: string | null;
  version: string | null;
  category: EnvironmentCategory | null;
  color: string | null;
  tags: string[];
  content: unknown;
  createdAt: Date;
  updatedAt: Date;
};

const serialize = (env: PrismaEnvironment) => ({
  id: env.id,
  name: env.name,
  description: env.description,
  author: env.author,
  version: env.version,
  category: env.category,
  color: env.color,
  tags: env.tags,
  content: env.content,
  created_at: env.createdAt,
  updated_at: env.updatedAt,
});

// ── Handlers ──────────────────────────────────────────────────────────────

/**
 * List all personal environments for the current user.
 */
export const listEnvironments = async (req: Request, res: Response) => {
  if (!req.user) throw new AppError(401, 'Not authenticated');

  const envs = await prisma.environment.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
  });

  res.json(envs.map(serialize));
};

/**
 * Get a single environment by id (owned by current user).
 */
export const getEnvironment = async (req: Request, res: Response) => {
  if (!req.user) throw new AppError(401, 'Not authenticated');

  const env = await prisma.environment.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });

  if (!env) {
    throw new AppError(404, 'Environment not found');
  }

  res.json(serialize(env));
};

/**
 * Create a personal environment.
 */
export const createEnvironment = async (req: Request, res: Response) => {
  if (!req.user) throw new AppError(401, 'Not authenticated');

  const data = createEnvironmentSchema.parse(req.body);

  const env = await prisma.environment.create({
    data: {
      name: data.name,
      description: data.description ?? null,
      author: data.author ?? null,
      version: data.version ?? null,
      category: data.category ?? null,
      color: data.color ?? null,
      tags: data.tags ?? [],
      content: data.content ?? {},
      userId: req.user.id,
    },
  });

  res.status(201).json(serialize(env));
};

/**
 * Update a personal environment. Ownership enforced.
 */
export const updateEnvironment = async (req: Request, res: Response) => {
  if (!req.user) throw new AppError(401, 'Not authenticated');

  const { id } = req.params;
  const data = updateEnvironmentSchema.parse(req.body);

  const existing = await prisma.environment.findFirst({
    where: { id, userId: req.user.id },
  });

  if (!existing) {
    throw new AppError(404, 'Environment not found');
  }

  const env = await prisma.environment.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.author !== undefined && { author: data.author }),
      ...(data.version !== undefined && { version: data.version }),
      ...(data.category !== undefined && { category: data.category }),
      ...(data.color !== undefined && { color: data.color }),
      ...(data.tags !== undefined && { tags: data.tags }),
      ...(data.content !== undefined && { content: data.content }),
    },
  });

  res.json(serialize(env));
};

/**
 * Delete a personal environment. Ownership enforced.
 */
export const deleteEnvironment = async (req: Request, res: Response) => {
  if (!req.user) throw new AppError(401, 'Not authenticated');

  const { id } = req.params;

  const existing = await prisma.environment.findFirst({
    where: { id, userId: req.user.id },
  });

  if (!existing) {
    throw new AppError(404, 'Environment not found');
  }

  await prisma.environment.delete({ where: { id } });

  res.status(204).send();
};
