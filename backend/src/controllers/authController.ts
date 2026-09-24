import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../utils/password';
import { generateAccessToken, generateRefreshToken, verifyToken, verifyTokenType } from '../utils/jwt';
import { AppError } from '../middleware/errorHandler';

const prisma = new PrismaClient();

// Password validation regex: min 8 chars, at least 1 uppercase, 1 lowercase, 1 number
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const passwordErrorMessage = 'Password must be at least 8 characters with 1 uppercase, 1 lowercase, and 1 number';

// Validation schemas
const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(50),
  password: z.string().min(8).regex(passwordRegex, passwordErrorMessage),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const refreshSchema = z.object({
  refresh_token: z.string(),
});

const changePasswordSchema = z.object({
  current_password: z.string(),
  new_password: z.string().min(8).regex(passwordRegex, passwordErrorMessage),
});

const deleteAccountSchema = z.object({
  password: z.string().min(1),
  confirmation: z.literal('ELIMINA ACCOUNT'),
});

// Register - creates inactive user pending admin approval
export const register = async (req: Request, res: Response) => {
  const { email, username, password } = registerSchema.parse(req.body);

  // Check if user already exists
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ email }, { username }],
    },
  });

  if (existingUser) {
    throw new AppError(400, 'User with this email or username already exists');
  }

  // Hash password
  const hashedPassword = await hashPassword(password);

  // Create user with isActive: false (requires admin approval)
  await prisma.user.create({
    data: {
      email,
      username,
      password: hashedPassword,
      isActive: false, // User must be approved by admin
    },
  });

  // Don't generate tokens - user cannot login until approved
  res.status(201).json({
    message: 'Registrazione completata. Il tuo account è in attesa di approvazione da parte di un amministratore.',
    pending_approval: true,
  });
};

// Login
export const login = async (req: Request, res: Response) => {
  const { email, password } = loginSchema.parse(req.body);

  // Find user
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new AppError(401, 'Invalid credentials');
  }

  // Verify password
  const isPasswordValid = await verifyPassword(password, user.password);

  if (!isPasswordValid) {
    throw new AppError(401, 'Invalid credentials');
  }

  if (!user.isActive) {
    throw new AppError(403, 'Il tuo account è in attesa di approvazione. Contatta un amministratore.');
  }

  // Update login stats
  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      loginCount: { increment: 1 },
      lastLoginAt: new Date(),
    },
  });

  // Generate tokens
  const accessToken = generateAccessToken(updatedUser.id, updatedUser.email);
  const refreshToken = generateRefreshToken(updatedUser.id, updatedUser.email);

  res.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      username: updatedUser.username,
      is_active: updatedUser.isActive,
      is_verified: updatedUser.isVerified,
      is_admin: updatedUser.isAdmin,
      created_at: updatedUser.createdAt,
      login_count: updatedUser.loginCount,
      last_login_at: updatedUser.lastLoginAt,
    },
  });
};

// Refresh token
export const refresh = async (req: Request, res: Response) => {
  const { refresh_token } = refreshSchema.parse(req.body);

  const payload = verifyToken(refresh_token);

  if (!payload || !verifyTokenType(payload, 'refresh')) {
    throw new AppError(401, 'Invalid refresh token');
  }

  // Verify user still exists and is active
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
  });

  if (!user || !user.isActive) {
    throw new AppError(401, 'User not found or inactive');
  }

  // Generate new tokens
  const accessToken = generateAccessToken(user.id, user.email);
  const refreshToken = generateRefreshToken(user.id, user.email);

  res.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
  });
};

// Get current user
export const getCurrentUser = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  res.json({
    id: req.user.id,
    email: req.user.email,
    username: req.user.username,
    is_active: req.user.isActive,
    is_verified: req.user.isVerified,
    is_admin: req.user.isAdmin,
    created_at: req.user.createdAt,
    login_count: req.user.loginCount,
    last_login_at: req.user.lastLoginAt,
  });
};

// Change password
export const changePassword = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { current_password, new_password } = changePasswordSchema.parse(req.body);

  // Verify current password
  const isPasswordValid = await verifyPassword(current_password, req.user.password);

  if (!isPasswordValid) {
    throw new AppError(400, 'Current password is incorrect');
  }

  // Hash new password
  const hashedPassword = await hashPassword(new_password);

  // Update password
  await prisma.user.update({
    where: { id: req.user.id },
    data: { password: hashedPassword },
  });

  res.json({ message: 'Password changed successfully' });
};

/**
 * Export the user's portable data set. Passwords, tokens and operational
 * secrets are deliberately excluded; the payload is versioned so a future
 * importer can migrate it without guessing its shape.
 */
export const exportAccountData = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [user, folders, bookmarks, annotations, highlights, dossiers, history, environments, quickNorms, customAliases, threads, comments] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, username: true, createdAt: true, updatedAt: true } }),
    prisma.folder.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.bookmark.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.annotation.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.highlight.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.dossier.findMany({ where: { userId }, include: { items: true, snapshots: true }, orderBy: { createdAt: 'asc' } }),
    prisma.searchHistory.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.environment.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.quickNorm.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.customAlias.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.articleThread.findMany({ where: { userId }, include: { comments: true }, orderBy: { createdAt: 'asc' } }),
    prisma.articleComment.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
  ]);

  res.json({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    user,
    data: { folders, bookmarks, annotations, highlights, dossiers, history, environments, quickNorms, customAliases, threads, comments },
  });
};

/**
 * Permanently delete the authenticated account after explicit confirmation.
 * Prisma relations are configured with cascading ownership deletes.
 */
export const deleteAccount = async (req: Request, res: Response) => {
  const { password, confirmation } = deleteAccountSchema.parse(req.body);
  if (confirmation !== 'ELIMINA ACCOUNT') {
    throw new AppError(400, 'Conferma non valida');
  }
  const user = req.user!;
  if (!(await verifyPassword(password, user.password))) {
    throw new AppError(400, 'La password non è corretta');
  }

  await prisma.user.delete({ where: { id: user.id } });
  res.status(204).send();
};
