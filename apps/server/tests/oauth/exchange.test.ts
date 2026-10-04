import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from '../helpers';
import { spendDelegatedQuota } from '../../src/middleware/delegated';
import {
  API_AUDIENCE,
  ISSUER,
  connectedTokens,
  delegatedToken,
  mcpBasicAuth,
  registeredClientId,
  tokenExchange,
} from './oauthHelpers';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('the token exchange (RFC 8693)', () => {
  let alice: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('exchange-alice');
  });

  it('gives the MCP server a two-minute API token for the user, naming itself as the actor', async () => {
    const tokens = await connectedTokens(alice);
    const response = await tokenExchange(tokens.access, { scope: 'dossier:read' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      token_type: 'Bearer',
      scope: 'dossier:read',
    });
    expect(response.body.expires_in).toBeLessThanOrEqual(120);
    const claims = jwt.decode(response.body.access_token) as Record<string, unknown>;
    const grant = await prisma.oAuthGrant.findFirstOrThrow();
    expect(claims).toMatchObject({
      iss: ISSUER,
      aud: API_AUDIENCE,
      sub: alice.id,
      act: { sub: 'mcp-omnilex' },
      client_id: tokens.clientId,
      grant: grant.id,
      scope: 'dossier:read',
    });
    expect((claims.exp as number) - (claims.iat as number)).toBeLessThanOrEqual(120);
    // Signed with its own secret: it can never pass for a user session.
    expect(() => jwt.verify(response.body.access_token, process.env.JWT_SECRET || 'test-secret')).toThrow();
  });

  it("answers only to the MCP server's credential", async () => {
    const tokens = await connectedTokens(alice);
    const publicClient = `Basic ${Buffer.from(`${tokens.clientId}:`).toString('base64')}`;
    for (const authorization of [null, mcpBasicAuth('wrong'), publicClient]) {
      const response = await tokenExchange(tokens.access, {}, authorization);
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('invalid_client');
    }
    // A public client presenting its own client_id in the body is no better.
    const viaBody = await request(app)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        client_id: tokens.clientId,
        subject_token: tokens.access,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        audience: API_AUDIENCE,
        scope: 'dossier:read',
      });
    expect(viaBody.status).toBe(401);
  });

  it('refuses another audience, a missing one, and a wider scope than the subject', async () => {
    const flow = await connectedTokens(alice);
    expect((await tokenExchange(flow.access, { audience: 'http://localhost:3002/mcp' })).body.error).toBe('invalid_target');
    expect((await tokenExchange(flow.access, { audience: undefined })).body.error).toBe('invalid_target');
    expect((await tokenExchange(flow.access, { scope: 'dossier:read dossier:delete' })).body.error).toBe('invalid_scope');
    expect((await tokenExchange(flow.access, { scope: undefined })).body.error).toBe('invalid_scope');
  });

  it('refuses a scope the subject does not carry', async () => {
    const other = await createTestUser('exchange-narrow');
    const { approvedCode, exchangeCode } = await import('./oauthHelpers');
    const flow = await approvedCode(other, { scope: 'dossier:read' });
    const issued = await exchangeCode(flow.clientId, flow.code, flow.verifier);
    const response = await tokenExchange(issued.body.access_token, { scope: 'dossier:write' });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_scope');
  });

  it('refuses an expired, revoked, unknown or refresh subject token, and the wrong token type', async () => {
    const tokens = await connectedTokens(alice);
    expect((await tokenExchange('nope')).body.error).toBe('invalid_grant');
    expect((await tokenExchange(tokens.refresh)).body.error).toBe('invalid_grant');
    expect(
      (await tokenExchange(tokens.access, { subject_token_type: 'urn:ietf:params:oauth:token-type:jwt' })).body.error,
    ).toBe('invalid_request');
    await prisma.oAuthToken.updateMany({ where: { kind: 'ACCESS' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await tokenExchange(tokens.access)).body.error).toBe('invalid_grant');
    const live = await connectedTokens(alice);
    await prisma.oAuthGrant.updateMany({ data: { revokedAt: new Date() } });
    expect((await tokenExchange(live.access)).body.error).toBe('invalid_grant');
  });

  it('refuses a subject token issued for another resource', async () => {
    const tokens = await connectedTokens(alice);
    await prisma.oAuthToken.updateMany({ data: { resource: 'http://localhost:9999/mcp' } });
    expect((await tokenExchange(tokens.access)).body.error).toBe('invalid_grant');
  });
});

