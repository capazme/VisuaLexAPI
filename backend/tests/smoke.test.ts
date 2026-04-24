import { describe, it, expect } from 'vitest';
import { request, app, createTestUser, authHeader } from './helpers';

describe('test infra smoke', () => {
  it('boots the app and authenticates a created user', async () => {
    const alice = await createTestUser('alice');
    const res = await request(app).get('/api/auth/me').set(authHeader(alice));
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('alice');
  });
});
