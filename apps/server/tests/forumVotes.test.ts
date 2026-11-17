import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { request, app, createTestUser, authHeader, type TestUser } from './helpers';

// The Forum's votes up and down and the personal score (spec 2026-11-14-forum-community-server-design §A,
// D-248): one vote per person per glossa or reply, +1 or -1, changed or withdrawn; never on one's own; an
// item's score kept by the database's trigger, cascades included; a person's score the sum over their
// visible contributions.

const ARTICLE = { normaKey: 'codice-civile--1453', articleId: '1453' };

describe('votes up and down', () => {
  let alice: TestUser; // writes the glossa
  let bob: TestUser; // answers, votes
  let carla: TestUser; // votes, comments
  let dario: TestUser; // votes
  beforeEach(async () => {
    alice = await createTestUser('votes-alice');
    bob = await createTestUser('votes-bob');
    carla = await createTestUser('votes-carla');
    dario = await createTestUser('votes-dario');
  });

  const as = (user: TestUser) => authHeader(user);
  async function glossa(author: TestUser, title = 'Inadempimento di scarsa importanza') {
    const res = await request(app).post('/api/article-discussions').set(as(author)).send({ ...ARTICLE, title, body: 'Quando la risoluzione è esclusa?' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  }
  async function answer(author: TestUser, threadId: string, body: string, parentId?: string) {
    const res = await request(app).post(`/api/article-discussions/${threadId}/comments`).set(as(author)).send({ body, parentId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  }
  const voteThread = (user: TestUser, threadId: string, value: unknown) =>
    request(app).put(`/api/article-discussions/${threadId}/vote`).set(as(user)).send({ value });
  const voteComment = (user: TestUser, commentId: string, value: unknown) =>
    request(app).put(`/api/article-discussion-comments/${commentId}/vote`).set(as(user)).send({ value });
  const scoreOf = async (threadId: string) => (await prisma.articleThread.findUniqueOrThrow({ where: { id: threadId } })).score;
  const commentScore = async (commentId: string) => (await prisma.articleComment.findUniqueOrThrow({ where: { id: commentId } })).score;

  describe('the score the database keeps', () => {
    it('follows every vote inserted, changed and deleted', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(bob, threadId, 'Risposta');
      await prisma.articleThreadVote.create({ data: { threadId, userId: bob.id, value: 1 } });
      await prisma.articleThreadVote.create({ data: { threadId, userId: carla.id, value: -1 } });
      await prisma.articleThreadVote.create({ data: { threadId, userId: dario.id } });
      expect(await scoreOf(threadId)).toBe(1);
      await prisma.articleThreadVote.update({ where: { threadId_userId: { threadId, userId: carla.id } }, data: { value: 1 } });
      expect(await scoreOf(threadId)).toBe(3);
      await prisma.articleThreadVote.delete({ where: { threadId_userId: { threadId, userId: bob.id } } });
      expect(await scoreOf(threadId)).toBe(2);

      await prisma.articleCommentVote.create({ data: { commentId: replyId, userId: carla.id, value: -1 } });
      expect(await commentScore(replyId)).toBe(-1);
    });

    it('refuses a vote that is neither 1 nor -1', async () => {
      const threadId = await glossa(alice);
      await expect(prisma.articleThreadVote.create({ data: { threadId, userId: bob.id, value: 2 } })).rejects.toThrow();
    });

    it('lowers the scores a deleted account gave, and deletes an item with its votes', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(bob, threadId, 'Risposta');
      expect((await voteThread(carla, threadId, 1)).status).toBe(200);
      expect((await voteComment(carla, replyId, -1)).status).toBe(200);
      expect((await voteThread(dario, threadId, 1)).status).toBe(200);
      const deleted = await request(app).delete('/api/auth/account').set(as(carla)).send({ password: 'test-password', confirmation: 'ELIMINA ACCOUNT' });
      expect(deleted.status).toBe(204);
      expect(await scoreOf(threadId)).toBe(1);
      expect(await commentScore(replyId)).toBe(0);

      // The author deletes the glossa: it goes with its replies and every vote on them.
      const own = await glossa(bob, 'Glossa di Bob');
      const ownReply = await answer(bob, own, 'Bob risponde a sé stesso');
      expect((await voteThread(dario, own, -1)).status).toBe(200);
      expect((await voteComment(dario, ownReply, 1)).status).toBe(200);
      expect((await request(app).delete(`/api/article-discussions/${own}`).set(as(bob))).body).toEqual({ outcome: 'deleted' });
      expect(await prisma.articleThreadVote.count({ where: { threadId: own } })).toBe(0);
      expect(await prisma.articleCommentVote.count({ where: { commentId: ownReply } })).toBe(0);

      // A reply deleted for good by its author goes with its votes.
      const lone = await answer(dario, threadId, 'Risposta da cancellare');
      expect((await voteComment(alice, lone, 1)).status).toBe(200);
      expect((await request(app).delete(`/api/article-discussion-comments/${lone}`).set(as(dario))).body).toEqual({ outcome: 'deleted' });
      expect(await prisma.articleCommentVote.count({ where: { commentId: lone } })).toBe(0);
    });

    it('deletes an account that wrote, voted, locked and released, every row of the Community written', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(bob, threadId, 'Risposta di Bob');
      const ownReply = await answer(alice, threadId, 'Alice risponde', replyId);
      const other = await glossa(bob, 'Glossa di Bob');
      await prisma.user.update({ where: { id: alice.id }, data: { isAdmin: true } });
      await prisma.articleThread.update({ where: { id: other }, data: { lockedAt: new Date(), lockedById: alice.id } });
      expect((await voteComment(alice, replyId, 1)).status).toBe(200);
      expect((await voteThread(alice, other, -1)).status).toBe(200);
      const deleted = await request(app).delete('/api/auth/account').set(as(alice)).send({ password: 'test-password', confirmation: 'ELIMINA ACCOUNT' });
      expect(deleted.status).toBe(204);
      expect(await commentScore(replyId)).toBe(0);
      expect(await scoreOf(other)).toBe(0);
      expect(await prisma.articleThread.findUniqueOrThrow({ where: { id: threadId } })).toMatchObject({ userId: null });
      expect(await prisma.articleComment.findUniqueOrThrow({ where: { id: ownReply } })).toMatchObject({ userId: null });
      expect(await prisma.articleThread.findUniqueOrThrow({ where: { id: other } })).toMatchObject({ lockedById: null });
    });
  });

  describe('the vote routes', () => {
    it('takes up, down, a change and a withdrawal, one vote per person', async () => {
      const threadId = await glossa(alice);
      expect((await voteThread(bob, threadId, 1)).body).toEqual({ value: 1, score: 1, upvotes: 1, downvotes: 0 });
      expect((await voteThread(carla, threadId, -1)).body).toEqual({ value: -1, score: 0, upvotes: 1, downvotes: 1 });
      expect((await voteThread(bob, threadId, -1)).body).toEqual({ value: -1, score: -2, upvotes: 0, downvotes: 2 });
      expect((await voteThread(bob, threadId, -1)).body).toEqual({ value: -1, score: -2, upvotes: 0, downvotes: 2 });
      expect((await voteThread(bob, threadId, 0)).body).toEqual({ value: 0, score: -1, upvotes: 0, downvotes: 1 });
      expect(await prisma.articleThreadVote.count({ where: { threadId } })).toBe(1);
    });

    it('votes a reply up and down', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(bob, threadId, 'Risposta');
      expect((await voteComment(alice, replyId, 1)).body).toEqual({ value: 1, score: 1, upvotes: 1, downvotes: 0 });
      expect((await voteComment(carla, replyId, -1)).body).toEqual({ value: -1, score: 0, upvotes: 1, downvotes: 1 });
    });

    it('refuses a value other than 1, -1 or 0, in Italian', async () => {
      const threadId = await glossa(alice);
      for (const value of [2, '1', null, undefined]) {
        const res = await voteThread(bob, threadId, value);
        expect(res.status).toBe(400);
        expect(res.body.detail).toBe('Il voto deve essere 1, -1 o 0');
      }
    });

    it('never takes a vote on one’s own contribution, on either route', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(bob, threadId, 'Risposta');
      for (const res of [
        await voteThread(alice, threadId, 1),
        await voteComment(bob, replyId, -1),
        await request(app).post(`/api/article-discussions/${threadId}/vote`).set(as(alice)),
        await request(app).post(`/api/article-discussion-comments/${replyId}/vote`).set(as(bob)),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.detail).toBe('Non puoi votare un tuo contributo');
      }
      expect(await prisma.articleThreadVote.count()).toBe(0);
      expect(await prisma.articleCommentVote.count()).toBe(0);
    });

    it('lets a comment’s old vote be withdrawn, and takes no other', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(bob, threadId, 'Risposta');
      const commentId = await answer(carla, threadId, 'Commento', replyId);
      for (const value of [1, -1]) {
        const res = await voteComment(alice, commentId, value);
        expect(res.status).toBe(400);
        expect(res.body.detail).toBe('Si vota una risposta, non un commento');
      }
      // A vote cast before the two-level rule.
      await prisma.articleCommentVote.create({ data: { commentId, userId: alice.id } });
      expect((await voteComment(alice, commentId, -1)).status).toBe(400);
      expect((await voteComment(alice, commentId, 0)).body).toEqual({ value: 0, score: 0, upvotes: 0, downvotes: 0 });
    });

    it('answers 404 on what is hidden, emptied or under a hidden glossa', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(bob, threadId, 'Risposta');
      const otherReply = await answer(carla, threadId, 'Altra risposta');
      await answer(dario, threadId, 'Commento', otherReply);
      // Carla empties her reply: Dario's comment hangs on it.
      expect((await request(app).delete(`/api/article-discussion-comments/${otherReply}`).set(as(carla))).body).toEqual({ outcome: 'emptied' });
      expect((await voteComment(alice, otherReply, 1)).status).toBe(404);
      await prisma.articleThread.update({ where: { id: threadId }, data: { isHidden: true } });
      expect((await voteThread(bob, threadId, 1)).status).toBe(404);
      expect((await voteComment(carla, replyId, 1)).status).toBe(404);
      expect((await voteThread(bob, '00000000-0000-4000-8000-000000000000', 1)).status).toBe(404);
    });

    it('takes a vote on a locked glossa', async () => {
      const threadId = await glossa(alice);
      await prisma.articleThread.update({ where: { id: threadId }, data: { lockedAt: new Date() } });
      expect((await voteThread(bob, threadId, 1)).status).toBe(200);
    });

    it('keeps the old toggle for the reader’s panel: none → up, up → none, down → up', async () => {
      const threadId = await glossa(alice);
      const toggle = (user: TestUser) => request(app).post(`/api/article-discussions/${threadId}/vote`).set(as(user));
      expect((await toggle(bob)).body).toEqual({ voted: true, voteCount: 1 });
      expect((await toggle(bob)).body).toEqual({ voted: false, voteCount: 0 });
      await voteThread(bob, threadId, -1);
      expect((await toggle(bob)).body).toEqual({ voted: true, voteCount: 1 });
      expect(await scoreOf(threadId)).toBe(1);
    });

    describe('the daily count', () => {
      const saved = process.env.FORUM_DAILY_VOTES;
      afterEach(() => {
        if (saved === undefined) delete process.env.FORUM_DAILY_VOTES;
        else process.env.FORUM_DAILY_VOTES = saved;
      });

      it('gives back the point of a refused vote', async () => {
        process.env.FORUM_DAILY_VOTES = '1';
        const threadId = await glossa(alice);
        const own = await glossa(bob, 'Glossa di Bob');
        expect((await voteThread(bob, own, 1)).status).toBe(403);
        expect((await voteThread(bob, threadId, 7)).status).toBe(400);
        expect((await voteThread(bob, threadId, 1)).status).toBe(200);
        expect((await voteThread(bob, threadId, -1)).status).toBe(429);
      });

      it('refuses a vote past the count with an Italian 429', async () => {
        process.env.FORUM_DAILY_VOTES = '2';
        const first = await glossa(alice, 'Prima glossa');
        const second = await glossa(alice, 'Seconda glossa');
        const third = await glossa(alice, 'Terza glossa');
        expect((await voteThread(bob, first, 1)).status).toBe(200);
        expect((await voteThread(bob, second, 1)).status).toBe(200);
        const over = await voteThread(bob, third, 1);
        expect(over.status).toBe(429);
        expect(over.body.detail).toBe('Hai votato 2 volte nelle ultime 24 ore: riprova più tardi.');
        expect((await voteThread(carla, third, 1)).status).toBe(200);
      });
    });
  });

  describe('the answers', () => {
    it('carries the votes and the reader’s own on the feed, a glossa’s page and the reader’s lists', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(bob, threadId, 'Risposta');
      await voteThread(bob, threadId, 1);
      await voteThread(carla, threadId, -1);
      await voteThread(dario, threadId, 1);
      await voteComment(carla, replyId, -1);

      const feed = await request(app).get('/api/article-discussions/feed').set(as(carla));
      expect(feed.body.data[0]).toMatchObject({ score: 1, upvotes: 2, downvotes: 1, userVote: -1, voteCount: 2, userVoted: false });

      const page = await request(app).get(`/api/article-discussions/${threadId}`).set(as(bob));
      expect(page.body).toMatchObject({ score: 1, upvotes: 2, downvotes: 1, userVote: 1, voteCount: 2, userVoted: true });
      expect(page.body.replies[0]).toMatchObject({ score: -1, upvotes: 0, downvotes: 1, userVote: 0 });

      const list = await request(app).get('/api/article-discussions').set(as(dario)).query(ARTICLE);
      expect(list.body.data[0]).toMatchObject({ score: 1, upvotes: 2, downvotes: 1, userVote: 1, voteCount: 2, userVoted: true });
      expect(list.body.data[0].comments[0]).toMatchObject({ score: -1, upvotes: 0, downvotes: 1, userVote: 0 });
    });

    it('orders «popular» and a glossa’s replies by score, the accepted reply first', async () => {
      const low = await glossa(alice, 'Glossa poco votata');
      const high = await glossa(alice, 'Glossa molto votata');
      const liked = await glossa(alice, 'Glossa con molti voti, in parte contrari');
      await voteThread(bob, high, 1);
      await voteThread(carla, high, 1);
      await voteThread(bob, liked, 1);
      await voteThread(carla, liked, 1);
      await voteThread(dario, liked, -1);
      await voteThread(bob, low, -1);
      const feed = await request(app).get('/api/article-discussions/feed').set(as(dario)).query({ sort: 'popular' });
      expect(feed.body.data.map((t: { id: string }) => t.id)).toEqual([high, liked, low]);
      const list = await request(app).get('/api/article-discussions').set(as(dario)).query({ ...ARTICLE, sort: 'popular' });
      expect(list.body.data.map((t: { id: string }) => t.id)).toEqual([high, liked, low]);

      const first = await answer(bob, high, 'Prima risposta');
      const second = await answer(carla, high, 'Seconda risposta');
      const third = await answer(dario, high, 'Terza risposta');
      await voteComment(alice, second, 1);
      await voteComment(dario, second, 1);
      await voteComment(alice, first, -1);
      await request(app).post(`/api/article-discussions/${high}/accept`).set(as(alice)).send({ commentId: third });
      const page = await request(app).get(`/api/article-discussions/${high}`).set(as(alice));
      expect(page.body.replies.map((r: { id: string }) => r.id)).toEqual([third, second, first]);
    });

    it('gives each author their personal score: visible contributions only, nobody’s for the anonymous', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(bob, threadId, 'Risposta di Bob');
      const commentId = await answer(alice, threadId, 'Commento di Alice', replyId);
      await voteThread(bob, threadId, 1);
      await voteThread(carla, threadId, 1);
      await voteComment(carla, replyId, 1);
      // A comment's vote from before the two-level rule still counts.
      await prisma.articleCommentVote.create({ data: { commentId, userId: dario.id } });
      // Alice's other glossa, hidden by moderation: its votes stop counting.
      const hidden = await glossa(alice, 'Glossa nascosta');
      await voteThread(dario, hidden, 1);
      await prisma.articleThread.update({ where: { id: hidden }, data: { isHidden: true } });

      const page = await request(app).get(`/api/article-discussions/${threadId}`).set(as(dario));
      expect(page.body.user).toEqual({ id: alice.id, username: alice.username, score: 3 });
      expect(page.body.replies[0].user).toEqual({ id: bob.id, username: bob.username, score: 1 });
      const feed = await request(app).get('/api/article-discussions/feed').set(as(dario));
      expect(feed.body.data[0].user).toEqual({ id: alice.id, username: alice.username, score: 3 });

      // Under a hidden glossa, a reply counts for nobody.
      await prisma.articleThread.update({ where: { id: threadId }, data: { isHidden: true } });
      await prisma.articleThread.update({ where: { id: hidden }, data: { isHidden: false } });
      const again = await request(app).get(`/api/article-discussions/${hidden}`).set(as(dario));
      expect(again.body.user).toEqual({ id: alice.id, username: alice.username, score: 1 });

      // Bob empties his voted reply (Alice's comment hangs on it): its votes stop counting for him.
      await prisma.articleThread.update({ where: { id: threadId }, data: { isHidden: false } });
      expect((await request(app).delete(`/api/article-discussion-comments/${replyId}`).set(as(bob))).body).toEqual({ outcome: 'emptied' });
      const bobReply = await answer(bob, hidden, 'Bob risponde ancora');
      const emptied = await request(app).get(`/api/article-discussions/${hidden}`).set(as(dario));
      expect(emptied.body.replies.find((r: { id: string }) => r.id === bobReply).user).toEqual({ id: bob.id, username: bob.username, score: 0 });

      // Bob's account goes: his reply stays, anonymous, with no score.
      await request(app).delete('/api/auth/account').set(as(bob)).send({ password: 'test-password', confirmation: 'ELIMINA ACCOUNT' });
      const after = await request(app).get(`/api/article-discussions/${hidden}`).set(as(dario));
      expect(after.body.replies.find((r: { id: string }) => r.id === bobReply).user).toEqual({ id: null, username: 'utente cancellato', score: null });
    });

    it('puts each vote’s value in the export', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(carla, threadId, 'Risposta');
      await voteThread(bob, threadId, -1);
      await voteComment(bob, replyId, 1);
      const exported = await request(app).get('/api/auth/export').set(as(bob));
      expect(exported.body.data.threadVotes).toEqual([{ threadId, value: -1, createdAt: expect.any(String) }]);
      expect(exported.body.data.commentVotes).toEqual([{ commentId: replyId, value: 1, createdAt: expect.any(String) }]);
    });
  });
});
