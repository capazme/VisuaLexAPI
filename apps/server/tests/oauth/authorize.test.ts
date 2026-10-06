import { describe, expect, it } from 'vitest';
import { request, app, prisma } from '../helpers';
import { authorizeQuery, LOOPBACK_REDIRECT, registeredClientId } from './oauthHelpers';

const CONSENT = 'http://localhost:5173/connect';

describe('GET /oauth/authorize', () => {
  it('stores the request and sends the browser to the consent page, without issuing a code', async () => {
    const clientId = await registeredClientId();
    const response = await request(app).get('/oauth/authorize').query(authorizeQuery(clientId));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.location);
    expect(`${location.origin}${location.pathname}`).toBe(CONSENT);
    const id = location.searchParams.get('request');
    expect(location.searchParams.get('code')).toBeNull();

    const stored = await prisma.oAuthAuthorizationRequest.findUniqueOrThrow({ where: { id: id! } });
    expect(stored).toMatchObject({
      clientId,
      userId: null,
      redirectUri: LOOPBACK_REDIRECT,
      state: 'state-123',
      scopes: ['dossier:read', 'dossier:write'],
      resource: 'http://localhost:3002/mcp',
      decidedAt: null,
    });
    const lifetime = stored.expiresAt.getTime() - stored.createdAt.getTime();
    expect(lifetime).toBeGreaterThan(9 * 60_000);
    expect(lifetime).toBeLessThanOrEqual(10 * 60_000 + 1000);
    expect(await prisma.oAuthAuthorizationCode.count()).toBe(0);
  });

  it('is safe to call twice: two pending requests, no code, no grant', async () => {
    const clientId = await registeredClientId();
    const query = authorizeQuery(clientId);
    const first = await request(app).get('/oauth/authorize').query(query);
    const second = await request(app).get('/oauth/authorize').query(query);
    expect([first.status, second.status]).toEqual([302, 302]);
    expect(await prisma.oAuthAuthorizationRequest.count()).toBe(2);
    expect(await prisma.oAuthAuthorizationCode.count()).toBe(0);
    expect(await prisma.oAuthGrant.count()).toBe(0);
  });

  it('accepts the registered loopback redirect on another port', async () => {
    const clientId = await registeredClientId();
    const response = await request(app)
      .get('/oauth/authorize')
      .query(authorizeQuery(clientId, { redirect_uri: 'http://127.0.0.1:61000/callback' }));
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('/connect?request=');
  });

  it('drops offline_access and gives every scope when none is asked', async () => {
    const clientId = await registeredClientId();
    await request(app).get('/oauth/authorize').query(authorizeQuery(clientId, { scope: 'dossier:read offline_access' }));
    await request(app).get('/oauth/authorize').query(authorizeQuery(clientId, { scope: undefined }));
    const stored = await prisma.oAuthAuthorizationRequest.findMany({ orderBy: { createdAt: 'asc' } });
    expect(stored.map((r) => r.scopes)).toEqual([['dossier:read'], ['dossier:read', 'dossier:write', 'lingo:cards:read', 'lingo:cards:write']]);
  });

  // `state` comes back when the SDK's handler got as far as reading it: not when
  // the request's shape itself is wrong (no challenge, a plain one), which it
  // rejects in one parse before reading anything.
  async function expectErrorRedirect(overrides: Record<string, string | undefined>, error: string, stateReturned = true) {
    const clientId = await registeredClientId();
    const response = await request(app).get('/oauth/authorize').query(authorizeQuery(clientId, overrides));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.location);
    expect(`${location.origin}${location.pathname}`).toBe(LOOPBACK_REDIRECT);
    expect(location.searchParams.get('error')).toBe(error);
    expect(location.searchParams.get('state')).toBe(stateReturned ? 'state-123' : null);
    expect(await prisma.oAuthAuthorizationRequest.count()).toBe(0);
  }

  it('refuses a missing challenge', () => expectErrorRedirect({ code_challenge: undefined }, 'invalid_request', false));
  it('refuses the plain challenge method', () => expectErrorRedirect({ code_challenge_method: 'plain' }, 'invalid_request', false));
  it('refuses a missing resource', () => expectErrorRedirect({ resource: undefined }, 'invalid_request'));
  it('refuses another resource', () => expectErrorRedirect({ resource: 'http://localhost:9999/mcp' }, 'invalid_target'));
  it('refuses an unknown scope', () => expectErrorRedirect({ scope: 'dossier:read dossier:delete' }, 'invalid_scope'));

  it('shows an error, and redirects nowhere, for an unknown client', async () => {
    const response = await request(app).get('/oauth/authorize').query(authorizeQuery('no-such-client'));
    expect(response.status).toBe(400);
    expect(response.headers.location).toBeUndefined();
    expect(response.body.error).toBe('invalid_client');
  });

  it('shows an error, and never follows, an unregistered redirect', async () => {
    const clientId = await registeredClientId();
    for (const redirect of ['https://evil.test/callback', 'http://127.0.0.1:33418/elsewhere', 'http://localhost:33418/callback']) {
      const response = await request(app).get('/oauth/authorize').query(authorizeQuery(clientId, { redirect_uri: redirect }));
      expect(response.status).toBe(400);
      expect(response.headers.location).toBeUndefined();
    }
    expect(await prisma.oAuthAuthorizationRequest.count()).toBe(0);
  });
});