describe('the API under an exchanged token', () => {
  let alice: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('delegated-alice');
  });

  it('opens the routes of the table, with the user as the caller', async () => {
    const bob = await createTestUser('delegated-bob');
    await request(app).post('/api/dossiers').set(authHeader(alice)).send({ name: 'Di Alice' });
    await request(app).post('/api/dossiers').set(authHeader(bob)).send({ name: 'Di Bob' });
    const { apiToken } = await delegatedToken(alice);
    const list = await request(app).get('/api/dossiers').set(bearer(apiToken));
    expect(list.status).toBe(200);
    expect(list.body.map((d: { name: string }) => d.name)).toEqual(['Di Alice']);
    const created = await request(app).post('/api/dossiers').set(bearer(apiToken)).send({ name: 'Da Claude' });
    expect(created.status).toBe(201);
    const one = await request(app).get(`/api/dossiers/${created.body.id}`).set(bearer(apiToken));
    expect(one.status).toBe(200);
  });

  it('answers 403 on every route outside the table, whatever the scope', async () => {
    const { apiToken } = await delegatedToken(alice);
    const dossier = await request(app).post('/api/dossiers').set(authHeader(alice)).send({ name: 'Mio' });
    const id = dossier.body.id;
    const outside: [string, string][] = [
      ['delete', `/api/dossiers/${id}`],
      ['put', `/api/dossiers/${id}`],
      ['post', `/api/dossiers/${id}/items`],
      ['post', `/api/dossiers/${id}/reorder`],
      ['get', '/api/folders'],
      ['get', '/api/auth/me'],
      ['get', '/api/auth/export'],
      ['delete', '/api/auth/account'],
      ['get', '/api/oauth/grants'],
      ['get', '/api/admin/users'],
    ];
    for (const [method, path] of outside) {
      const response = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](path).set(bearer(apiToken));
      expect([method, path, response.status]).toEqual([method, path, 403]);
    }
    expect(await prisma.dossier.count({ where: { id } })).toBe(1);
  });

  it('answers 403 on a table route whose scope the token lacks', async () => {
    const { apiToken } = await delegatedToken(alice, 'dossier:read');
    const response = await request(app).post('/api/dossiers').set(bearer(apiToken)).send({ name: 'No' });
    expect(response.status).toBe(403);
    expect(await prisma.dossier.count()).toBe(0);
  });

  it("refuses a client's own access token: it is not for the API", async () => {
    const tokens = await connectedTokens(alice);
    expect((await request(app).get('/api/dossiers').set(bearer(tokens.access))).status).toBe(401);
  });

  it('stops an unexpired exchanged token once its grant is revoked', async () => {
    const { apiToken } = await delegatedToken(alice);
    await prisma.oAuthGrant.updateMany({ data: { revokedAt: new Date() } });
    expect((await request(app).get('/api/dossiers').set(bearer(apiToken))).status).toBe(401);
  });

  it('refuses a forged or tampered delegated token', async () => {
    const { apiToken } = await delegatedToken(alice);
    const claims = jwt.decode(apiToken) as Record<string, unknown>;
    const { exp: _exp, iat: _iat, ...rest } = claims;
    const forged = jwt.sign(rest, process.env.JWT_SECRET || 'test-secret', { expiresIn: 60 });
    expect((await request(app).get('/api/dossiers').set(bearer(forged))).status).toBe(401);
    const [h, , s] = apiToken.split('.');
    const widened = Buffer.from(JSON.stringify({ ...claims, scope: 'dossier:read dossier:write admin' })).toString('base64url');
    expect((await request(app).get('/api/dossiers').set(bearer(`${h}.${widened}.${s}`))).status).toBe(401);
  });

  it('leaves the user session as it was', async () => {
    const response = await request(app).get('/api/dossiers').set(authHeader(alice));
    expect(response.status).toBe(200);
    expect((await request(app).get('/api/folders').set(authHeader(alice))).status).toBe(200);
  });
});

