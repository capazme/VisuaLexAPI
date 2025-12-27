import { Request, Response } from 'express';
import { PrismaClient, Folder } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';

const prisma = new PrismaClient();

// Validation schemas
const createFolderSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  parent_id: z.string().uuid().optional().nullable(),
  position: z.number().int().min(0).optional(),
});

const updateFolderSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
});

const moveFolderSchema = z.object({
  parent_id: z.string().uuid().optional().nullable(),
  position: z.number().int().min(0).optional(),
});

const bulkDeleteSchema = z.object({
  folder_ids: z.array(z.string().uuid()).min(1),
});

const bulkMoveSchema = z.object({
  folder_ids: z.array(z.string().uuid()).min(1),
  target_parent_id: z.string().uuid().optional().nullable(),
});

// Helper: Check circular reference
async function checkCircularReference(folderId: string, newParentId: string | null): Promise<boolean> {
  if (!newParentId || folderId === newParentId) {
    return false;
  }

  let currentId: string | null = newParentId;
  const visited = new Set<string>();

  while (currentId) {
    if (visited.has(currentId) || currentId === folderId) {
      return true; // Circular reference detected
    }
    visited.add(currentId);

    const parentFolder: { parentId: string | null } | null = await prisma.folder.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });

    currentId = parentFolder?.parentId || null;
  }

  return false;
}

// Helper: Build folder tree recursively
interface FolderTree extends Folder {
  children: FolderTree[];
}

async function buildFolderTree(userId: string, parentId: string | null = null): Promise<FolderTree[]> {
  const folders = await prisma.folder.findMany({
    where: {
      userId,
      parentId,
    },
    orderBy: { position: 'asc' },
  });

  const tree: FolderTree[] = [];

  for (const folder of folders) {
    const children = await buildFolderTree(userId, folder.id);
    tree.push({ ...folder, children });
  }

  return tree;
}

// Create folder
export const createFolder = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const data = createFolderSchema.parse(req.body);

  // Check if parent exists and belongs to user
  if (data.parent_id) {
    const parent = await prisma.folder.findFirst({
      where: {
        id: data.parent_id,
        userId: req.user.id,
      },
    });

    if (!parent) {
      throw new AppError(404, 'Parent folder not found');
    }
  }

  const folder = await prisma.folder.create({
    data: {
      name: data.name,
      description: data.description,
      color: data.color,
      icon: data.icon,
      parentId: data.parent_id || null,
      position: data.position || 0,
      userId: req.user.id,
    },
  });

  res.status(201).json(folder);
};

// Get all folders (flat list with optional parent filter)
export const getFolders = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const parentId = req.query.parent_id as string | undefined;

  const folders = await prisma.folder.findMany({
    where: {
      userId: req.user.id,
      ...(parentId !== undefined && { parentId: parentId || null }),
    },
    orderBy: { position: 'asc' },
  });

  res.json(folders);
};

// Get folder tree
export const getFolderTree = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const tree = await buildFolderTree(req.user.id);
  res.json(tree);
};

// Get single folder
export const getFolder = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { id } = req.params;

  const folder = await prisma.folder.findFirst({
    where: {
      id,
      userId: req.user.id,
    },
  });

  if (!folder) {
    throw new AppError(404, 'Folder not found');
  }

  res.json(folder);
};

// Update folder
export const updateFolder = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { id } = req.params;
  const data = updateFolderSchema.parse(req.body);

  // Check if folder exists and belongs to user
  const existingFolder = await prisma.folder.findFirst({
    where: {
      id,
      userId: req.user.id,
    },
  });

  if (!existingFolder) {
    throw new AppError(404, 'Folder not found');
  }

  const folder = await prisma.folder.update({
    where: { id },
    data: {
      ...(data.name && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.color !== undefined && { color: data.color }),
      ...(data.icon !== undefined && { icon: data.icon }),
    },
  });

  res.json(folder);
};

// Move folder
export const moveFolder = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { id } = req.params;
  const data = moveFolderSchema.parse(req.body);

  // Check if folder exists and belongs to user
  const existingFolder = await prisma.folder.findFirst({
    where: {
      id,
      userId: req.user.id,
    },
  });

  if (!existingFolder) {
    throw new AppError(404, 'Folder not found');
  }

  // Check circular reference
  if (data.parent_id) {
    const hasCircular = await checkCircularReference(id, data.parent_id);
    if (hasCircular) {
      throw new AppError(400, 'Cannot move folder: circular reference detected');
    }

    // Check if new parent exists and belongs to user
    const newParent = await prisma.folder.findFirst({
      where: {
        id: data.parent_id,
        userId: req.user.id,
      },
    });

    if (!newParent) {
      throw new AppError(404, 'Target parent folder not found');
    }
  }

  const folder = await prisma.folder.update({
    where: { id },
    data: {
      parentId: data.parent_id === undefined ? existingFolder.parentId : data.parent_id,
      position: data.position ?? existingFolder.position,
    },
  });

  res.json(folder);
};

// Delete folder
export const deleteFolder = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { id } = req.params;

  // Check if folder exists and belongs to user
  const existingFolder = await prisma.folder.findFirst({
    where: {
      id,
      userId: req.user.id,
    },
  });

  if (!existingFolder) {
    throw new AppError(404, 'Folder not found');
  }

  await prisma.folder.delete({
    where: { id },
  });

  res.status(204).send();
};

// Bulk delete folders
export const bulkDeleteFolders = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { folder_ids } = bulkDeleteSchema.parse(req.body);

  // Verify all folders belong to user
  const folders = await prisma.folder.findMany({
    where: {
      id: { in: folder_ids },
      userId: req.user.id,
    },
  });

  if (folders.length !== folder_ids.length) {
    throw new AppError(404, 'One or more folders not found');
  }

  const result = await prisma.folder.deleteMany({
    where: {
      id: { in: folder_ids },
      userId: req.user.id,
    },
  });

  res.json({ deleted_count: result.count });
};

// Bulk move folders
export const bulkMoveFolders = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { folder_ids, target_parent_id } = bulkMoveSchema.parse(req.body);

  // Verify all folders belong to user
  const folders = await prisma.folder.findMany({
    where: {
      id: { in: folder_ids },
      userId: req.user.id,
    },
  });

  if (folders.length !== folder_ids.length) {
    throw new AppError(404, 'One or more folders not found');
  }

  // Check circular references for each folder
  if (target_parent_id) {
    for (const folderId of folder_ids) {
      const hasCircular = await checkCircularReference(folderId, target_parent_id);
      if (hasCircular) {
        throw new AppError(400, `Cannot move folder ${folderId}: circular reference detected`);
      }
    }

    // Verify target parent exists and belongs to user
    const targetParent = await prisma.folder.findFirst({
      where: {
        id: target_parent_id,
        userId: req.user.id,
      },
    });

    if (!targetParent) {
      throw new AppError(404, 'Target parent folder not found');
    }
  }

  // Update all folders
  await prisma.folder.updateMany({
    where: {
      id: { in: folder_ids },
      userId: req.user.id,
    },
    data: {
      parentId: target_parent_id || null,
    },
  });

  res.json({ updated_count: folder_ids.length });
};
