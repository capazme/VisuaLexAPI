import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/lib/db';
import { createPgAdapter } from '../src/lib/pgAdapter';
import jwt from 'jsonwebtoken';
import expressApp from '../src/app';
import { createWebSession, sessionCookieName } from '../src/auth/webSession';
import { prisma as appPrisma } from '../src/lib/prisma';

// On the local file (`LEXCRAFT_TEST_DB=local`) there is one connection, so the helpers use the server's own client.
const prisma: PrismaClient = process.env.LEXCRAFT_TEST_DB === 'local'
  ? appPrisma
  : new PrismaClient({ adapter: createPgAdapter(process.env.DATABASE_URL ?? '') });

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
  /** A user's access JWT, as the web sent it before the session cookie (A.1): `bearerHeader`. */
  token: string;
  /** The secret of a web session opened for the user (A.1): `authHeader` sends it as the session cookie. */
  session: string;
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
  const session = await createWebSession(user.id, 'vitest');
  return { id: user.id, email: user.email, username: user.username, token, session };
}

/**
 * The web as it will be (A.1): the session cookie, and the header every write must carry (middleware/csrfGuard.ts).
 * The header goes on reads too, as the web's axios client will send it: harmless there.
 */
export function authHeader(user: TestUser) {
  return { Cookie: `${sessionCookieName()}=${user.session}`, 'X-VisuaLex-Client': 'web' };
}

/** The session cookie alone, without the web's header: what a request from another site would carry. */
export function cookieOnly(user: TestUser) {
  return { Cookie: `${sessionCookieName()}=${user.session}` };
}

/** The web as it is until it moves to the cookie: a user's access JWT. */
export function bearerHeader(user: TestUser) {
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

/** The id of the current MERL-T notice: a consent is given under it (`POST /api/merlt/consent`). */
export async function merltNoticeId(): Promise<string> {
  const notice = await prisma.lingoTestoVersione.findFirstOrThrow({
    where: { chiave: 'INFORMATIVA_MERLT' },
    orderBy: { versione: 'desc' },
    select: { id: true },
  });
  return notice.id;
}

export { request, app, prisma };
