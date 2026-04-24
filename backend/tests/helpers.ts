import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import app from '../src/app';

const prisma = new PrismaClient();

export interface TestUser {
  id: string;
  email: string;
  username: string;
  token: string;
}

export async function createTestUser(username: string): Promise<TestUser> {
  const password = await bcrypt.hash('test-password', 4);
  const user = await prisma.user.create({
    data: {
      email: `${username}@test.local`,
      username,
      password,
      isVerified: true,
      isActive: true,
    },
  });
  // Must include `email` and `type: 'access'` to pass verifyTokenType() in auth middleware
  const token = jwt.sign(
    { userId: user.id, email: user.email, type: 'access' },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '1h' },
  );
  return { id: user.id, email: user.email, username: user.username, token };
}

export function authHeader(user: TestUser) {
  return { Authorization: `Bearer ${user.token}` };
}

export async function createSharedEnv(owner: TestUser, overrides: Partial<{ title: string }> = {}) {
  return prisma.sharedEnvironment.create({
    data: {
      title: overrides.title ?? 'Test Env',
      description: 'from tests',
      content: { dossiers: [], quickNorms: [], annotations: [], highlights: [] },
      category: 'civil',
      tags: [],
      userId: owner.id,
    },
  });
}

export { request, app, prisma };
