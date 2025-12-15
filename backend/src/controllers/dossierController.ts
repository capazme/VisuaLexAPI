import { Request, Response } from 'express';
import { PrismaClient, DossierItemType } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';

const prisma = new PrismaClient();

// Validation schemas
const createDossierSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  color: z.string().optional(),
});

const updateDossierSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
});

const createDossierItemSchema = z.object({
  itemType: z.enum(['norm', 'note', 'section']),
  title: z.string().min(1),
  content: z.any().optional(),
  position: z.number().optional(),
});

const updateDossierItemSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.any().optional(),
  position: z.number().optional(),
});

/**
 * List all dossiers for current user
 */
export const listDossiers = async (req: Request, res: Response) => {
  const dossiers = await prisma.dossier.findMany({
    where: { userId: req.user!.id },
    include: {
      items: {
        orderBy: { position: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json(dossiers.map(d => ({
    id: d.id,
    name: d.name,
    description: d.description,
    color: d.color,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
    items: d.items.map(i => ({
      id: i.id,
      item_type: i.itemType,
      title: i.title,
      content: i.content,
      position: i.position,
      created_at: i.createdAt,
    })),
  })));
};

/**
 * Get single dossier by ID
 */
export const getDossier = async (req: Request, res: Response) => {
  const { id } = req.params;

  const dossier = await prisma.dossier.findFirst({
    where: { id, userId: req.user!.id },
    include: {
      items: {
        orderBy: { position: 'asc' },
      },
    },
  });

  if (!dossier) {
    throw new AppError(404, 'Dossier not found');
  }

  res.json({
    id: dossier.id,
    name: dossier.name,
    description: dossier.description,
    color: dossier.color,
    created_at: dossier.createdAt,
    updated_at: dossier.updatedAt,
    items: dossier.items.map(i => ({
      id: i.id,
      item_type: i.itemType,
      title: i.title,
      content: i.content,
      position: i.position,
      created_at: i.createdAt,
    })),
  });
};

/**
 * Create new dossier
 */
export const createDossier = async (req: Request, res: Response) => {
  const data = createDossierSchema.parse(req.body);

  const dossier = await prisma.dossier.create({
    data: {
      name: data.name,
      description: data.description,
      color: data.color,
      userId: req.user!.id,
    },
    include: {
      items: true,
    },
  });

  res.status(201).json({
    id: dossier.id,
    name: dossier.name,
    description: dossier.description,
    color: dossier.color,
    created_at: dossier.createdAt,
    updated_at: dossier.updatedAt,
    items: [],
  });
};

/**
 * Update dossier
 */
export const updateDossier = async (req: Request, res: Response) => {
  const { id } = req.params;
  const data = updateDossierSchema.parse(req.body);

  // Check ownership
  const existing = await prisma.dossier.findFirst({
    where: { id, userId: req.user!.id },
  });

  if (!existing) {
    throw new AppError(404, 'Dossier not found');
  }

  const dossier = await prisma.dossier.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.color !== undefined && { color: data.color }),
    },
    include: {
      items: {
        orderBy: { position: 'asc' },
      },
    },
  });

  res.json({
    id: dossier.id,
    name: dossier.name,
    description: dossier.description,
    color: dossier.color,
    created_at: dossier.createdAt,
    updated_at: dossier.updatedAt,
    items: dossier.items.map(i => ({
      id: i.id,
      item_type: i.itemType,
      title: i.title,
      content: i.content,
      position: i.position,
      created_at: i.createdAt,
    })),
  });
};

/**
 * Delete dossier
 */
export const deleteDossier = async (req: Request, res: Response) => {
  const { id } = req.params;

  // Check ownership
  const existing = await prisma.dossier.findFirst({
    where: { id, userId: req.user!.id },
  });

  if (!existing) {
    throw new AppError(404, 'Dossier not found');
  }

  await prisma.dossier.delete({
    where: { id },
  });

  res.status(204).send();
};

/**
 * Add item to dossier
 */
export const addDossierItem = async (req: Request, res: Response) => {
  const { id } = req.params;
  const data = createDossierItemSchema.parse(req.body);

  // Check ownership
  const dossier = await prisma.dossier.findFirst({
    where: { id, userId: req.user!.id },
  });

  if (!dossier) {
    throw new AppError(404, 'Dossier not found');
  }

  // Get max position
  const maxPos = await prisma.dossierItem.aggregate({
    where: { dossierId: id },
    _max: { position: true },
  });

  const item = await prisma.dossierItem.create({
    data: {
      dossierId: id,
      itemType: data.itemType as DossierItemType,
      title: data.title,
      content: data.content || null,
      position: data.position ?? (maxPos._max.position ?? -1) + 1,
    },
  });

  res.status(201).json({
    id: item.id,
    item_type: item.itemType,
    title: item.title,
    content: item.content,
    position: item.position,
    created_at: item.createdAt,
  });
};

/**
 * Update dossier item
 */
export const updateDossierItem = async (req: Request, res: Response) => {
  const { id, itemId } = req.params;
  const data = updateDossierItemSchema.parse(req.body);

  // Check ownership
  const dossier = await prisma.dossier.findFirst({
    where: { id, userId: req.user!.id },
  });

  if (!dossier) {
    throw new AppError(404, 'Dossier not found');
  }

  const item = await prisma.dossierItem.update({
    where: { id: itemId },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.content !== undefined && { content: data.content }),
      ...(data.position !== undefined && { position: data.position }),
    },
  });

  res.json({
    id: item.id,
    item_type: item.itemType,
    title: item.title,
    content: item.content,
    position: item.position,
    created_at: item.createdAt,
  });
};

/**
 * Delete dossier item
 */
export const deleteDossierItem = async (req: Request, res: Response) => {
  const { id, itemId } = req.params;

  // Check ownership
  const dossier = await prisma.dossier.findFirst({
    where: { id, userId: req.user!.id },
  });

  if (!dossier) {
    throw new AppError(404, 'Dossier not found');
  }

  await prisma.dossierItem.delete({
    where: { id: itemId },
  });

  res.status(204).send();
};

/**
 * Reorder dossier items
 */
export const reorderDossierItems = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { itemIds } = req.body as { itemIds: string[] };

  if (!Array.isArray(itemIds)) {
    throw new AppError(400, 'itemIds must be an array');
  }

  // Check ownership
  const dossier = await prisma.dossier.findFirst({
    where: { id, userId: req.user!.id },
  });

  if (!dossier) {
    throw new AppError(404, 'Dossier not found');
  }

  // Update positions
  await prisma.$transaction(
    itemIds.map((itemId, index) =>
      prisma.dossierItem.update({
        where: { id: itemId },
        data: { position: index },
      })
    )
  );

  res.json({ message: 'Items reordered successfully' });
};
