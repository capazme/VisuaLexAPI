import { describe, expect, it } from 'vitest';
import { app, authHeader, bearerHeader, cookieOnly, createTestUser, prisma, request, type TestUser } from './helpers';
import { connectedTokens, introspect, startAuthorization } from './oauth/oauthHelpers';
import { createWebSession, LAST_USED_RESOLUTION_MS, sessionCookieName, sweepWebSessions } from '../src/auth/webSession';
import { sha256 } from '../src/oauth/hash';

/**
 * The web's session in a cookie (A.1, step 1 of spec 2026-11-16-web-session-cookies-design). Every test speaks from its
 * own address (the app trusts the loopback proxy), so the sign-in limits of one do not reach another.
 */
const from = (address: string) => ({ 'X-Forwarded-For': address });
const WEB = { 'X-VisuaLex-Client': 'web' };
const DAY = 24 * 60 * 60 * 1000;

const signIn = (user: TestUser, address: string, headers: Record<string, string> = WEB) =>
  request(app).post('/api/auth/login').set(from(address)).set(headers).send({ email: user.email, password: 'test-password' });

/** The session secret a response's Set-Cookie carries, or null. */
function cookieSecret(response: { headers: Record<string, unknown> }): string | null {
  const cookies = (response.headers['set-cookie'] as string[] | undefined) ?? [];
  const ours = cookies.find((cookie) => cookie.startsWith(`${sessionCookieName()}=`));
  if (!ours) return null;
  const value = ours.split(';')[0].split('=')[1];
  return value || null;
}

const asCookie = (secret: string) => ({ Cookie: `${sessionCookieName()}=${secret}`, ...WEB });
const me = (headers: Record<string, string>) => request(app).get('/api/auth/me').set(headers);

describe('signing in from the web', () => {
  it('opens a session in an HttpOnly, SameSite=Strict cookie and answers the user, without tokens', async () => {
    const user = await createTestUser('ws-sign-in');
    const response = await signIn(user, '198.18.0.1');
    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(user.id);
    expect(response.body.access_token).toBeUndefined();
    expect(response.body.refresh_token).toBeUndefined();

    const cookie = (response.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith(`${sessionCookieName()}=`))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=2592000/);

    const secret = cookieSecret(response)!;
    const row = await prisma.webSession.findUniqueOrThrow({ where: { secretHash: sha256(secret) } });
    expect(row.userId).toBe(user.id);
    expect(row.secretHash).not.toBe(secret);
    expect((await me(asCookie(secret))).body.id).toBe(user.id);
  });

  it('keeps a label of the browser and system, never the raw User-Agent', async () => {
    const user = await createTestUser('ws-label');
    const firefox = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:132.0) Gecko/20100101 Firefox/132.0';
    const response = await signIn(user, '198.18.0.2', { ...WEB, 'User-Agent': firefox });
    const row = await prisma.webSession.findUniqueOrThrow({ where: { secretHash: sha256(cookieSecret(response)!) } });
    expect(row.label).toBe('Firefox su macOS');
  });

  it('answers the tokens as before, and sets no cookie, without the web header (the current web, until it moves)', async () => {
    const user = await createTestUser('ws-old-web');
    const response = await signIn(user, '198.18.0.3', {});
    expect(response.status).toBe(200);
    expect(typeof response.body.access_token).toBe('string');
    expect(cookieSecret(response)).toBeNull();
  });

  it('ends the session the browser presented and opens a new one (no fixed session)', async () => {
    const user = await createTestUser('ws-fixation');
    const first = cookieSecret(await signIn(user, '198.18.0.4'))!;
    const second = await request(app).post('/api/auth/login').set(from('198.18.0.4')).set(asCookie(first))
      .send({ email: user.email, password: 'test-password' });
    const renewed = cookieSecret(second)!;
    expect(renewed).not.toBe(first);
    expect((await me(asCookie(first))).status).toBe(401);
    expect((await me(asCookie(renewed))).status).toBe(200);
  });

  it('lets the current web sign in and refresh without the header even with a cookie left in the browser', async () => {
    const user = await createTestUser('ws-leftover');
    const response = await signIn(user, '198.18.0.6', cookieOnly(user));
    expect(response.status).toBe(200);
    expect(typeof response.body.access_token).toBe('string');
    expect(cookieSecret(response)).toBeNull();
    const refresh = await request(app).post('/api/auth/refresh').set(from('198.18.0.6')).set(cookieOnly(user))
      .send({ refresh_token: response.body.refresh_token });
    expect(refresh.status).toBe(200);
  });

  it('refuses a sign-in with the web header from another site (login CSRF)', async () => {
    const user = await createTestUser('ws-login-csrf');
    const response = await signIn(user, '198.18.0.5', { ...WEB, Origin: 'https://evil.example' });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('csrf_refused');
    expect(cookieSecret(response)).toBeNull();
  });
});

