import { Request, Response } from 'express';
import { EnvironmentCategory } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import { importStudyDossiers, spendStudyImport } from '../services/studyImport';
import { readableContent } from '../utils/publishedContent';

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

const importSwitchesSchema = z.object({
  addNotes: z.boolean().default(true),
  addHighlights: z.boolean().default(true),
});

/**
 * «Recupera i dossier» from an environment of the archive (spec
 * docs/superpowers/specs/2026-10-13-environments-into-forum-design.md, D11b): each of its dossiers
 * becomes a new dossier di studio, with its notes and highlights unless switched off, one
 * identical to the user's own skipped. The environment itself is left as it is.
 */
export const recoverEnvironment = async (req: Request, res: Response) => {
  if (!req.user) throw new AppError(401, 'Not authenticated');
  const switches = importSwitchesSchema.parse(req.body ?? {});
  const env = await prisma.environment.findFirst({ where: { id: req.params.id, userId: req.user.id }, select: { content: true } });
  if (!env) throw new AppError(404, 'Ambiente non trovato');
  await spendStudyImport(req.user.id);
  const { content, refused } = readableContent(env.content);
  const report = await importStudyDossiers(req.user.id, content, { ...switches, addShortcuts: false, attributeTo: null, refused });
  res.status(201).json(report);
};
