import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import expressApp from '../src/app';

const prisma = new PrismaClient();

// ONE persistent listening server for the whole suite. Passing the bare Express
// app to `request(app)` makes supertest spin up (and tear down) a fresh ephemeral
// server PER request; across the suite's thousands of requests that churn
// occasionally races — the server closes before the response flushes ("socket
// hang up") or a request goes out with a dropped header ("no-header" 401). A
// single long-lived server reuses one port and removes that race. `.unref()` so
// the listener never keeps the test process alive at teardown.
//
// Bound to 127.0.0.1, the address supertest dials. On macOS a wildcard listen
// can be given a port another local process holds on 127.0.0.1 alone, and the
// kernel then hands that process the suite's requests: a dev tool answering
// 403 failed `sharedEnvironments.publish` once in eight runs. A loopback bind
// cannot share its port that way.
const app = expressApp.listen(0, '127.0.0.1');
app.unref();

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
