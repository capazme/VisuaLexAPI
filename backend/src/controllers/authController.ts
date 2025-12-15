import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../utils/password';
import { generateAccessToken, generateRefreshToken, verifyToken, verifyTokenType } from '../utils/jwt';
import { AppError } from '../middleware/errorHandler';

const prisma = new PrismaClient();

// Validation schemas
const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(50),
  password: z.string().min(3),
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
  new_password: z.string().min(3),
});

// Register
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

  // Create user
  const user = await prisma.user.create({
    data: {
      email,
      username,
      password: hashedPassword,
    },
  });

  // Generate tokens
  const accessToken = generateAccessToken(user.id, user.email);
  const refreshToken = generateRefreshToken(user.id, user.email);

  res.status(201).json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      is_active: user.isActive,
      is_verified: user.isVerified,
      is_admin: user.isAdmin,
      created_at: user.createdAt,
    },
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
    throw new AppError(401, 'User account is inactive');
  }

  // Generate tokens
  const accessToken = generateAccessToken(user.id, user.email);
  const refreshToken = generateRefreshToken(user.id, user.email);

  res.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      is_active: user.isActive,
      is_verified: user.isVerified,
      is_admin: user.isAdmin,
      created_at: user.createdAt,
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
