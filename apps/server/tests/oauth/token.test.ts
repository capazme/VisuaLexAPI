import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from '../helpers';
import { sha256 } from '../../src/oauth/hash';
import {
  MCP_CLIENT_SECRET,
  RESOURCE,
  approvedCode,
  connectedTokens,
  exchangeCode,
  introspect,
  mcpBasicAuth,
  refresh,
  registeredClientId,
} from './oauthHelpers';

describe('POST /oauth/token — authorization code', () => {
  let alice: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('token-alice');
  });

  it('exchanges a code and its verifier for an 8-hour access token and a refresh token, stored only as hashes', async () => {
    const flow = await approvedCode(alice);
    const response = await exchangeCode(flow.clientId, flow.code, flow.verifier);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({ token_type: 'Bearer', expires_in: 8 * 60 * 60, scope: 'dossier:read dossier:write' });
    const { access_token: access, refresh_token: refreshToken } = response.body;
    expect(access).toEqual(expect.any(String));
    expect(refreshToken).toEqual(expect.any(String));

    const tokens = await prisma.oAuthToken.findMany();
    expect(tokens.map((t) => t.kind).sort()).toEqual(['ACCESS', 'REFRESH']);
    for (const t of tokens) {
      expect([access, refreshToken]).not.toContain(t.tokenHash);
      expect(t.resource).toBe(RESOURCE);
    }
    expect(tokens.find((t) => t.kind === 'ACCESS')!.tokenHash).toBe(sha256(access));
    const refreshRow = tokens.find((t) => t.kind === 'REFRESH')!;
    const days = (refreshRow.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('refuses a wrong verifier', async () => {
    const flow = await approvedCode(alice);
    const response = await exchangeCode(flow.clientId, flow.code, 'w'.repeat(43));
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_grant');
    expect(await prisma.oAuthToken.count()).toBe(0);
  });

  it('refuses a code used twice, and revokes what the first use produced', async () => {
    const flow = await approvedCode(alice);
    const first = await exchangeCode(flow.clientId, flow.code, flow.verifier);
    expect(first.status).toBe(200);
    const second = await exchangeCode(flow.clientId, flow.code, flow.verifier);
    expect(second.status).toBe(400);
    expect(second.body.error).toBe('invalid_grant');
    expect((await introspect(first.body.access_token)).body).toEqual({ active: false });
    expect((await refresh(flow.clientId, first.body.refresh_token)).status).toBe(400);
  });

  it('refuses an expired code', async () => {
    const flow = await approvedCode(alice);
    await prisma.oAuthAuthorizationCode.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const response = await exchangeCode(flow.clientId, flow.code, flow.verifier);
    expect(response.body.error).toBe('invalid_grant');
  });

  it('refuses a code presented by another client', async () => {
    const flow = await approvedCode(alice);
    const other = await registeredClientId();
    const response = await exchangeCode(other, flow.code, flow.verifier);
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_grant');
  });

  it('refuses another redirect URI, and another or a missing resource', async () => {
    for (const extra of [
      { redirect_uri: 'http://127.0.0.1:33418/elsewhere' },
      { resource: 'http://localhost:9999/mcp' },
      { resource: undefined },
    ]) {
      const flow = await approvedCode(alice);
      const response = await exchangeCode(flow.clientId, flow.code, flow.verifier, extra);
      expect(response.status).toBe(400);
      expect(['invalid_grant', 'invalid_target', 'invalid_request']).toContain(response.body.error);
    }
    expect(await prisma.oAuthToken.count()).toBe(0);
  });

  it('refuses a code whose grant was revoked meanwhile', async () => {
    const flow = await approvedCode(alice);
    await prisma.oAuthGrant.updateMany({ data: { revokedAt: new Date() } });
    const response = await exchangeCode(flow.clientId, flow.code, flow.verifier);
    expect(response.body.error).toBe('invalid_grant');
  });
});

describe('POST /oauth/token — refresh', () => {
  let alice: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('refresh-alice');
  });

  it('rotates: a new pair, and the old access token keeps working until it expires', async () => {
    const tokens = await connectedTokens(alice);
    const response = await refresh(tokens.clientId, tokens.refresh);
    expect(response.status).toBe(200);
    expect(response.body.refresh_token).not.toBe(tokens.refresh);
    expect(response.body.access_token).not.toBe(tokens.access);
    expect((await introspect(response.body.access_token)).body.active).toBe(true);
  });

  it('revokes the whole grant when a rotated refresh token comes back', async () => {
    const tokens = await connectedTokens(alice);
    const rotated = await refresh(tokens.clientId, tokens.refresh);
    const replay = await refresh(tokens.clientId, tokens.refresh);
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe('invalid_grant');
    expect((await introspect(rotated.body.access_token)).body).toEqual({ active: false });
    expect((await refresh(tokens.clientId, rotated.body.refresh_token)).body.error).toBe('invalid_grant');
    expect((await prisma.oAuthGrant.findFirstOrThrow()).revokedAt).not.toBeNull();
  });

  it('answers invalid_grant for an expired, unknown or foreign refresh token', async () => {
    const tokens = await connectedTokens(alice);
    const other = await registeredClientId();
    expect((await refresh(other, tokens.refresh)).body.error).toBe('invalid_grant');
    expect((await refresh(tokens.clientId, 'not-a-token')).body.error).toBe('invalid_grant');
    expect((await refresh(tokens.clientId, tokens.access)).body.error).toBe('invalid_grant');
    await prisma.oAuthToken.updateMany({ where: { kind: 'REFRESH' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await refresh(tokens.clientId, tokens.refresh)).body.error).toBe('invalid_grant');
  });

  it('refuses a wider scope than the grant gave', async () => {
    const flow = await approvedCode(alice, { scope: 'dossier:read' });
    const issued = await exchangeCode(flow.clientId, flow.code, flow.verifier);
    const response = await refresh(flow.clientId, issued.body.refresh_token, { scope: 'dossier:read dossier:write' });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_scope');
  });
});

