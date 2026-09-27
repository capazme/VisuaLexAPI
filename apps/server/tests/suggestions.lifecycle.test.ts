import { describe, it, expect, beforeEach } from 'vitest';
import { request, app, createTestUser, authHeader, createSharedEnv, prisma, type TestUser } from './helpers';

describe('suggestion lifecycle', () => {
  let alice: TestUser; // owner
  let bob: TestUser;   // suggester
  let envId: string;

  beforeEach(async () => {
    alice = await createTestUser('alice');
    bob = await createTestUser('bob');
    const env = await createSharedEnv(alice, { title: 'Alice env' });
    envId = env.id;
  });

  it('creates a suggestion with N items', async () => {
    const res = await request(app)
      .post(`/api/shared-environments/${envId}/suggestions`)
      .set(authHeader(bob))
      .send({
        message: 'hello',
        items: [
          { itemType: 'annotation', payload: { articleId: 'art-2043', text: 'nota 1' } },
          { itemType: 'quickNorm', payload: { label: 'Art 2043', searchParams: { act_type: 'codice civile', article: '2043' } } },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.counts).toEqual({ pending: 2, taken: 0, declined: 0 });
    expect(res.body.aggregateStatus).toBe('open');
  });

  it('owner takes one item, declines another — partial review stays open', async () => {
    const create = await request(app)
      .post(`/api/shared-environments/${envId}/suggestions`)
      .set(authHeader(bob))
      .send({
        items: [
          { itemType: 'annotation', payload: { articleId: 'art-2043', text: 'nota A' } },
          { itemType: 'annotation', payload: { articleId: 'art-2050', text: 'nota B' } },
          { itemType: 'quickNorm', payload: { label: 'Q', searchParams: { act_type: 'cc' } } },
        ],
      });
    const sugId = create.body.id;
    const [a, b] = create.body.items;

    const take = await request(app)
      .post(`/api/shared-environments-suggestions/${sugId}/items/${a.id}/take`)
      .set(authHeader(alice));
    expect(take.status).toBe(200);

    const decline = await request(app)
      .post(`/api/shared-environments-suggestions/${sugId}/items/${b.id}/decline`)
      .set(authHeader(alice))
      .send({ reviewNote: 'già presente' });
    expect(decline.status).toBe(200);

    const received = await request(app)
      .get('/api/shared-environments-suggestions/received')
      .set(authHeader(alice));
    const s = received.body.find((x: any) => x.id === sugId);
    expect(s.counts).toEqual({ pending: 1, taken: 1, declined: 1 });
    expect(s.aggregateStatus).toBe('open');
  });

  it('suggester revokes a pending item', async () => {
    const create = await request(app)
      .post(`/api/shared-environments/${envId}/suggestions`)
      .set(authHeader(bob))
      .send({ items: [{ itemType: 'annotation', payload: { articleId: 'x', text: 't' } }] });
    const itemId = create.body.items[0].id;

    const del = await request(app)
      .delete(`/api/shared-environments-suggestions/${create.body.id}/items/${itemId}`)
      .set(authHeader(bob));
    expect(del.status).toBe(204);

    const sent = await request(app)
      .get('/api/shared-environments-suggestions/sent')
      .set(authHeader(bob));
    const s = sent.body.find((x: any) => x.id === create.body.id);
    expect(s.items).toHaveLength(0);
    expect(s.aggregateStatus).toBe('revoked');
  });

  it('suggester cannot revoke an already-taken item', async () => {
    const create = await request(app)
      .post(`/api/shared-environments/${envId}/suggestions`)
      .set(authHeader(bob))
      .send({ items: [{ itemType: 'annotation', payload: { articleId: 'x', text: 't' } }] });
    const itemId = create.body.items[0].id;
    await request(app)
      .post(`/api/shared-environments-suggestions/${create.body.id}/items/${itemId}/take`)
      .set(authHeader(alice));

    const del = await request(app)
      .delete(`/api/shared-environments-suggestions/${create.body.id}/items/${itemId}`)
      .set(authHeader(bob));
    expect(del.status).toBe(403);
  });

  it('appending items to a closed thread returns 409', async () => {
    const create = await request(app)
      .post(`/api/shared-environments/${envId}/suggestions`)
      .set(authHeader(bob))
      .send({ items: [{ itemType: 'annotation', payload: { articleId: 'x', text: 't' } }] });
    await request(app)
      .post(`/api/shared-environments-suggestions/${create.body.id}/items/${create.body.items[0].id}/take`)
      .set(authHeader(alice));

    const add = await request(app)
      .post(`/api/shared-environments-suggestions/${create.body.id}/items`)
      .set(authHeader(bob))
      .send({ items: [{ itemType: 'quickNorm', payload: { label: 'L', searchParams: {} } }] });
    expect(add.status).toBe(409);
  });

  it('pending-count reflects items, not suggestions', async () => {
    await request(app)
      .post(`/api/shared-environments/${envId}/suggestions`)
      .set(authHeader(bob))
      .send({
        items: [
          { itemType: 'annotation', payload: { articleId: 'x', text: 'a' } },
          { itemType: 'annotation', payload: { articleId: 'y', text: 'b' } },
          { itemType: 'annotation', payload: { articleId: 'z', text: 'c' } },
        ],
      });
    const count = await request(app)
      .get('/api/shared-environments-suggestions/pending-count')
      .set(authHeader(alice));
    expect(count.body.count).toBe(3);
  });

  describe('authz', () => {
    let carol: TestUser;
    let sugId: string;
    let itemId: string;

    beforeEach(async () => {
      carol = await createTestUser('carol');
      const create = await request(app)
        .post(`/api/shared-environments/${envId}/suggestions`)
        .set(authHeader(bob))
        .send({ items: [{ itemType: 'annotation', payload: { articleId: 'x', text: 't' } }] });
      sugId = create.body.id;
      itemId = create.body.items[0].id;
    });

    it('suggester cannot take their own item', async () => {
      const res = await request(app)
        .post(`/api/shared-environments-suggestions/${sugId}/items/${itemId}/take`)
        .set(authHeader(bob));
      expect(res.status).toBe(403);
    });

    it("a third user cannot decline someone else's item", async () => {
      const res = await request(app)
        .post(`/api/shared-environments-suggestions/${sugId}/items/${itemId}/decline`)
        .set(authHeader(carol))
        .send({ reviewNote: 'mind your business' });
      expect(res.status).toBe(403);
    });

    it("owner cannot revoke suggester's items", async () => {
      const res = await request(app)
        .delete(`/api/shared-environments-suggestions/${sugId}/items/${itemId}`)
        .set(authHeader(alice));
      expect(res.status).toBe(403);
    });

    it('suggester cannot send a second open suggestion to same env', async () => {
      const res = await request(app)
        .post(`/api/shared-environments/${envId}/suggestions`)
        .set(authHeader(bob))
        .send({ items: [{ itemType: 'annotation', payload: { articleId: 'x', text: 't2' } }] });
      expect(res.status).toBe(400);
    });
  });
});