describe('the daily quota of delegated calls', () => {
  let alice: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('quota-alice');
  });

  it('answers 429 with Retry-After once the points are spent, per user', async () => {
    const { apiToken } = await delegatedToken(alice);
    const status = await request(app).get('/api/oauth/quota').set(bearer(apiToken));
    expect(status.status).toBe(200);
    const left = status.body.points.remaining as number;
    await spendDelegatedQuota(alice.id, left);
    const refused = await request(app).get('/api/dossiers').set(bearer(apiToken));
    expect(refused.status).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(refused.body.quota).toBe('points');
    expect(refused.body.resetsAt).toEqual(expect.any(String));
    // Another user is untouched, and so is Alice's own session.
    const bob = await createTestUser('quota-bob');
    const bobs = await delegatedToken(bob);
    expect((await request(app).get('/api/dossiers').set(bearer(bobs.apiToken))).status).toBe(200);
    expect((await request(app).get('/api/dossiers').set(authHeader(alice))).status).toBe(200);
  });

  it('charges a dossier creation two points', async () => {
    const { apiToken } = await delegatedToken(alice);
    const before = (await request(app).get('/api/oauth/quota').set(bearer(apiToken))).body.points.remaining;
    await request(app).post('/api/dossiers').set(bearer(apiToken)).send({ name: 'Uno' });
    const after = (await request(app).get('/api/oauth/quota').set(bearer(apiToken))).body.points.remaining;
    expect(before - after).toBe(2);
  });

  it('refuses the eleventh dossier created in a day through MCP, but not through the user session', async () => {
    const { apiToken } = await delegatedToken(alice);
    for (let i = 1; i <= 10; i++) {
      const response = await request(app).post('/api/dossiers').set(bearer(apiToken)).send({ name: `D${i}` });
      expect(response.status).toBe(201);
    }
    const eleventh = await request(app).post('/api/dossiers').set(bearer(apiToken)).send({ name: 'D11' });
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.quota).toBe('dossier_create');
    expect((await request(app).post('/api/dossiers').set(authHeader(alice)).send({ name: 'Mio' })).status).toBe(201);
    const quota = await request(app).get('/api/oauth/quota').set(bearer(apiToken));
    expect(quota.body.dossierCreations).toMatchObject({ limit: 10, remaining: 0 });
  });

  it('reports what is left and when it renews', async () => {
    const { apiToken } = await delegatedToken(alice);
    const response = await request(app).get('/api/oauth/quota').set(bearer(apiToken));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      points: { limit: expect.any(Number), remaining: expect.any(Number) },
      dossierCreations: { limit: 10, remaining: 10 },
    });
    expect(response.body.points.remaining).toBe(response.body.points.limit);
    expect('resetsAt' in response.body.points).toBe(true);
  });

  it('is readable from the user session too', async () => {
    const response = await request(app).get('/api/oauth/quota').set(authHeader(alice));
    expect(response.status).toBe(200);
    expect(response.body.dossierCreations.limit).toBe(10);
  });
});

describe('review findings on PR #57', () => {
  let alice: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('findings57-alice');
  });

  it('M1. refuses a delegated write whose body is not JSON (a form body would dodge the weight)', async () => {
    const { apiToken } = await delegatedToken(alice);
    const response = await request(app)
      .post('/api/dossiers')
      .set(bearer(apiToken))
      .type('form')
      .send('name=Form');
    expect(response.status).toBe(415);
    expect(await prisma.dossier.count()).toBe(0);
  });

  it('M2. a Bearer value that claims to be a JWT and is not is a 401, not a 500', async () => {
    const bogus = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.bm90IGpzb24.sig';
    expect((await request(app).get('/api/dossiers').set(bearer(bogus))).status).toBe(401);
  });

  it('M3. a refused call costs nothing: points and the creation counter come back', async () => {
    const { apiToken } = await delegatedToken(alice);
    const quota = async () => (await request(app).get('/api/oauth/quota').set(bearer(apiToken))).body;
    const before = await quota();
    const refused = await request(app).post('/api/dossiers').set(bearer(apiToken)).send({ name: '' });
    expect(refused.status).toBe(400);
    const after = await quota();
    expect(after.points.remaining).toBe(before.points.remaining);
    expect(after.dossierCreations.remaining).toBe(before.dossierCreations.remaining);
  });
});
