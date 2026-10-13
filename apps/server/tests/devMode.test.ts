import { beforeEach, describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { setDevMode } from '../src/controllers/authController';
import { request, app, createTestUser, authHeader, prisma, type TestUser } from './helpers';

const fresh = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });

describe('the development mode, as a new account has it', () => {
  it('starts every user neither allowed nor on', async () => {
    const user = await createTestUser('dev-default');
    const row = await fresh(user.id);
    expect(row.devModeAllowed).toBe(false);
    expect(row.devMode).toBe(false);
  });
});

describe('the permission, from the administrator’s page', () => {
  let admin: TestUser;
  let carol: TestUser;
  beforeEach(async () => {
    admin = await createTestUser('dev-admin');
    await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: true } });
    carol = await createTestUser('dev-carol');
  });

  it('sets devModeAllowed', async () => {
    const response = await request(app).put(`/api/admin/users/${carol.id}`).set(authHeader(admin)).send({ devModeAllowed: true });
    expect(response.status).toBe(200);
    expect(response.body.dev_mode_allowed).toBe(true);
    expect(response.body.dev_mode).toBe(false);
    expect((await fresh(carol.id)).devModeAllowed).toBe(true);
  });

  it('turns dev_mode off in the same update that revokes the permission', async () => {
    await prisma.user.update({ where: { id: carol.id }, data: { devModeAllowed: true, devMode: true } });
    const response = await request(app).put(`/api/admin/users/${carol.id}`).set(authHeader(admin)).send({ devModeAllowed: false });
    expect(response.status).toBe(200);
    expect(response.body.dev_mode_allowed).toBe(false);
    expect(response.body.dev_mode).toBe(false);
    const row = await fresh(carol.id);
    expect(row.devModeAllowed).toBe(false);
    expect(row.devMode).toBe(false);
  });

  it('leaves both fields alone when the body does not mention them', async () => {
    await prisma.user.update({ where: { id: carol.id }, data: { devModeAllowed: true, devMode: true } });
    const response = await request(app).put(`/api/admin/users/${carol.id}`).set(authHeader(admin)).send({ isVerified: true });
    expect(response.status).toBe(200);
    expect(response.body.dev_mode_allowed).toBe(true);
    expect(response.body.dev_mode).toBe(true);
  });

  it('does not let the administrator switch the mode on for someone else', async () => {
    const response = await request(app).put(`/api/admin/users/${carol.id}`).set(authHeader(admin)).send({ devMode: true });
    expect((await fresh(carol.id)).devMode).toBe(false);
    expect(response.status).toBe(200);
  });

  it('refuses a permission that is not a boolean', async () => {
    const response = await request(app).put(`/api/admin/users/${carol.id}`).set(authHeader(admin)).send({ devModeAllowed: 'yes' });
    expect(response.status).toBe(400);
  });

  it('shows both fields in the list, in one user and in the answer to a creation', async () => {
    await prisma.user.update({ where: { id: carol.id }, data: { devModeAllowed: true, devMode: true } });
    const list = await request(app).get('/api/admin/users').set(authHeader(admin));
    expect(list.status).toBe(200);
    const row = list.body.find((u: { id: string }) => u.id === carol.id);
    expect(row.dev_mode_allowed).toBe(true);
    expect(row.dev_mode).toBe(true);
    const other = list.body.find((u: { id: string }) => u.id === admin.id);
    expect(other.dev_mode_allowed).toBe(false);
    expect(other.dev_mode).toBe(false);

    const one = await request(app).get(`/api/admin/users/${carol.id}`).set(authHeader(admin));
    expect(one.body.dev_mode_allowed).toBe(true);
    expect(one.body.dev_mode).toBe(true);

    const created = await request(app)
      .post('/api/admin/users')
      .set(authHeader(admin))
      .send({ email: 'dev-new@test.local', username: 'dev-new', password: 'secret' });
    expect(created.status).toBe(201);
    expect(created.body.dev_mode_allowed).toBe(false);
    expect(created.body.dev_mode).toBe(false);
  });

  it('answers 403 to a user who is not an administrator', async () => {
    const response = await request(app).put(`/api/admin/users/${carol.id}`).set(authHeader(carol)).send({ devModeAllowed: true });
    expect(response.status).toBe(403);
    expect((await fresh(carol.id)).devModeAllowed).toBe(false);
  });
});