describe('a session that is over', () => {
  it('is refused past its absolute limit', async () => {
    const user = await createTestUser('ws-expired');
    await prisma.webSession.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await me(authHeader(user))).status).toBe(401);
  });

  it('is refused after 7 days unused', async () => {
    const user = await createTestUser('ws-idle');
    await prisma.webSession.updateMany({ where: { userId: user.id }, data: { lastUsedAt: new Date(Date.now() - 7 * DAY - 1000) } });
    expect((await me(authHeader(user))).status).toBe(401);
  });

  it('is refused for a disabled user', async () => {
    const user = await createTestUser('ws-disabled');
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    expect((await me(authHeader(user))).status).toBe(401);
  });

  it('is refused with an unknown secret', async () => {
    expect((await me(asCookie('x'.repeat(43)))).status).toBe(401);
  });

  it('records its last use at most every 10 minutes', async () => {
    const user = await createTestUser('ws-last-used');
    const recent = new Date(Date.now() - LAST_USED_RESOLUTION_MS + 60_000);
    await prisma.webSession.updateMany({ where: { userId: user.id }, data: { lastUsedAt: recent } });
    await me(authHeader(user));
    const kept = await prisma.webSession.findFirstOrThrow({ where: { userId: user.id } });
    expect(kept.lastUsedAt.getTime()).toBe(recent.getTime());

    const old = new Date(Date.now() - LAST_USED_RESOLUTION_MS - 60_000);
    await prisma.webSession.updateMany({ where: { userId: user.id }, data: { lastUsedAt: old } });
    await me(authHeader(user));
    await expect.poll(async () => (await prisma.webSession.findFirstOrThrow({ where: { userId: user.id } })).lastUsedAt.getTime())
      .toBeGreaterThan(old.getTime());
  });

  it('is swept with the other dead rows, and the live one stays', async () => {
    const user = await createTestUser('ws-sweep');
    await createWebSession(user.id, 'vitest');
    await createWebSession(user.id, 'vitest');
    const rows = await prisma.webSession.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
    await prisma.webSession.update({ where: { id: rows[0].id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await prisma.webSession.update({ where: { id: rows[1].id }, data: { lastUsedAt: new Date(Date.now() - 8 * DAY) } });
    await sweepWebSessions();
    expect((await prisma.webSession.findMany({ where: { userId: user.id } })).map((row) => row.id)).toEqual([rows[2].id]);
  });
});

describe('signing out and the list of sessions', () => {
  it('signs out: the row goes, the cookie is cleared, the session no longer opens anything', async () => {
    const user = await createTestUser('ws-logout');
    const response = await request(app).post('/api/auth/logout').set(authHeader(user));
    expect(response.status).toBe(204);
    expect((response.headers['set-cookie'] as unknown as string[]).join(';')).toMatch(new RegExp(`${sessionCookieName()}=;`));
    expect(await prisma.webSession.count({ where: { userId: user.id } })).toBe(0);
    expect((await me(authHeader(user))).status).toBe(401);
  });

  it('signs out with no session too (204), so a dead tab can always leave', async () => {
    expect((await request(app).post('/api/auth/logout').set(WEB)).status).toBe(204);
  });

  it('lists the user’s own sessions, the current one marked, and none of anyone else', async () => {
    const user = await createTestUser('ws-list');
    const other = await createTestUser('ws-list-other');
    await createWebSession(user.id, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1');
    const response = await request(app).get('/api/auth/sessions').set(authHeader(user));
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(response.body.map((s: { label: string }) => s.label)).toContain('Safari su iOS');
    const otherIds = (await prisma.webSession.findMany({ where: { userId: other.id } })).map((row) => row.id);
    expect(response.body.map((s: { id: string }) => s.id)).not.toContain(otherIds[0]);
    expect(Object.keys(response.body[0]).sort()).toEqual(['created_at', 'current', 'id', 'label', 'last_used_at']);
  });

  it('ends one of the user’s own sessions; another user’s, or an unknown one, is 404', async () => {
    const user = await createTestUser('ws-end-one');
    const other = await createTestUser('ws-end-other');
    const phone = await createWebSession(user.id, 'vitest');
    const phoneRow = await prisma.webSession.findUniqueOrThrow({ where: { secretHash: sha256(phone) } });
    const otherRow = await prisma.webSession.findFirstOrThrow({ where: { userId: other.id } });

    expect((await request(app).delete(`/api/auth/sessions/${otherRow.id}`).set(authHeader(user))).status).toBe(404);
    expect((await me(authHeader(other))).status).toBe(200);
    expect((await request(app).delete('/api/auth/sessions/00000000-0000-0000-0000-000000000000').set(authHeader(user))).status).toBe(404);

    expect((await request(app).delete(`/api/auth/sessions/${phoneRow.id}`).set(authHeader(user))).status).toBe(204);
    expect((await me(asCookie(phone))).status).toBe(401);
    expect((await me(authHeader(user))).status).toBe(200);
  });

  it('ends every session of the user, this one included («Esci da tutti i dispositivi»)', async () => {
    const user = await createTestUser('ws-all');
    const phone = await createWebSession(user.id, 'vitest');
    expect((await request(app).post('/api/auth/logout-all').set(authHeader(user))).status).toBe(204);
    expect((await me(authHeader(user))).status).toBe(401);
    expect((await me(asCookie(phone))).status).toBe(401);
  });
});

describe('what ends sessions (D3)', () => {
  it('a change of one’s own password ends the other sessions, not the one in use', async () => {
    const user = await createTestUser('ws-change');
    const phone = await createWebSession(user.id, 'vitest');
    const response = await request(app).put('/api/auth/change-password').set(authHeader(user))
      .send({ current_password: 'test-password', new_password: 'Newpassword1' });
    expect(response.status).toBe(200);
    expect((await me(authHeader(user))).status).toBe(200);
    expect((await me(asCookie(phone))).status).toBe(401);
  });

  it('an administrator’s password reset ends every session and revokes every connected application', async () => {
    const admin = await createTestUser('ws-admin');
    await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: true } });
    const user = await createTestUser('ws-reset');
    const connected = await connectedTokens(user);
    expect((await introspect(connected.access)).body.active).toBe(true);

    const response = await request(app).post(`/api/admin/users/${user.id}/reset-password`).set(authHeader(admin))
      .send({ newPassword: 'Resetpass1' });
    expect(response.status).toBe(200);
    expect((await me(authHeader(user))).status).toBe(401);
    expect((await introspect(connected.access)).body.active).toBe(false);
    expect(await prisma.oAuthGrant.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect((await me(authHeader(admin))).status).toBe(200);
  });

  it('a deactivation by the administrator deletes the sessions', async () => {
    const admin = await createTestUser('ws-admin-off');
    await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: true } });
    const user = await createTestUser('ws-off');
    expect((await request(app).put(`/api/admin/users/${user.id}`).set(authHeader(admin)).send({ isActive: false })).status).toBe(200);
    expect(await prisma.webSession.count({ where: { userId: user.id } })).toBe(0);
  });

  it('an account deletion takes its sessions with it', async () => {
    const user = await createTestUser('ws-delete');
    const response = await request(app).delete('/api/auth/account').set(authHeader(user))
      .send({ password: 'test-password', confirmation: 'ELIMINA ACCOUNT' });
    expect(response.status).toBe(204);
    expect(await prisma.webSession.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe('requests another site starts (CSRF)', () => {
  it('refuses a write with the session cookie and no web header, with code csrf_refused', async () => {
    const user = await createTestUser('ws-csrf-plain');
    const response = await request(app).post('/api/folders').set(cookieOnly(user)).send({ name: 'Da altrove' });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('csrf_refused');
    expect(await prisma.folder.count({ where: { userId: user.id } })).toBe(0);
  });

  it('refuses a write with the web header from an origin it does not know', async () => {
    const user = await createTestUser('ws-csrf-origin');
    const response = await request(app).post('/api/folders').set(authHeader(user)).set('Origin', 'https://evil.example')
      .send({ name: 'Da altrove' });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('csrf_refused');
  });

  it('takes a write with the web header from the request’s own host (the app opened by another name)', async () => {
    const user = await createTestUser('ws-csrf-host');
    const response = await request(app).post('/api/folders').set(authHeader(user))
      .set('Host', 'visualex.home.arpa:8080').set('Origin', 'http://visualex.home.arpa:8080').send({ name: 'Mia' });
    expect(response.status).toBe(201);
  });

  it('takes a write with a Bearer token and no web header, as the current web sends it', async () => {
    const user = await createTestUser('ws-csrf-bearer');
    const response = await request(app).post('/api/folders').set(bearerHeader(user)).send({ name: 'Mia' });
    expect(response.status).toBe(201);
  });

  it('does not hold the MERL-T callbacks to it (their shared secret is their proof)', async () => {
    const user = await createTestUser('ws-csrf-internal');
    const response = await request(app).post('/api/merlt/internal/job-callback').set(cookieOnly(user)).send({});
    expect(response.body.code).not.toBe('csrf_refused');
  });

  it.each([
    ['the OAuth consent decision', 'post', 'consent'],
    ['the account deletion', 'delete', '/api/auth/account'],
    ['the password change', 'put', '/api/auth/change-password'],
    ['an administrator’s route', 'post', '/api/admin/users'],
  ] as const)('protects %s, which the Authorization header protected before', async (_what, method, path) => {
    const user = await createTestUser(`ws-csrf-${method}-${path.length}`);
    await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
    const target = path === 'consent' ? `/api/oauth/requests/${(await startAuthorization()).requestId}/decision` : path;
    const response = await request(app)[method](target).set(cookieOnly(user)).send({ approve: true });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('csrf_refused');
  });
});

describe('the session cookie elsewhere in the server', () => {
  it('counts a web user as a user in the limits, not as an address', async () => {
    const user = await createTestUser('ws-tier');
    const response = await request(app).get('/api/folders').set(authHeader(user));
    expect(response.headers['ratelimit-limit']).toBe('300');
  });

  it('never falls back to the cookie when a Bearer token is there and does not verify', async () => {
    const user = await createTestUser('ws-bad-bearer');
    expect((await me({ Authorization: 'Bearer not-a-jwt', ...cookieOnly(user) })).status).toBe(401);
    const write = await request(app).post('/api/folders').set({ Authorization: 'Bearer not-a-jwt', ...cookieOnly(user) })
      .send({ name: 'Da altrove' });
    expect(write.status).toBe(401);
    expect(await prisma.folder.count({ where: { userId: user.id } })).toBe(0);
  });

  it('lets a Bearer token win over a cookie, until the web has moved', async () => {
    const alice = await createTestUser('ws-alice');
    const bob = await createTestUser('ws-bob');
    const response = await me({ ...bearerHeader(alice), ...cookieOnly(bob) });
    expect(response.body.id).toBe(alice.id);
  });

  it('opens the ingress’s login check for the scraping routes, and holds a cookie write there to the web header', async () => {
    const user = await createTestUser('ws-verify');
    const verify = (headers: Record<string, string>) =>
      request(app).get('/api/auth/verify').set({ 'X-Forwarded-Uri': '/export_pdf', ...headers });
    expect((await verify({ ...cookieOnly(user), 'X-Forwarded-Method': 'GET' })).status).toBe(204);
    const cross = await verify({ ...cookieOnly(user), 'X-Forwarded-Method': 'POST' });
    expect(cross.status).toBe(403);
    expect(cross.body.code).toBe('csrf_refused');
    expect((await verify({ ...authHeader(user), 'X-Forwarded-Method': 'POST' })).status).toBe(204);
    expect((await verify({ ...bearerHeader(user), 'X-Forwarded-Method': 'POST' })).status).toBe(204);
  });
});
