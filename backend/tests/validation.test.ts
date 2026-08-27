import { describe, it, expect } from 'vitest';
import { request, app, createTestUser, authHeader } from './helpers';

/**
 * Every write endpoint validates its body with `schema.parse()` — 41 call sites
 * across 13 controllers — and Zod throws on a bad one. The central error
 * handler only knew `AppError`, so all 41 answered 500 "Internal server error":
 * a mistake the CALLER made, reported as a server fault, with no indication of
 * which field was wrong. The frontend renders `detail` straight to the user, so
 * a lawyer typing a short password was told the server had broken.
 *
 * These pin the 400, the field names, and that nothing else changed status.
 */
describe('malformed request bodies', () => {
  it('answers 400, not 500, and names the missing fields', async () => {
    const res = await request(app).post('/api/auth/login').send({});

    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/email/);
    expect(res.body.detail).toMatch(/password/);
  });

  it('reports the rule that was broken, not just the field', async () => {
    // The case found in production: a password below the minimum length.
    const res = await request(app).post('/api/auth/register').send({
      email: 'someone@test.local',
      username: 'someone',
      password: 'x',
    });

    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/password/);
    expect(res.body.errors).toContainEqual(
      expect.objectContaining({ field: 'password' }),
    );
  });

  it('covers authenticated writes too, not only the auth endpoints', async () => {
    const user = await createTestUser('validation-user');

    const res = await request(app)
      .post('/api/dossiers')
      .set(authHeader(user))
      .send({ name: '' }); // min(1)

    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/name/);
  });

  it('keeps `detail` a string, which is what the frontend renders', async () => {
    const res = await request(app).post('/api/auth/login').send({});

    // Pinned together with the 400 on purpose: the old 500 also returned a
    // string ("Internal server error"), so the type alone proves nothing.
    // services/api.ts renders `detail` verbatim, so an object would reach the
    // user as "[object Object]"; the structured form lives in `errors`.
    expect(res.status).toBe(400);
    expect(typeof res.body.detail).toBe('string');
    expect(Array.isArray(res.body.errors)).toBe(true);
  });
});

describe('statuses that must not have moved', () => {
  it('still rejects a well-formed login with wrong credentials as 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.local', password: 'wrong-password' });

    expect(res.status).toBe(401);
  });

  it('still accepts a valid body', async () => {
    const user = await createTestUser('validation-happy');

    const res = await request(app)
      .post('/api/dossiers')
      .set(authHeader(user))
      .send({ name: 'Un dossier valido' });

    expect(res.status).toBeLessThan(300);
  });
});
