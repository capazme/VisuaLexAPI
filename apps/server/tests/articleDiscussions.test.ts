import { describe, expect, it, beforeEach } from 'vitest';
import { prisma } from '../src/lib/prisma';
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
    expect(created.body.passage).toBeNull();
    expect(created.body.articleUrn).toBeNull();
    expect(created.body.textHash).toBeNull();

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
    expect(listed.body.data[0].passage).toBeNull();
    expect(listed.body.data[0].articleUrn).toBeNull();
    expect(listed.body.data[0].textHash).toBeNull();
  });

  it('does not expose another article anchor', async () => {
    await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
      normaKey: 'norma-a', articleId: '1', title: 'Discussione', body: 'Test',
    });
    const listed = await request(app).get('/api/article-discussions').set(authHeader(bob)).query({ normaKey: 'norma-b', articleId: '1' });
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(0);
  });

  it('creates a passage thread without title (201) and returns empty title and matching passage/urn/hash', async () => {
    const passage = {
      quote: 'risarcimento del danno',
      start: 219,
      prefix: 'obbliga chi ha commesso il fatto',
      suffix: ' a risarcire il danno',
    };
    const articleUrn = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043';
    const textHash = 'a'.repeat(64);

    const created = await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
      normaKey: 'codice-civile--art-2043',
      articleId: '2043',
      body: 'Osservazione su questo passaggio specifico.',
      passage,
      articleUrn,
      textHash,
    });

    expect(created.status).toBe(201);
    expect(created.body.title).toBe('');
    expect(created.body.passage).toEqual(passage);
    expect(created.body.articleUrn).toBe(articleUrn);
    expect(created.body.textHash).toBe(textHash);
    expect(created.body.voteCount).toBe(0);
    expect(created.body.userVoted).toBe(false);
    expect(created.body.isOwner).toBe(true);
    expect(created.body.comments).toEqual([]);
  });

  it('rejects a whole-article thread without title (400, naming title)', async () => {
    const res = await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
      normaKey: 'codice-civile--art-2043',
      articleId: '2043',
      body: 'Test body',
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('title');
  });

  it('rejects a passage thread with a title of 2 characters (400)', async () => {
    const res = await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
      normaKey: 'codice-civile--art-2043',
      articleId: '2043',
      title: 'ab',
      body: 'Test body',
      passage: {
        quote: 'risarcimento',
        start: 10,
        prefix: '',
        suffix: '',
      },
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('title');
  });

  it('rejects invalid passages with 400 for each validation rule', async () => {
    const base = {
      normaKey: 'codice-civile--art-2043',
      articleId: '2043',
      body: 'Test body',
    };

    // start: -1
    const resNegativeStart = await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
      ...base,
      passage: { quote: 'test', start: -1, prefix: '', suffix: '' },
    });
    expect(resNegativeStart.status).toBe(400);

    // start: 1.5
    const resFloatStart = await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
      ...base,
      passage: { quote: 'test', start: 1.5, prefix: '', suffix: '' },
    });
    expect(resFloatStart.status).toBe(400);

    // quote of 2001 chars
    const resLongQuote = await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
      ...base,
      passage: { quote: 'x'.repeat(2001), start: 0, prefix: '', suffix: '' },
    });
    expect(resLongQuote.status).toBe(400);

    // quote made only of spaces
    const resWhitespaceQuote = await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
      ...base,
      passage: { quote: '   ', start: 0, prefix: '', suffix: '' },
    });
    expect(resWhitespaceQuote.status).toBe(400);

    // prefix of 33 chars
    const resLongPrefix = await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
      ...base,
      passage: { quote: 'test', start: 0, prefix: 'x'.repeat(33), suffix: '' },
    });
    expect(resLongPrefix.status).toBe(400);
  });

  it('rejects textHash when not 64 lowercase hex chars (400)', async () => {
    const base = {
      normaKey: 'codice-civile--art-2043',
      articleId: '2043',
      body: 'Test body',
      passage: { quote: 'test', start: 0, prefix: '', suffix: '' },
    };

    // Uppercase
    const resUpper = await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
      ...base,
      textHash: 'A'.repeat(64),
    });
    expect(resUpper.status).toBe(400);

    // 63 chars
    const resShort = await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
      ...base,
      textHash: 'a'.repeat(63),
    });
    expect(resShort.status).toBe(400);
  });

  it('returns passage, articleUrn, textHash in list response', async () => {
    const passage = { quote: 'danno ingiusto', start: 50, prefix: 'qualunque fatto ', suffix: ' obbliga' };
    const articleUrn = 'urn:nir:stato:legge:1942;262~art2043';
    const textHash = 'b'.repeat(64);

    await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
      normaKey: 'codice-civile--art-2043-listed',
      articleId: '2043',
      body: 'Passage thread body',
      passage,
      articleUrn,
      textHash,
    });

    const res = await request(app).get('/api/article-discussions').set(authHeader(bob)).query({
      normaKey: 'codice-civile--art-2043-listed',
      articleId: '2043',
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].passage).toEqual(passage);
    expect(res.body.data[0].articleUrn).toBe(articleUrn);
    expect(res.body.data[0].textHash).toBe(textHash);
  });

  it('GET /api/article-discussions/passages returns only passage threads with commentCount and excludes hidden threads', async () => {
    // Unauthenticated check
    const unauth = await request(app).get('/api/article-discussions/passages').query({
      normaKey: 'test-norma-passages',
      articleId: '10',
    });
    expect(unauth.status).toBe(401);

    // Thread 1: whole-article thread (no passage) - should NOT appear in passages list
    await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
      normaKey: 'test-norma-passages',
      articleId: '10',
      title: 'Discussione generale',
      body: 'General discussion body',
    });

    // Thread 2: passage thread by alice
    const passage1 = { quote: 'primo passaggio', start: 10, prefix: 'ante ', suffix: ' post' };
    const createdP1 = await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
      normaKey: 'test-norma-passages',
      articleId: '10',
      body: 'Alice passage thread',
      passage: passage1,
      articleUrn: 'urn:art10',
      textHash: 'c'.repeat(64),
    });
    expect(createdP1.status).toBe(201);
    const p1Id = createdP1.body.id as string;

    // Add 1 visible comment and 1 hidden comment to Thread 2
    const c1 = await request(app).post(`/api/article-discussions/${p1Id}/comments`).set(authHeader(bob)).send({ body: 'Visible reply' });
    expect(c1.status).toBe(201);
    const c2 = await request(app).post(`/api/article-discussions/${p1Id}/comments`).set(authHeader(bob)).send({ body: 'To be hidden' });
    expect(c2.status).toBe(201);
    await prisma.articleComment.update({ where: { id: c2.body.id }, data: { isHidden: true } });

    // Thread 3: passage thread by bob
    const passage2 = { quote: 'secondo passaggio', start: 50, prefix: '', suffix: '' };
    const createdP2 = await request(app).post('/api/article-discussions').set(authHeader(bob)).send({
      normaKey: 'test-norma-passages',
      articleId: '10',
      title: 'Bob title',
      body: 'Bob passage thread',
      passage: passage2,
    });
    expect(createdP2.status).toBe(201);

    // Thread 4: passage thread that is hidden - should NOT appear
    const createdP3 = await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
      normaKey: 'test-norma-passages',
      articleId: '10',
      body: 'Hidden passage thread',
      passage: { quote: 'hidden passage', start: 100, prefix: '', suffix: '' },
    });
    expect(createdP3.status).toBe(201);
    await prisma.articleThread.update({ where: { id: createdP3.body.id }, data: { isHidden: true } });

    // Thread on a different normaKey - should NOT appear
    await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
      normaKey: 'other-norma',
      articleId: '10',
      body: 'Other norma passage',
      passage: { quote: 'other', start: 0, prefix: '', suffix: '' },
    });

    const res = await request(app).get('/api/article-discussions/passages').set(authHeader(alice)).query({
      normaKey: 'test-norma-passages',
      articleId: '10',
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);

    expect(res.body.data[0]).toMatchObject({
      id: p1Id,
      title: '',
      passage: passage1,
      articleUrn: 'urn:art10',
      textHash: 'c'.repeat(64),
      commentCount: 1, // Only 1 visible comment!
      user: { id: alice.id, username: alice.username },
    });

    expect(res.body.data[1]).toMatchObject({
      id: createdP2.body.id,
      title: 'Bob title',
      passage: passage2,
      articleUrn: null,
      textHash: null,
      commentCount: 0,
      user: { id: bob.id, username: bob.username },
    });
  });
});
