import express from 'express';
import { describe, expect, it } from 'vitest';
import { request, app, prisma } from '../helpers';
import { createOAuthRouter } from '../../src/routes/oauth';
import { readOAuthConfig } from '../../src/oauth/config';
import { cleanClientName } from '../../src/oauth/registration';
import { sweepOAuth } from '../../src/oauth/sweep';
import { ISSUER, LOOPBACK_REDIRECT, registerClient } from './oauthHelpers';

describe('GET /.well-known/oauth-authorization-server', () => {
  it('describes the server, with the endpoints under /oauth and the issuer as iss will carry it', async () => {
    const response = await request(app).get('/.well-known/oauth-authorization-server');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth/authorize`,
      token_endpoint: `${ISSUER}/oauth/token`,
      registration_endpoint: `${ISSUER}/oauth/register`,
      revocation_endpoint: `${ISSUER}/oauth/revoke`,
      introspection_endpoint: `${ISSUER}/oauth/introspect`,
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: [
        'authorization_code',
        'refresh_token',
        'urn:ietf:params:oauth:grant-type:token-exchange',
      ],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
      scopes_supported: ['dossier:read', 'dossier:write', 'lingo:cards:read', 'lingo:cards:write', 'content:delete'],
      authorization_response_iss_parameter_supported: true,
    });
    // No offline_access: Claude asks for it only when listed, and refresh tokens are always issued.
    expect(response.body.scopes_supported).not.toContain('offline_access');
  });
});

describe('POST /oauth/register', () => {
  it('registers a loopback client as a public client', async () => {
    const response = await registerClient();
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      client_name: 'Claude Code',
      redirect_uris: [LOOPBACK_REDIRECT],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
    expect(response.body.client_secret).toBeUndefined();
    expect(response.body.client_secret_expires_at).toBeUndefined();
    const row = await prisma.oAuthClient.findUnique({ where: { id: response.body.client_id } });
    expect(row?.redirectUris).toEqual([LOOPBACK_REDIRECT]);
  });

  it('makes a client public even when it asked for a secret', async () => {
    const response = await registerClient({ token_endpoint_auth_method: 'client_secret_post' });
    expect(response.status).toBe(201);
    expect(response.body.token_endpoint_auth_method).toBe('none');
    expect(response.body.client_secret).toBeUndefined();
    const row = await prisma.oAuthClient.findUnique({ where: { id: response.body.client_id } });
    expect(JSON.stringify(row?.metadata)).not.toContain('client_secret');
  });

  it("accepts Claude's own HTTPS callback, which is on the allow-list", async () => {
    const response = await registerClient({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
    expect(response.status).toBe(201);
  });

  it('refuses an HTTPS callback outside the allow-list', async () => {
    const response = await registerClient({ redirect_uris: ['https://evil.test/callback'] });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_redirect_uri');
    expect(await prisma.oAuthClient.count()).toBe(0);
  });

  it('refuses plain HTTP off loopback and custom schemes', async () => {
    for (const uri of ['http://example.test/callback', 'myapp://callback']) {
      const response = await registerClient({ redirect_uris: [uri] });
      expect(response.status).toBe(400);
    }
    expect(await prisma.oAuthClient.count()).toBe(0);
  });

  it('refuses more than five redirect URIs, and none', async () => {
    const six = Array.from({ length: 6 }, (_, i) => `http://127.0.0.1:${4000 + i}/callback`);
    expect((await registerClient({ redirect_uris: six })).status).toBe(400);
    expect((await registerClient({ redirect_uris: [] })).status).toBe(400);
    const five = six.slice(0, 5);
    expect((await registerClient({ redirect_uris: five })).status).toBe(201);
  });

  it('cleans a name built to mislead: control and bidirectional characters, length', async () => {
    const response = await registerClient({ client_name: 'Visua‮Lex\u0000 ufficiale   ' + 'x'.repeat(200) });
    expect(response.status).toBe(201);
    expect(response.body.client_name).not.toMatch(/[‮\u0000]/);
    expect(response.body.client_name.length).toBeLessThanOrEqual(80);
    expect(cleanClientName('‮⁦')).toBeUndefined();
  });

  it('stops a flood from one address', async () => {
    const config = { ...readOAuthConfig(process.env), registrationsPerHour: 3 };
    const flooded = express();
    flooded.use(createOAuthRouter(config));
    const server = flooded.listen(0, '127.0.0.1');
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        const response = await request(server).post('/oauth/register').send({ redirect_uris: [LOOPBACK_REDIRECT] });
        statuses.push(response.status);
      }
      expect(statuses).toEqual([201, 201, 201, 429]);
    } finally {
      server.close();
    }
  });
});

describe('sweepOAuth', () => {
  it('deletes a client never connected after seven days, and keeps a connected one', async () => {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const make = (id: string) =>
      prisma.oAuthClient.create({ data: { id, redirectUris: [LOOPBACK_REDIRECT], metadata: {}, createdAt: old } });
    await make('never-used');
    await make('connected');
    await make('recent').then(() => prisma.oAuthClient.update({ where: { id: 'recent' }, data: { createdAt: new Date() } }));
    const user = await prisma.user.create({ data: { email: 's@test.local', username: 'sweeper', password: 'x' } });
    await prisma.oAuthGrant.create({ data: { userId: user.id, clientId: 'connected', scopes: [], resource: 'r' } });

    await sweepOAuth();
    const left = (await prisma.oAuthClient.findMany({ orderBy: { id: 'asc' } })).map((c) => c.id);
    expect(left).toEqual(['connected', 'recent']);
  });
});
