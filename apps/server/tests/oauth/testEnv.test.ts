import { describe, expect, it } from 'vitest';
import { MCP_CLIENT_SECRET } from './oauthHelpers';

// The helpers authenticate as the MCP server with a fixed test secret. A checkout with
// `apps/server/.env` (loaded by @prisma/client on import, before the setup's assignments)
// once made the server expect the development secret instead: the whole OAuth suite
// answered `invalid_client` there, and passed in a clean worktree.
describe('the test environment', () => {
  it('expects the MCP secret the helpers send, whatever .env the checkout holds', () => {
    expect(process.env.OAUTH_MCP_CLIENT_SECRET).toBe(MCP_CLIENT_SECRET);
  });

  it('keeps the test delegation secret and the lifted OAuth limits', () => {
    expect(process.env.OAUTH_DELEGATION_SECRET).toBe('test-delegation-secret');
    expect(process.env.OAUTH_REQUESTS_PER_15_MINUTES).toBe('100000');
    expect(process.env.OAUTH_REGISTRATIONS_PER_HOUR).toBe('100000');
  });
});