describe('POST /oauth/introspect', () => {
  let alice: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('introspect-alice');
  });

  it("tells the MCP server who a live access token belongs to, and marks the grant used", async () => {
    const tokens = await connectedTokens(alice);
    const grant = await prisma.oAuthGrant.findFirstOrThrow();
    const response = await introspect(tokens.access);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      active: true,
      scope: 'dossier:read dossier:write',
      sub: alice.id,
      client_id: tokens.clientId,
      aud: RESOURCE,
      grant: grant.id,
      token_type: 'Bearer',
    });
    expect(response.body.exp).toBeGreaterThan(Date.now() / 1000 + 7.9 * 3600);
    expect((await prisma.oAuthGrant.findFirstOrThrow()).lastUsedAt).not.toBeNull();
  });

  it('answers inactive for an expired, revoked, unknown or refresh token, and for a disabled user', async () => {
    const tokens = await connectedTokens(alice);
    expect((await introspect('nope')).body).toEqual({ active: false });
    expect((await introspect(tokens.refresh)).body).toEqual({ active: false });

    await prisma.user.update({ where: { id: alice.id }, data: { isActive: false } });
    expect((await introspect(tokens.access)).body).toEqual({ active: false });
    await prisma.user.update({ where: { id: alice.id }, data: { isActive: true } });

    await prisma.oAuthToken.updateMany({ where: { kind: 'ACCESS' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await introspect(tokens.access)).body).toEqual({ active: false });

    const live = await connectedTokens(alice);
    await prisma.oAuthGrant.updateMany({ data: { revokedAt: new Date() } });
    expect((await introspect(live.access)).body).toEqual({ active: false });
  });

  it("answers only to the MCP server's own credential", async () => {
    const tokens = await connectedTokens(alice);
    for (const authorization of [
      null,
      mcpBasicAuth('wrong-secret'),
      `Basic ${Buffer.from(`${tokens.clientId}:`).toString('base64')}`,
      `Bearer ${tokens.access}`,
    ]) {
      const response = await introspect(tokens.access, authorization);
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('invalid_client');
    }
  });
});

describe('POST /oauth/revoke', () => {
  it("revokes a client's own token; a refresh token takes its chain with it", async () => {
    const alice = await createTestUser('revoke-alice');
    const tokens = await connectedTokens(alice);
    const response = await request(app).post('/oauth/revoke').type('form').send({ client_id: tokens.clientId, token: tokens.refresh });
    expect(response.status).toBe(200);
    expect((await introspect(tokens.access)).body).toEqual({ active: false });
    expect((await refresh(tokens.clientId, tokens.refresh)).body.error).toBe('invalid_grant');
  });

  it("leaves another client's token alone", async () => {
    const alice = await createTestUser('revoke-other');
    const tokens = await connectedTokens(alice);
    const other = await registeredClientId();
    const response = await request(app).post('/oauth/revoke').type('form').send({ client_id: other, token: tokens.access });
    expect(response.status).toBe(200);
    expect((await introspect(tokens.access)).body.active).toBe(true);
  });
});

describe('the connected applications of a user', () => {
  it('lists the live grants and revokes one, which stops its tokens at once', async () => {
    const alice = await createTestUser('grants-alice');
    const tokens = await connectedTokens(alice);
    const list = await request(app).get('/api/oauth/grants').set(authHeader(alice));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      clientName: 'Claude Code',
      redirectHost: '127.0.0.1',
      scopes: ['dossier:read', 'dossier:write'],
    });
    expect(list.body[0].createdAt).toEqual(expect.any(String));

    const revoked = await request(app).delete(`/api/oauth/grants/${list.body[0].id}`).set(authHeader(alice));
    expect(revoked.status).toBe(204);
    expect((await introspect(tokens.access)).body).toEqual({ active: false });
    expect((await request(app).get('/api/oauth/grants').set(authHeader(alice))).body).toEqual([]);
  });

  it("does not show or revoke another user's grant", async () => {
    const alice = await createTestUser('grants-owner');
    const bob = await createTestUser('grants-intruder');
    const tokens = await connectedTokens(alice);
    const grant = await prisma.oAuthGrant.findFirstOrThrow();
    expect((await request(app).get('/api/oauth/grants').set(authHeader(bob))).body).toEqual([]);
    expect((await request(app).delete(`/api/oauth/grants/${grant.id}`).set(authHeader(bob))).status).toBe(404);
    expect((await introspect(tokens.access)).body.active).toBe(true);
  });
});

describe('secrets in logs and answers', () => {
  const spies: ReturnType<typeof vi.spyOn>[] = [];
  afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

  it('never writes a code or a token to a log line or an error body', async () => {
    const lines: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      spies.push(vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' '))));
    }
    const alice = await createTestUser('secrets-alice');
    const flow = await approvedCode(alice);
    const issued = await exchangeCode(flow.clientId, flow.code, flow.verifier);
    const replay = await exchangeCode(flow.clientId, flow.code, flow.verifier);
    const badRefresh = await refresh(flow.clientId, issued.body.refresh_token + 'x');
    const secrets = [flow.code, issued.body.access_token, issued.body.refresh_token, MCP_CLIENT_SECRET];
    const bodies = JSON.stringify([replay.body, badRefresh.body]);
    for (const secret of secrets) {
      expect(bodies).not.toContain(secret);
      expect(lines.join('\n')).not.toContain(secret);
    }
  });
});