describe('PUT /api/auth/dev-mode, the user’s own switch', () => {
  let dave: TestUser;
  beforeEach(async () => { dave = await createTestUser('dev-dave'); });

  const put = (user: TestUser, body: unknown) => request(app).put('/api/auth/dev-mode').set(authHeader(user)).send(body as object);

  it('answers 401 without a token', async () => {
    const response = await request(app).put('/api/auth/dev-mode').send({ enabled: true });
    expect(response.status).toBe(401);
  });

  it('refuses to turn the mode on without the permission, and writes nothing', async () => {
    const response = await put(dave, { enabled: true });
    expect(response.status).toBe(403);
    expect(response.body.detail).toBe('Modalità sviluppo non abilitata per questo account');
    const row = await fresh(dave.id);
    expect(row.devMode).toBe(false);
    expect(row.devModeAllowed).toBe(false);
  });

  it('turns the mode on and off for an allowed user, answering as /auth/me does', async () => {
    await prisma.user.update({ where: { id: dave.id }, data: { devModeAllowed: true } });

    const on = await put(dave, { enabled: true });
    expect(on.status).toBe(200);
    expect(on.body.id).toBe(dave.id);
    expect(on.body.email).toBe(dave.email);
    expect(on.body.dev_mode_allowed).toBe(true);
    expect(on.body.dev_mode).toBe(true);
    expect((await fresh(dave.id)).devMode).toBe(true);

    const off = await put(dave, { enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.dev_mode_allowed).toBe(true);
    expect(off.body.dev_mode).toBe(false);
    expect((await fresh(dave.id)).devMode).toBe(false);
  });

  it('checks the permission in the write, so a revocation after authentication leaves the mode off', async () => {
    // `authenticate` read dave while he was still allowed; the administrator revokes right after.
    await prisma.user.update({ where: { id: dave.id }, data: { devModeAllowed: true } });
    const stale = await fresh(dave.id);
    await prisma.user.update({ where: { id: dave.id }, data: { devModeAllowed: false, devMode: false } });

    const res = { json: () => undefined } as unknown as Response;
    await expect(setDevMode({ user: stale, body: { enabled: true } } as unknown as Request, res)).rejects.toMatchObject({ statusCode: 403 });
    const row = await fresh(dave.id);
    expect(row.devModeAllowed).toBe(false);
    expect(row.devMode).toBe(false);
  });

  it('lets a user without the permission turn the mode off (a no-op)', async () => {
    const response = await put(dave, { enabled: false });
    expect(response.status).toBe(200);
    expect(response.body.dev_mode).toBe(false);
  });

  it('refuses an extra key with 400 and writes nothing, rather than stripping it', async () => {
    for (const extra of [{ devModeAllowed: true }, { dev_mode_allowed: true }, { isAdmin: true }]) {
      const response = await put(dave, { enabled: true, ...extra });
      expect(response.status).toBe(400);
    }
    const row = await fresh(dave.id);
    expect(row.devModeAllowed).toBe(false);
    expect(row.devMode).toBe(false);
    expect(row.isAdmin).toBe(false);
  });

  it('does not let the permission be granted through this route even alone', async () => {
    const response = await put(dave, { devModeAllowed: true });
    expect(response.status).toBe(400);
    expect((await fresh(dave.id)).devModeAllowed).toBe(false);
  });

  it('refuses a body without a boolean enabled', async () => {
    expect((await put(dave, {})).status).toBe(400);
    expect((await put(dave, { enabled: 'true' })).status).toBe(400);
  });
});

describe('/auth/me and the login carry both fields', () => {
  it('shows the defaults, then the stored values', async () => {
    const erin = await createTestUser('dev-erin');

    const before = await request(app).get('/api/auth/me').set(authHeader(erin));
    expect(before.status).toBe(200);
    expect(before.body.dev_mode_allowed).toBe(false);
    expect(before.body.dev_mode).toBe(false);

    await prisma.user.update({ where: { id: erin.id }, data: { devModeAllowed: true, devMode: true } });

    const me = await request(app).get('/api/auth/me').set(authHeader(erin));
    expect(me.body.dev_mode_allowed).toBe(true);
    expect(me.body.dev_mode).toBe(true);

    const login = await request(app).post('/api/auth/login').send({ email: erin.email, password: 'test-password' });
    expect(login.status).toBe(200);
    expect(login.body.user.dev_mode_allowed).toBe(true);
    expect(login.body.user.dev_mode).toBe(true);
  });
});
