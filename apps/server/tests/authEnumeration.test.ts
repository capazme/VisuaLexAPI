import { beforeEach, describe, expect, it, vi } from 'vitest';

// Every bcrypt comparison the server makes, counted: a sign-in with an unknown email must spend one, as a wrong
// password does, so the time of the answer does not tell the two apart.
const compares = vi.hoisted(() => ({ count: 0, hashes: 0 }));
vi.mock('bcryptjs', async (importOriginal) => {
  const actual = await importOriginal<{ default?: typeof import('bcryptjs') } & typeof import('bcryptjs')>();
  const lib = actual.default ?? actual;
  const compare = (async (...args: Parameters<typeof lib.compare>) => {
    compares.count += 1;
    return lib.compare(...args);
  }) as typeof lib.compare;
  const hash = (async (...args: Parameters<typeof lib.hash>) => {
    compares.hashes += 1;
    return lib.hash(...args);
  }) as typeof lib.hash;
  const counted = { ...lib, compare, hash };
  return { ...actual, ...counted, default: counted };
});

import { app, createTestUser, prisma, request } from './helpers';

/**
 * Which emails have an account (item 9 of the security inventory, G-520 (a)). Registering with an email that already
 * has one answers exactly as a new registration and creates nothing; a sign-in with an unknown email answers and
 * takes as long as a wrong password. A taken username still says so: usernames are public, in the Forum.
 */
const from = (address: string) => ({ 'X-Forwarded-For': address });
const PASSWORD = 'Abcdefg1';

describe('registering', () => {
  it('answers an email that already has an account exactly as a new registration, after the same work, and creates nothing', async () => {
    const existing = await createTestUser('enum-existing');
    const before = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });

    compares.hashes = 0;
    const fresh = await request(app).post('/api/auth/register').set(from('203.0.120.1'))
      .send({ email: 'enum-new@test.local', username: 'enum-new', password: PASSWORD });
    expect(compares.hashes).toBe(1);
    const taken = await request(app).post('/api/auth/register').set(from('203.0.120.2'))
      .send({ email: existing.email, username: 'enum-other-name', password: PASSWORD });
    expect(compares.hashes).toBe(2);

    expect(fresh.status).toBe(201);
    expect(taken.status).toBe(fresh.status);
    expect(taken.body).toEqual(fresh.body);
    expect(await prisma.user.count({ where: { username: 'enum-other-name' } })).toBe(0);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(after.password).toBe(before.password);
    expect(after.username).toBe(before.username);
  });

  it('says a taken username is taken whatever the email, so a taken username cannot probe the email', async () => {
    const existing = await createTestUser('enum-both');
    const withTakenEmail = await request(app).post('/api/auth/register').set(from('203.0.120.3'))
      .send({ email: existing.email, username: existing.username, password: PASSWORD });
    const withFreeEmail = await request(app).post('/api/auth/register').set(from('203.0.120.6'))
      .send({ email: 'enum-free-mail@test.local', username: existing.username, password: PASSWORD });
    expect(withTakenEmail.status).toBe(400);
    expect(withTakenEmail.status).toBe(withFreeEmail.status);
    expect(withTakenEmail.body).toEqual(withFreeEmail.body);
  });

  it('still says a username is taken when the email is new (usernames are public)', async () => {
    const existing = await createTestUser('enum-username');
    const response = await request(app).post('/api/auth/register').set(from('203.0.120.4'))
      .send({ email: 'enum-fresh@test.local', username: existing.username, password: PASSWORD });
    expect(response.status).toBe(400);
    expect(response.body.detail).toBe('User with this email or username already exists');
    expect(await prisma.user.count({ where: { email: 'enum-fresh@test.local' } })).toBe(0);
  });

  it('creates a new account, inactive, as before', async () => {
    const response = await request(app).post('/api/auth/register').set(from('203.0.120.5'))
      .send({ email: 'enum-brand-new@test.local', username: 'enum-brand-new', password: PASSWORD });
    expect(response.status).toBe(201);
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
