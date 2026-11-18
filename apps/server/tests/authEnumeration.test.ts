import { beforeEach, describe, expect, it, vi } from 'vitest';

// Every bcrypt comparison the server makes, counted: a sign-in with an unknown email must spend one, as a wrong
// password does, so the time of the answer does not tell the two apart.
const compares = vi.hoisted(() => ({ count: 0 }));
vi.mock('bcryptjs', async (importOriginal) => {
  const actual = await importOriginal<{ default?: typeof import('bcryptjs') } & typeof import('bcryptjs')>();
  const lib = actual.default ?? actual;
  const compare = (async (...args: Parameters<typeof lib.compare>) => {
    compares.count += 1;
    return lib.compare(...args);
  }) as typeof lib.compare;
  const counted = { ...lib, compare };
  return { ...actual, ...counted, default: counted };
});

import { app, createTestUser, prisma, request } from './helpers';
// The controller's own client: the helpers' is another instance, so a spy on it would never reach the route.
import { prisma as appPrisma } from '../src/lib/prisma';

/**
 * Registering and signing in, as to which emails have an account (item 9 of the security inventory, G-520). A taken
 * email and a taken username get one and the same refusal, which names neither; a sign-in with an unknown email answers
 * and takes as long as a wrong password.
 */
const from = (address: string) => ({ 'X-Forwarded-For': address });
const PASSWORD = 'Abcdefg1';
const REFUSED = 'Registrazione non riuscita con questi dati.';
const register = (address: string, body: { email: string; username: string }) =>
  request(app).post('/api/auth/register').set(from(address)).send({ ...body, password: PASSWORD });

describe('registering', () => {
  it('refuses a taken email and a taken username with the same answer, which names neither', async () => {
    const existing = await createTestUser('enum-same');
    const emailTaken = await register('203.0.120.1', { email: existing.email, username: 'enum-same-free-name' });
    const usernameTaken = await register('203.0.120.2', { email: 'enum-same-free@test.local', username: existing.username });
    const bothTaken = await register('203.0.120.3', { email: existing.email, username: existing.username });

    expect(emailTaken.status).toBe(400);
    expect(emailTaken.body.detail).toBe(REFUSED);
    expect(usernameTaken.status).toBe(emailTaken.status);
    expect(usernameTaken.body).toEqual(emailTaken.body);
    expect(bothTaken.status).toBe(emailTaken.status);
    expect(bothTaken.body).toEqual(emailTaken.body);
  });

  it('creates nothing and changes nothing about the existing account when it refuses', async () => {
    const existing = await createTestUser('enum-untouched');
    const before = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    await register('203.0.120.4', { email: existing.email, username: 'enum-untouched-new' });
    await register('203.0.120.5', { email: 'enum-untouched-free@test.local', username: existing.username });

    expect(await prisma.user.count({ where: { username: 'enum-untouched-new' } })).toBe(0);
    expect(await prisma.user.count({ where: { email: 'enum-untouched-free@test.local' } })).toBe(0);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(after.password).toBe(before.password);
    expect(after.username).toBe(before.username);
  });

  it('gives the same refusal when two registrations meet at the unique index', async () => {
    const existing = await createTestUser('enum-race');
    // The other registration lands between the check and the insert: the check sees no account, the insert meets one.
    const check = vi.spyOn(appPrisma.user, 'findFirst').mockResolvedValueOnce(null);
    try {
      const response = await register('203.0.120.6', { email: existing.email, username: 'enum-race-new' });
      expect(response.status).toBe(400);
      expect(response.body.detail).toBe(REFUSED);
    } finally {
      check.mockRestore();
    }
    expect(await prisma.user.count({ where: { username: 'enum-race-new' } })).toBe(0);
  });

  it('creates a new account, inactive, as before', async () => {
    const response = await register('203.0.120.7', { email: 'enum-brand-new@test.local', username: 'enum-brand-new' });
    expect(response.status).toBe(201);
    expect(response.body.pending_approval).toBe(true);
    const row = await prisma.user.findUniqueOrThrow({ where: { email: 'enum-brand-new@test.local' } });
    expect(row.isActive).toBe(false);
  });
});

describe('signing in', () => {
  beforeEach(() => {
    compares.count = 0;
  });

  it('answers an unknown email exactly as a wrong password, after a password check of the same cost', async () => {
    const user = await createTestUser('enum-sign-in');
    const unknown = await request(app).post('/api/auth/login').set(from('203.0.121.1'))
      .send({ email: 'nobody-here@test.local', password: 'Whatever1' });
    expect(compares.count).toBe(1);
    const wrong = await request(app).post('/api/auth/login').set(from('203.0.121.2'))
      .send({ email: user.email, password: 'Whatever1' });
    expect(compares.count).toBe(2);
    expect(unknown.status).toBe(401);
    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body).toEqual(wrong.body);
  });
});
