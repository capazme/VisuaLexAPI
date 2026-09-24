import { describe, expect, it } from 'vitest';
import { request, app } from './helpers';

/**
 * A handful of routes added alongside the saved-norm watcher and article
 * discussions were reviewed for auth gating separately from their feature
 * tests. All of them mount `authenticate` at the router level (see
 * `routes/notifications.ts`, `routes/dossiers.ts`, `routes/articleDiscussions.ts`,
 * `routes/auth.ts`) — this just proves the gate actually holds, with no
 * token on the wire.
 */
describe('routes require authentication', () => {
  it.each([
    ['get', '/api/notifications/normas'],
    ['post', '/api/notifications/normas/check'],
    ['get', '/api/article-discussions?normaKey=x&articleId=1'],
    ['post', '/api/article-discussions'],
    ['get', '/api/dossiers/does-not-exist/snapshots'],
    ['get', '/api/auth/export'],
    ['delete', '/api/auth/account'],
  ] as const)('%s %s answers 401 without a token', async (method, path) => {
    const response = await (request(app) as any)[method](path);
    expect(response.status).toBe(401);
  });
});
