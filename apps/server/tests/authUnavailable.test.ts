import { afterEach, describe, expect, it, vi } from 'vitest';
import { request, app, createTestUser, authHeader } from './helpers';
import { prisma as appPrisma } from '../src/lib/prisma';

/**
 * A 401 tells the web client the session is over: it tries one refresh and
 * then logs the user out. A database that cannot answer for a moment is not
 * that, so `authenticate` must not say 401 for it — every open tab would lose
 * its session at each hiccup. A fault on our side is a 503; a missing, bad or
 * expired token, or a disabled user, stays a 401.
 */
describe('authenticate when the database cannot answer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('answers 503, not 401, and the same token works once the database is back', async () => {
    const user = await createTestUser('auth-db-down');
    vi.spyOn(appPrisma.user, 'findUnique').mockRejectedValueOnce(new Error('connection refused'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const down = await request(app).get('/api/dossiers').set(authHeader(user));
    expect(down.status).toBe(503);
    expect(down.body.detail).toMatch(/temporaneamente/i);

    const back = await request(app).get('/api/dossiers').set(authHeader(user));
    expect(back.status).toBe(200);
  });

  it('still answers 401 for a token that does not verify', async () => {
    const response = await request(app).get('/api/dossiers').set('Authorization', 'Bearer not-a-jwt');
    expect(response.status).toBe(401);
  });
});
