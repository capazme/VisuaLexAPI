import { beforeEach, describe, expect, it } from 'vitest';
import { request, app, prisma, createTestUser, type TestUser } from '../helpers';
import {
  ISSUER,
  approvedCode,
  authorizeQuery,
  connectedTokens,
  exchangeCode,
  introspect,
  refresh,
  registeredClientId,
} from './oauthHelpers';

// Each test reproduces one finding of the review of PR #53.

describe('review findings', () => {
  let alice: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('findings-alice');
  });

  it('1. two presentations of one code at once: one wins, and its tokens are revoked by the other', async () => {
    const flow = await approvedCode(alice);
    const [a, b] = await Promise.all([
      exchangeCode(flow.clientId, flow.code, flow.verifier),
      exchangeCode(flow.clientId, flow.code, flow.verifier),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 400]);
    const winner = a.status === 200 ? a : b;
    expect((await introspect(winner.body.access_token)).body).toEqual({ active: false });
  });

  it('1b. two presentations of one refresh token at once: the grant is revoked', async () => {
    const tokens = await connectedTokens(alice);
    const [a, b] = await Promise.all([refresh(tokens.clientId, tokens.refresh), refresh(tokens.clientId, tokens.refresh)]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    const winner = a.status === 200 ? a : b;
    expect((await introspect(winner.body.access_token)).body).toEqual({ active: false });
  });

  it('2. a Basic header with a malformed percent-encoding is invalid_client, not a 500', async () => {
    const tokens = await connectedTokens(alice);
    const malformed = `Basic ${Buffer.from('mcp-omnilex:%').toString('base64')}`;
    const response = await introspect(tokens.access, malformed);
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('invalid_client');
  });

  it('3. refresh accepts and drops offline_access, and a narrower scope does not narrow the chain', async () => {
    const tokens = await connectedTokens(alice);
    const narrow = await refresh(tokens.clientId, tokens.refresh, { scope: 'dossier:read offline_access' });
    expect(narrow.status).toBe(200);
    expect(narrow.body.scope).toBe('dossier:read');
    const again = await refresh(tokens.clientId, narrow.body.refresh_token);
    expect(again.status).toBe(200);
    expect(again.body.scope).toBe('dossier:read dossier:write');
  });

  it('4. an error redirect for a wrong resource or scope carries iss (RFC 9207)', async () => {
    const clientId = await registeredClientId();
    for (const overrides of [{ resource: 'http://localhost:9999/mcp' }, { scope: 'dossier:delete' }, { resource: undefined }]) {
      const response = await request(app).get('/oauth/authorize').query(authorizeQuery(clientId, overrides));
      expect(response.status).toBe(302);
      const location = new URL(response.headers.location);
      expect(location.searchParams.get('error')).toBeTruthy();
      expect(location.searchParams.get('iss')).toBe(ISSUER);
      expect(location.searchParams.get('state')).toBe('state-123');
    }
  });

  it('5. a used code replayed after it expired still revokes what it produced', async () => {
    const flow = await approvedCode(alice);
    const first = await exchangeCode(flow.clientId, flow.code, flow.verifier);
    expect(first.status).toBe(200);
    await prisma.oAuthAuthorizationCode.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const replay = await exchangeCode(flow.clientId, flow.code, flow.verifier);
    expect(replay.body.error).toBe('invalid_grant');
    expect((await introspect(first.body.access_token)).body).toEqual({ active: false });
  });
});
