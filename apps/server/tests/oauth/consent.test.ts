import { beforeEach, describe, expect, it } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from '../helpers';
import { ISSUER, RESOURCE, startAuthorization } from './oauthHelpers';

describe('the consent decision', () => {
  let alice: TestUser;
  let bob: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('consent-alice');
    bob = await createTestUser('consent-bob');
  });

  it('shows what is asked, in words the page can render', async () => {
    const { requestId } = await startAuthorization();
    const response = await request(app).get(`/api/oauth/requests/${requestId}`).set(authHeader(alice));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: requestId,
      client: { name: 'Claude Code', redirectHost: '127.0.0.1', registeredAutomatically: true },
    });
    expect(response.body.scopes.map((s: { scope: string }) => s.scope)).toEqual(['dossier:read', 'dossier:write']);
    for (const s of response.body.scopes) expect(s.label).toMatch(/dossier/i);
    // Nothing the page does not need: no challenge, no state.
    expect(JSON.stringify(response.body)).not.toMatch(/challenge|state-123/);
  });

  it('needs a signed-in user', async () => {
    const { requestId } = await startAuthorization();
    expect((await request(app).get(`/api/oauth/requests/${requestId}`)).status).toBe(401);
    expect((await request(app).post(`/api/oauth/requests/${requestId}/decision`).send({ approve: true })).status).toBe(401);
  });

  it('belongs to the first user who opens it: another user can neither read nor decide it', async () => {
    const { requestId } = await startAuthorization();
    expect((await request(app).get(`/api/oauth/requests/${requestId}`).set(authHeader(alice))).status).toBe(200);
    expect((await request(app).get(`/api/oauth/requests/${requestId}`).set(authHeader(bob))).status).toBe(404);
    const forged = await request(app)
      .post(`/api/oauth/requests/${requestId}/decision`)
      .set(authHeader(bob))
      .send({ approve: true });
    expect(forged.status).toBe(404);
    expect(await prisma.oAuthAuthorizationCode.count()).toBe(0);
  });

  it('approves: one grant, one 60-second code bound to the request, and a redirect with code, state and iss', async () => {
    const { requestId, clientId } = await startAuthorization({ redirect_uri: 'http://127.0.0.1:61001/callback' });
    await request(app).get(`/api/oauth/requests/${requestId}`).set(authHeader(alice));
    const response = await request(app)
      .post(`/api/oauth/requests/${requestId}/decision`)
      .set(authHeader(alice))
      .send({ approve: true });
    expect(response.status).toBe(200);

    const redirect = new URL(response.body.redirectTo);
    expect(`${redirect.origin}${redirect.pathname}`).toBe('http://127.0.0.1:61001/callback');
    expect(redirect.searchParams.get('state')).toBe('state-123');
    // RFC 9207: compared character by character with the metadata's issuer.
    expect(redirect.searchParams.get('iss')).toBe(ISSUER);
    const code = redirect.searchParams.get('code')!;
    expect(code.length).toBeGreaterThanOrEqual(40);

    const rows = await prisma.oAuthAuthorizationCode.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].codeHash).not.toBe(code);
    expect(rows[0]).toMatchObject({
      clientId,
      userId: alice.id,
      redirectUri: 'http://127.0.0.1:61001/callback',
      resource: RESOURCE,
      scopes: ['dossier:read', 'dossier:write'],
      usedAt: null,
    });
    const stored = await prisma.oAuthAuthorizationRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(rows[0].codeChallenge).toBe(stored.codeChallenge);
    const life = rows[0].expiresAt.getTime() - Date.now();
    expect(life).toBeGreaterThan(50_000);
    expect(life).toBeLessThanOrEqual(60_000);

    const grants = await prisma.oAuthGrant.findMany();
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ userId: alice.id, clientId, resource: RESOURCE, revokedAt: null });
  });

  it('decides a request once', async () => {
    const { requestId } = await startAuthorization();
    const decide = () =>
      request(app).post(`/api/oauth/requests/${requestId}/decision`).set(authHeader(alice)).send({ approve: true });
    expect((await decide()).status).toBe(200);
    expect((await decide()).status).toBe(409);
    expect(await prisma.oAuthAuthorizationCode.count()).toBe(1);
  });

  it('refuses an expired request', async () => {
    const { requestId } = await startAuthorization();
    await prisma.oAuthAuthorizationRequest.update({ where: { id: requestId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).get(`/api/oauth/requests/${requestId}`).set(authHeader(alice))).status).toBe(410);
    const response = await request(app)
      .post(`/api/oauth/requests/${requestId}/decision`)
      .set(authHeader(alice))
      .send({ approve: true });
    expect(response.status).toBe(410);
    expect(await prisma.oAuthAuthorizationCode.count()).toBe(0);
  });

  it('refuses with access_denied, and creates nothing', async () => {
    const { requestId } = await startAuthorization();
    const response = await request(app)
      .post(`/api/oauth/requests/${requestId}/decision`)
      .set(authHeader(alice))
      .send({ approve: false });
    expect(response.status).toBe(200);
    const redirect = new URL(response.body.redirectTo);
    expect(`${redirect.origin}${redirect.pathname}`).toBe('http://127.0.0.1:33418/callback');
    expect(redirect.searchParams.get('error')).toBe('access_denied');
    expect(redirect.searchParams.get('state')).toBe('state-123');
    expect(redirect.searchParams.get('iss')).toBe(ISSUER);
    expect(redirect.searchParams.get('code')).toBeNull();
    expect(await prisma.oAuthGrant.count()).toBe(0);
    expect(await prisma.oAuthAuthorizationCode.count()).toBe(0);
  });

  it('reuses a live grant for the same client', async () => {
    const first = await startAuthorization();
    await request(app).post(`/api/oauth/requests/${first.requestId}/decision`).set(authHeader(alice)).send({ approve: true });
    // A second sign-in of the same registered client.
    const again = await request(app)
      .get('/oauth/authorize')
      .query({
        response_type: 'code',
        client_id: first.clientId,
        redirect_uri: 'http://127.0.0.1:33418/callback',
        code_challenge: 'x'.repeat(43),
        code_challenge_method: 'S256',
        resource: RESOURCE,
      });
    const requestId = new URL(again.headers.location).searchParams.get('request')!;
    await request(app).post(`/api/oauth/requests/${requestId}/decision`).set(authHeader(alice)).send({ approve: true });
    expect(await prisma.oAuthGrant.count()).toBe(1);
    expect(await prisma.oAuthAuthorizationCode.count()).toBe(2);
  });

  it('answers 404 for an unknown request and 400 for a body that is not a decision', async () => {
    expect((await request(app).get('/api/oauth/requests/00000000-0000-0000-0000-000000000000').set(authHeader(alice))).status).toBe(404);
    const { requestId } = await startAuthorization();
    const response = await request(app)
      .post(`/api/oauth/requests/${requestId}/decision`)
      .set(authHeader(alice))
      .send({ approve: 'yes' });
    expect(response.status).toBe(400);
  });
});
