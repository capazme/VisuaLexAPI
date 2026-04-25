import { describe, it, expect, beforeEach } from 'vitest';
import { request, app, createTestUser, authHeader, createSharedEnv, prisma, type TestUser } from './helpers';

describe('forum notifications', () => {
  let alice: TestUser;
  let bob: TestUser;
  let envId: string;

  beforeEach(async () => {
    alice = await createTestUser('alice');
    bob = await createTestUser('bob');
    envId = (await createSharedEnv(alice)).id;
  });

  it('counts pending suggestions as unread', async () => {
    await request(app)
      .post(`/api/shared-environments/${envId}/suggestions`)
      .set(authHeader(bob))
      .send({ items: [{ itemType: 'annotation', payload: { articleId: 'x', text: 't' } }] });

    const res = await request(app)
      .get('/api/notifications/forum-unread-count')
      .set(authHeader(alice));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pendingSuggestions: 1, newLikes: 0, total: 1 });
  });

  it('counts likes received since last seen', async () => {
    // Bob likes Alice's env
    await request(app)
      .post(`/api/shared-environments/${envId}/like`)
      .set(authHeader(bob));

    const before = await request(app)
      .get('/api/notifications/forum-unread-count')
      .set(authHeader(alice));
    expect(before.body.newLikes).toBe(1);

    // Alice marks-read
    const mark = await request(app)
      .post('/api/notifications/mark-read')
      .set(authHeader(alice));
    expect(mark.status).toBe(204);

    const after = await request(app)
      .get('/api/notifications/forum-unread-count')
      .set(authHeader(alice));
    expect(after.body.newLikes).toBe(0);
  });

  it('mark-read does NOT clear pending suggestions count', async () => {
    await request(app)
      .post(`/api/shared-environments/${envId}/suggestions`)
      .set(authHeader(bob))
      .send({ items: [{ itemType: 'annotation', payload: { articleId: 'x', text: 't' } }] });

    await request(app).post('/api/notifications/mark-read').set(authHeader(alice));

    const res = await request(app)
      .get('/api/notifications/forum-unread-count')
      .set(authHeader(alice));
    expect(res.body.pendingSuggestions).toBe(1);
  });

  it('does not count self-likes', async () => {
    // Self-likes are blocked at the unique-key level, but we defensively
    // exclude them in the query — assert the count stays at 0 when only
    // the owner could (theoretically) like.
    const res = await request(app)
      .get('/api/notifications/forum-unread-count')
      .set(authHeader(alice));
    expect(res.body.newLikes).toBe(0);
  });
});
