import { describe, expect, it, beforeEach } from 'vitest';
import { request, app, createTestUser, authHeader, type TestUser } from './helpers';

describe('article discussions', () => {
  let alice: TestUser;
  let bob: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('discussion-alice');
    bob = await createTestUser('discussion-bob');
  });

  it('anchors a thread to an article and supports replies and votes', async () => {
    const created = await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
      normaKey: 'codice-civile--art-2043', articleId: '2043', articleLabel: '2043', version: 'vigente',
      title: 'Come si applica questa norma?', body: 'Vorrei confrontarmi su questo articolo.',
    });
    expect(created.status).toBe(201);

    const threadId = created.body.id as string;
    const reply = await request(app).post(`/api/article-discussions/${threadId}/comments`).set(authHeader(bob)).send({ body: 'Condivido la domanda.' });
    expect(reply.status).toBe(201);

    const vote = await request(app).post(`/api/article-discussions/${threadId}/vote`).set(authHeader(bob));
    expect(vote.status).toBe(200);
    expect(vote.body).toMatchObject({ voted: true, voteCount: 1 });

    const listed = await request(app).get('/api/article-discussions').set(authHeader(alice)).query({ normaKey: 'codice-civile--art-2043', articleId: '2043' });
    expect(listed.status).toBe(200);
    expect(listed.body.data[0].comments).toHaveLength(1);
    expect(listed.body.data[0].voteCount).toBe(1);
  });

  it('does not expose another article anchor', async () => {
    await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
      normaKey: 'norma-a', articleId: '1', title: 'Discussione', body: 'Test',
    });
    const listed = await request(app).get('/api/article-discussions').set(authHeader(bob)).query({ normaKey: 'norma-b', articleId: '1' });
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(0);
  });
});
