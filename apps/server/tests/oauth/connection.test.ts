import { describe, expect, it } from 'vitest';
import { request, app, createTestUser, authHeader } from '../helpers';
import { delegated } from '../delegatedHelper';
import { findDelegatedRoute } from '../../src/oauth/delegatedRoutes';
import { SCOPES, oauthConfig } from '../../src/oauth/config';
import { SCOPE_LABELS } from '../../src/oauth/consent';
import { RESOURCE } from './oauthHelpers';

describe('GET /api/oauth/connection — what the «Collega un\'app AI» page shows', () => {
  it("answers the MCP server's address and every scope worded as the consent page words it", async () => {
    const alice = await createTestUser('connection-alice');
    const response = await request(app).get('/api/oauth/connection').set(authHeader(alice));
    expect(response.status).toBe(200);
    expect(response.body.mcpUrl).toBe(RESOURCE);
    expect(response.body.scopes).toEqual(SCOPES.map((scope) => ({ scope, label: SCOPE_LABELS[scope] })));
  });

  it('gives no address in production when the MCP address is the loopback default of a stack without MCP', async () => {
    const alice = await createTestUser('connection-prod');
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const response = await request(app).get('/api/oauth/connection').set(authHeader(alice));
      expect(response.status).toBe(200);
      expect(response.body.mcpUrl).toBeNull();
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('gives the public address in production', async () => {
    const alice = await createTestUser('connection-public');
    const previous = { env: process.env.NODE_ENV, resource: oauthConfig.resource };
    process.env.NODE_ENV = 'production';
    oauthConfig.resource = 'https://visualex.example:10000/mcp';
    try {
      const response = await request(app).get('/api/oauth/connection').set(authHeader(alice));
      expect(response.body.mcpUrl).toBe('https://visualex.example:10000/mcp');
    } finally {
      process.env.NODE_ENV = previous.env;
      oauthConfig.resource = previous.resource;
    }
  });

  it('needs a session', async () => {
    expect((await request(app).get('/api/oauth/connection')).status).toBe(401);
  });

  it('is never reachable by an exchanged token, whatever its scope', async () => {
    expect(findDelegatedRoute('GET', '/oauth/connection')).toBeUndefined();
    const alice = await createTestUser('connection-delegated');
    for (const scope of ['dossier:read', 'lingo:cards:read']) {
      const response = await request(app).get('/api/oauth/connection').set(await delegated(alice, scope));
      expect([scope, response.status]).toEqual([scope, 403]);
    }
  });
});
