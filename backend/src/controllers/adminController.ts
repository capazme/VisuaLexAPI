import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { hashPassword } from '../utils/password';
import { AppError } from '../middleware/errorHandler';

const prisma = new PrismaClient();

// Validation schemas
const createUserSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(50),
  password: z.string().min(3),
  isAdmin: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
});

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  username: z.string().min(3).max(50).optional(),
  isAdmin: z.boolean().optional(),
  isActive: z.boolean().optional(),
  isVerified: z.boolean().optional(),
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(3),
});

/**
 * List all users (admin only)
 */
export const listUsers = async (_req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      username: true,
      isActive: true,
      isVerified: true,
      isAdmin: true,
      loginCount: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          bookmarks: true,
          dossiers: true,
          annotations: true,
          highlights: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json(users.map(user => ({
    id: user.id,
    email: user.email,
    username: user.username,
    is_active: user.isActive,
    is_verified: user.isVerified,
    is_admin: user.isAdmin,
    login_count: user.loginCount,
    last_login_at: user.lastLoginAt,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
    stats: {
      bookmarks: user._count.bookmarks,
      dossiers: user._count.dossiers,
      annotations: user._count.annotations,
      highlights: user._count.highlights,
    },
  })));
};

/**
 * Get single user by ID (admin only)
 */
export const getUser = async (req: Request, res: Response) => {
  const { id } = req.params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      username: true,
      isActive: true,
      isVerified: true,
      isAdmin: true,
      loginCount: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          bookmarks: true,
          dossiers: true,
          annotations: true,
          highlights: true,
          folders: true,
        },
      },
    },
  });

  if (!user) {
    throw new AppError(404, 'User not found');
  }

  res.json({
    id: user.id,
    email: user.email,
    username: user.username,
    is_active: user.isActive,
    is_verified: user.isVerified,
    is_admin: user.isAdmin,
    login_count: user.loginCount,
    last_login_at: user.lastLoginAt,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
    stats: {
      bookmarks: user._count.bookmarks,
      dossiers: user._count.dossiers,
      annotations: user._count.annotations,
      highlights: user._count.highlights,
      folders: user._count.folders,
    },
  });
};

/**
 * Create new user (admin only)
 */
export const createUser = async (req: Request, res: Response) => {
  const data = createUserSchema.parse(req.body);

  // Check if user already exists
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ email: data.email }, { username: data.username }],
    },
  });

  if (existingUser) {
    throw new AppError(400, 'User with this email or username already exists');
  }

  // Hash password
  const hashedPassword = await hashPassword(data.password);

  // Create user
  const user = await prisma.user.create({
    data: {
      email: data.email,
      username: data.username,
      password: hashedPassword,
      isAdmin: data.isAdmin,
      isActive: data.isActive,
    },
  });

  res.status(201).json({
    id: user.id,
    email: user.email,
    username: user.username,
    is_active: user.isActive,
    is_verified: user.isVerified,
    is_admin: user.isAdmin,
    created_at: user.createdAt,
  });
};

/**
 * Update user (admin only)
 */
export const updateUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  const data = updateUserSchema.parse(req.body);

  // Check if user exists
  const existingUser = await prisma.user.findUnique({
    where: { id },
  });

  if (!existingUser) {
    throw new AppError(404, 'User not found');
  }

  // Prevent admin from disabling their own admin status
  if (req.user?.id === id && data.isAdmin === false) {
    throw new AppError(400, 'Cannot remove your own admin privileges');
  }

  // Prevent admin from deactivating themselves
  if (req.user?.id === id && data.isActive === false) {
    throw new AppError(400, 'Cannot deactivate your own account');
  }

  // Check for email/username conflicts
  if (data.email || data.username) {
    const conflict = await prisma.user.findFirst({
      where: {
        AND: [
          { id: { not: id } },
          {
            OR: [
              data.email ? { email: data.email } : {},
              data.username ? { username: data.username } : {},
            ].filter(obj => Object.keys(obj).length > 0),
          },
        ],
      },
    });

    if (conflict) {
      throw new AppError(400, 'Email or username already in use');
    }
  }

  // Update user
  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(data.email && { email: data.email }),
      ...(data.username && { username: data.username }),
      ...(data.isAdmin !== undefined && { isAdmin: data.isAdmin }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      ...(data.isVerified !== undefined && { isVerified: data.isVerified }),
    },
  });

  res.json({
    id: user.id,
    email: user.email,
    username: user.username,
    is_active: user.isActive,
    is_verified: user.isVerified,
    is_admin: user.isAdmin,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
  });
};

/**
 * Delete user (admin only)
 */
export const deleteUser = async (req: Request, res: Response) => {
  const { id } = req.params;

  // Prevent admin from deleting themselves
  if (req.user?.id === id) {
    throw new AppError(400, 'Cannot delete your own account');
  }

  // Check if user exists
  const existingUser = await prisma.user.findUnique({
    where: { id },
  });

  if (!existingUser) {
    throw new AppError(404, 'User not found');
  }

  // Delete user (cascades to related data)
  await prisma.user.delete({
    where: { id },
  });

  res.status(204).send();
};

/**
 * Reset user password (admin only)
 */
export const resetPassword = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { newPassword } = resetPasswordSchema.parse(req.body);

  // Check if user exists
  const existingUser = await prisma.user.findUnique({
    where: { id },
  });

  if (!existingUser) {
    throw new AppError(404, 'User not found');
  }

  // Hash new password
  const hashedPassword = await hashPassword(newPassword);

  // Update password
  await prisma.user.update({
    where: { id },
    data: { password: hashedPassword },
  });

  res.json({ message: 'Password reset successfully' });
};
