import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { request, app, createTestUser, authHeader, type TestUser } from './helpers';
import { delegated } from './delegatedHelper';

// The Community's routes (spec 2026-10-20-forum-community-glosse-design, pull request 2): replies at two
// levels, edit and deletion by the author, the accepted reply, reports on replies, moderation with its
// log, notifications, the daily limits, the feed's new filters. Server only: the four rules the reader's
// panel cannot meet yet stay lenient, each pinned below («pending PR2c»).

const ARTICLE = { normaKey: 'codice-civile--1453', articleId: '1453' };

describe('the Community', () => {
  let alice: TestUser; // writes the glossa
  let bob: TestUser; // answers
  let carla: TestUser; // comments, reports
  let mod: TestUser; // a moderator, not an admin
  let admin: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('community-r-alice');
    bob = await createTestUser('community-r-bob');
    carla = await createTestUser('community-r-carla');
    mod = await createTestUser('community-r-mod');
    admin = await createTestUser('community-r-admin');
    await prisma.user.update({ where: { id: mod.id }, data: { forumModerator: true } });
    await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: true } });
  });

  const as = (user: TestUser) => authHeader(user);
  async function glossa(author: TestUser, extra: Record<string, unknown> = {}) {
    const res = await request(app).post('/api/article-discussions').set(as(author))
      .send({ ...ARTICLE, title: 'Inadempimento di scarsa importanza', body: 'Quando la risoluzione è esclusa?', ...extra });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  }
  async function answer(author: TestUser, threadId: string, body: string, parentId?: string) {
    const res = await request(app).post(`/api/article-discussions/${threadId}/comments`).set(as(author)).send({ body, parentId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  }
  const page = (user: TestUser, threadId: string) => request(app).get(`/api/article-discussions/${threadId}`).set(as(user));
  const feed = (user: TestUser, query: Record<string, unknown> = {}) =>
    request(app).get('/api/article-discussions/feed').set(as(user)).query(query);
  const ids = (res: { body: { data: { id: string }[] } }) => res.body.data.map((t) => t.id).sort();
  const notificationsOf = (user: TestUser) =>
    prisma.forumNotification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });

  describe('replies and comments', () => {
    it('takes a comment under a reply, not under a comment, and nests it on the glossa’s page', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(bob, threadId, 'La gravità si misura sull’economia del contratto.');
      const commentId = await answer(carla, threadId, 'Cass. n. 1234/2020 è in questo senso.', replyId);

      const deeper = await request(app).post(`/api/article-discussions/${threadId}/comments`).set(as(bob)).send({ body: 'E oltre?', parentId: commentId });
      expect(deeper.status).toBe(400);
      expect(deeper.body.detail).toBe('Si può commentare una risposta, non un commento');
      const long = await request(app).post(`/api/article-discussions/${threadId}/comments`).set(as(bob)).send({ body: 'x'.repeat(2001), parentId: replyId });
      expect(long.status).toBe(400);

      const res = await page(alice, threadId);
      expect(res.body.replies).toHaveLength(1);
      expect(res.body.replies[0]).toMatchObject({ id: replyId, comments: [{ id: commentId, parentId: replyId }] });
    });

    it('flattens a third level stored before the rule under its reply', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(bob, threadId, 'Risposta');
      const commentId = await answer(carla, threadId, 'Commento', replyId);
      const old = await prisma.articleComment.create({ data: { threadId, parentId: commentId, userId: bob.id, body: 'Terzo livello' } });
      const res = await page(alice, threadId);
      expect(res.body.replies[0].comments.map((c: { id: string; parentId: string }) => [c.id, c.parentId])).toEqual([[commentId, replyId], [old.id, replyId]]);
    });

    it('tells the glossa’s author of a reply and the reply’s author of a comment, never of one’s own', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(bob, threadId, 'Risposta di Bob');
      await answer(alice, threadId, 'Alice risponde a sé stessa');
      await answer(carla, threadId, 'Commento di Carla', replyId);
      await answer(bob, threadId, 'Bob commenta sé stesso', replyId);

      expect((await notificationsOf(alice)).map((n) => n.kind)).toEqual(['reply']);
      expect((await notificationsOf(bob)).map((n) => n.kind)).toEqual(['comment']);
      expect(await notificationsOf(carla)).toEqual([]);
    });

    it('closes a locked glossa to new replies, not to votes, acceptance or edits', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(bob, threadId, 'Risposta');
      expect((await request(app).patch(`/api/moderation/threads/${threadId}`).set(as(mod)).send({ locked: true, reason: 'Discussione esaurita' })).status).toBe(200);

      const refused = await request(app).post(`/api/article-discussions/${threadId}/comments`).set(as(carla)).send({ body: 'Tardi' });
      expect(refused.status).toBe(409);
      expect(refused.body.detail).toBe('La discussione è chiusa');
      expect((await request(app).post(`/api/article-discussion-comments/${replyId}/vote`).set(as(carla))).status).toBe(200);
      expect((await request(app).post(`/api/article-discussions/${threadId}/accept`).set(as(alice)).send({ commentId: replyId })).status).toBe(200);
      expect((await request(app).patch(`/api/article-discussion-comments/${replyId}`).set(as(bob)).send({ body: 'Risposta corretta' })).status).toBe(200);
      expect((await page(carla, threadId)).body.locked).toBe(true);
    });
  });

  describe('editing', () => {
    it('lets the author edit text and subject, marks only a text change, and refuses anyone else', async () => {
      const threadId = await glossa(alice);
      const subject = await request(app).patch(`/api/article-discussions/${threadId}`).set(as(alice)).send({ materia: 'DIRITTO_CIVILE' });
      expect(subject.status).toBe(200);
      expect(subject.body).toMatchObject({ materia: 'DIRITTO_CIVILE', editedAt: null });
      const text = await request(app).patch(`/api/article-discussions/${threadId}`).set(as(alice)).send({ body: 'Testo corretto.' });
      expect(text.body.editedAt).toEqual(expect.any(String));
      expect((await request(app).patch(`/api/article-discussions/${threadId}`).set(as(bob)).send({ body: 'Mio.' })).status).toBe(403);
      // A glossa without a passage keeps a title.
      expect((await request(app).patch(`/api/article-discussions/${threadId}`).set(as(alice)).send({ title: '' })).status).toBe(400);
      // Never the anchor: unknown fields change nothing.
      await request(app).patch(`/api/article-discussions/${threadId}`).set(as(alice)).send({ body: 'Ancora.', normaKey: 'altro' });
      expect((await prisma.articleThread.findUniqueOrThrow({ where: { id: threadId } })).normaKey).toBe(ARTICLE.normaKey);
    });

    it('does not move the last activity, and refuses a hidden glossa (404)', async () => {
      const threadId = await glossa(alice);
      const before = (await prisma.articleThread.findUniqueOrThrow({ where: { id: threadId } })).lastActivityAt;
      await request(app).patch(`/api/article-discussions/${threadId}`).set(as(alice)).send({ body: 'Corretto.' });
      expect((await prisma.articleThread.findUniqueOrThrow({ where: { id: threadId } })).lastActivityAt).toEqual(before);
      await prisma.articleThread.update({ where: { id: threadId }, data: { isHidden: true, hiddenReason: 'spam' } });
      expect((await request(app).patch(`/api/article-discussions/${threadId}`).set(as(alice)).send({ body: 'Ancora.' })).status).toBe(404);
    });

    it('edits a reply, and a comment within its length', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(bob, threadId, 'Risposta');
      const commentId = await answer(carla, threadId, 'Commento', replyId);
      expect((await request(app).patch(`/api/article-discussion-comments/${replyId}`).set(as(bob)).send({ body: 'Risposta rivista' })).body.editedAt).toEqual(expect.any(String));
      expect((await request(app).patch(`/api/article-discussion-comments/${commentId}`).set(as(carla)).send({ body: 'x'.repeat(2001) })).status).toBe(400);
      expect((await request(app).patch(`/api/article-discussion-comments/${commentId}`).set(as(bob)).send({ body: 'Non mio' })).status).toBe(403);
    });
  });

  describe('deleting', () => {
    it('deletes a glossa no one else answered, with the author’s own replies', async () => {
      const threadId = await glossa(alice);
      await answer(alice, threadId, 'Aggiungo io');
      const res = await request(app).delete(`/api/article-discussions/${threadId}`).set(as(alice));
      expect(res.body).toEqual({ outcome: 'deleted' });
      expect(await prisma.articleThread.count({ where: { id: threadId } })).toBe(0);
    });

    it('empties a glossa others answered, even with a hidden reply, and keeps their replies', async () => {
      const threadId = await glossa(alice);
      const hiddenId = await answer(bob, threadId, 'Risposta nascosta');
      await prisma.articleComment.update({ where: { id: hiddenId }, data: { isHidden: true, hiddenReason: 'offensivo' } });
      expect((await request(app).delete(`/api/article-discussions/${threadId}`).set(as(alice))).body).toEqual({ outcome: 'emptied' });
      const row = await prisma.articleThread.findUniqueOrThrow({ where: { id: threadId } });
      expect(row).toMatchObject({ title: '', body: '', userId: alice.id });
      expect(row.deletedAt).not.toBeNull();
      // Nothing visible hangs on it: out of the lists, a 404.
      expect(ids(await feed(carla))).toEqual([]);
      expect((await page(carla, threadId)).status).toBe(404);
      expect((await request(app).delete(`/api/article-discussions/${threadId}`).set(as(alice))).status).toBe(404);
    });

    it('shows an emptied glossa with its visible replies, without the author’s name', async () => {
      const threadId = await glossa(alice, { passage: { quote: 'scarsa importanza', start: 0, prefix: '', suffix: '' }, title: '' });
      await answer(bob, threadId, 'Risposta visibile');
      await request(app).delete(`/api/article-discussions/${threadId}`).set(as(alice));
      const res = await page(carla, threadId);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ deleted: true, title: '', body: '', user: { id: null, username: '' }, replyCount: 1 });
      expect(res.body.passage.quote).toBe('scarsa importanza');
      expect((await feed(carla)).body.data[0]).toMatchObject({ id: threadId, deleted: true, excerpt: '' });
      const listed = await request(app).get('/api/article-discussions').set(as(carla)).query(ARTICLE);
      expect(listed.body.data[0]).toMatchObject({ id: threadId, deleted: true, body: '' });
    });

    it('deletes a bare reply, empties one with a comment or accepted', async () => {
      const threadId = await glossa(alice);
      const bare = await answer(bob, threadId, 'Sola');
      const withComment = await answer(bob, threadId, 'Commentata');
      await answer(carla, threadId, 'Commento', withComment);
      const accepted = await answer(bob, threadId, 'Accettata');
      await request(app).post(`/api/article-discussions/${threadId}/accept`).set(as(alice)).send({ commentId: accepted });

      const del = (id: string) => request(app).delete(`/api/article-discussion-comments/${id}`).set(as(bob));
      expect((await del(bare)).body).toEqual({ outcome: 'deleted' });
      expect((await del(withComment)).body).toEqual({ outcome: 'emptied' });
      expect((await del(accepted)).body).toEqual({ outcome: 'emptied' });
      expect((await request(app).delete(`/api/article-discussion-comments/${accepted}`).set(as(carla))).status).toBe(404);

      const res = await page(alice, threadId);
      // The emptied accepted reply stops counting as accepted; the emptied commented one stays as a place.
      expect(res.body.acceptedCommentId).toBeNull();
      expect(res.body.replies.map((r: { id: string; deleted: boolean; body: string }) => [r.id, r.deleted, r.body])).toEqual([[withComment, true, '']]);
      expect(res.body.replyCount).toBe(0);
    });
  });

  describe('the accepted reply', () => {
    it('is the glossa author’s choice, of someone else’s visible reply, one at a time', async () => {
      const threadId = await glossa(alice);
      const first = await answer(bob, threadId, 'Prima');
      const second = await answer(carla, threadId, 'Seconda');
      const own = await answer(alice, threadId, 'Mia');
      const comment = await answer(bob, threadId, 'Commento', first);
      const accept = (user: TestUser, commentId: string | null) =>
        request(app).post(`/api/article-discussions/${threadId}/accept`).set(as(user)).send({ commentId });

      expect((await accept(bob, first)).status).toBe(403);
      expect((await accept(alice, own)).status).toBe(400);
      expect((await accept(alice, comment)).status).toBe(404);
      expect((await accept(alice, first)).body).toEqual({ acceptedCommentId: first });
      expect((await accept(alice, second)).body).toEqual({ acceptedCommentId: second });
      expect((await page(bob, threadId)).body.replies[0]).toMatchObject({ id: second, accepted: true });
      expect((await accept(alice, null)).body).toEqual({ acceptedCommentId: null });
      expect((await notificationsOf(bob)).filter((n) => n.kind === 'accepted')).toHaveLength(1);
      expect((await notificationsOf(carla)).filter((n) => n.kind === 'accepted')).toHaveLength(1);
    });

    it('stops counting a hidden accepted reply, and counts it again once shown', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(bob, threadId, 'Risposta');
      await request(app).post(`/api/article-discussions/${threadId}/accept`).set(as(alice)).send({ commentId: replyId });
      const hide = (hidden: boolean) => request(app).patch(`/api/moderation/comments/${replyId}`).set(as(mod))
        .send({ hidden, category: 'fuori_tema', reason: 'Non pertinente' });
      await hide(true);
      expect((await feed(carla)).body.data[0].acceptedCommentId).toBeNull();
      await hide(false);
      expect((await feed(carla)).body.data[0].acceptedCommentId).toBe(replyId);
    });

    it('cannot change on a glossa whose author is gone, and an anonymous reply can still be accepted', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(bob, threadId, 'Risposta');
      await prisma.articleComment.update({ where: { id: replyId }, data: { userId: null } });
      expect((await request(app).post(`/api/article-discussions/${threadId}/accept`).set(as(alice)).send({ commentId: replyId })).status).toBe(200);
      await prisma.articleThread.update({ where: { id: threadId }, data: { userId: null } });
      expect((await request(app).post(`/api/article-discussions/${threadId}/accept`).set(as(alice)).send({ commentId: null })).status).toBe(403);
    });
  });

  describe('votes', () => {
    // Pending PR2c: the reader's panel shows the button on one's own glossa, so the vote is still taken.
    it('still takes a vote on one’s own glossa or reply (lenient until PR2c)', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(bob, threadId, 'Risposta');
      expect((await request(app).post(`/api/article-discussions/${threadId}/vote`).set(as(alice))).body).toEqual({ voted: true, voteCount: 1 });
      expect((await request(app).post(`/api/article-discussion-comments/${replyId}/vote`).set(as(bob))).body).toEqual({ voted: true, voteCount: 1 });
    });

    it('takes no new vote on a comment, and none on hidden content', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(bob, threadId, 'Risposta');
      const commentId = await answer(carla, threadId, 'Commento', replyId);
      expect((await request(app).post(`/api/article-discussion-comments/${commentId}/vote`).set(as(alice))).status).toBe(400);
      await prisma.articleComment.update({ where: { id: replyId }, data: { isHidden: true } });
      expect((await request(app).post(`/api/article-discussion-comments/${replyId}/vote`).set(as(alice))).status).toBe(404);
    });
  });

  describe('reports and the moderators’ queue', () => {
    it('reports a reply with a copy of its text, never one’s own', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(bob, threadId, 'Testo riportato');
      expect((await request(app).post(`/api/article-discussion-comments/${replyId}/report`).set(as(bob)).send({ reason: 'spam' })).status).toBe(400);
      expect((await request(app).post(`/api/article-discussions/${threadId}/report`).set(as(alice)).send({ reason: 'spam' })).status).toBe(400);
      expect((await request(app).post(`/api/article-discussion-comments/${replyId}/report`).set(as(carla)).send({ reason: 'offensivo', details: 'Insulta' })).status).toBe(204);
      expect(await prisma.articleCommentReport.findFirstOrThrow({ where: { commentId: replyId } }))
        .toMatchObject({ threadId, reason: 'offensivo', details: 'Insulta', status: 'pending', reportedText: 'Testo riportato' });
    });

    it('is for moderators and admins only', async () => {
      expect((await request(app).get('/api/moderation/reports').set(as(carla))).status).toBe(403);
      expect((await request(app).get('/api/moderation/reports').set(as(mod))).status).toBe(200);
      expect((await request(app).get('/api/moderation/reports').set(as(admin))).status).toBe(200);
      const threadId = await glossa(alice);
      expect((await request(app).patch(`/api/moderation/threads/${threadId}`).set(as(alice)).send({ locked: true, reason: 'Mia' })).status).toBe(403);
    });

    it('groups an item’s reports, shows its text and its anchor whole, and closes them with one decision', async () => {
      const threadId = await glossa(alice, {
        normaKey: 'cassazione:civile:31310:2024', articleId: '', title: '',
        passage: { quote: 'parole ritirate', start: 0, prefix: '', suffix: '' },
      });
      await request(app).post(`/api/article-discussions/${threadId}/report`).set(as(bob)).send({ reason: 'dati_personali' });
      await request(app).post(`/api/article-discussions/${threadId}/report`).set(as(carla)).send({ reason: 'spam' });

      const queue = await request(app).get('/api/moderation/reports').set(as(mod));
      expect(queue.body.data).toHaveLength(1);
      expect(queue.body.data[0]).toMatchObject({
        kind: 'thread', itemId: threadId, count: 2, deleted: false,
        item: { body: 'Quando la risoluzione è esclusa?', author: alice.username, isHidden: false },
        anchor: { passage: 'parole ritirate', decisionLabel: 'Cass. civ., n. 31310/2024' },
      });
      expect(queue.body.data[0].reasons.sort()).toEqual(['dati_personali', 'spam']);
      expect(JSON.stringify(queue.body)).not.toContain(bob.username);

      const resolved = await request(app).post(`/api/moderation/reports/thread/${threadId}/resolve`).set(as(mod))
        .send({ action: 'hide', category: 'dati_personali', reason: 'Nomina un cliente: segnalato da due utenti' });
      expect(resolved.body).toEqual({ closed: 2, status: 'resolved' });
      expect(await prisma.articleThread.findUniqueOrThrow({ where: { id: threadId } })).toMatchObject({ isHidden: true, hiddenReason: 'dati_personali' });
      expect((await request(app).get('/api/moderation/reports').set(as(mod))).body.data).toEqual([]);
      expect((await request(app).post(`/api/moderation/reports/thread/${threadId}/resolve`).set(as(mod)).send({ action: 'dismiss', reason: 'Di nuovo' })).status).toBe(404);

      // The author reads it with the category; others get a 404; the author was told, not by whom.
      expect((await page(alice, threadId)).body.hidden).toEqual({ category: 'dati_personali' });
      expect((await page(bob, threadId)).status).toBe(404);
      const told = await request(app).get('/api/forum/notifications').set(as(alice));
      expect(told.body.data[0]).toMatchObject({ kind: 'hidden', category: 'dati_personali', threadId });
      expect(JSON.stringify(told.body)).not.toContain(mod.username);
      const log = await prisma.forumModerationLog.findMany({ where: { targetId: threadId } });
      expect(log.map((row) => [row.action, row.actorId])).toEqual([['hide', mod.id]]);
    });

    it('keeps the report of an item its author deleted for good, and lets a moderator only dismiss it', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(bob, threadId, 'Da cancellare');
      await request(app).post(`/api/article-discussion-comments/${replyId}/report`).set(as(carla)).send({ reason: 'offensivo' });
      expect((await request(app).delete(`/api/article-discussion-comments/${replyId}`).set(as(bob))).body).toEqual({ outcome: 'deleted' });

      const queue = await request(app).get('/api/moderation/reports').set(as(mod));
      expect(queue.body.data[0]).toMatchObject({ kind: 'comment', itemId: replyId, threadId, deleted: true, item: null });
      expect(queue.body.data[0].reports[0].reportedText).toBe('Da cancellare');
      const resolve = (action: string) => request(app).post(`/api/moderation/reports/comment/${replyId}/resolve`).set(as(mod))
        .send({ action, category: 'offensivo', reason: 'Contributo già cancellato' });
      expect((await resolve('hide')).status).toBe(409);
      expect((await resolve('dismiss')).body).toEqual({ closed: 1, status: 'dismissed' });
    });

    it('needs a category to hide and a reason for every act', async () => {
      const threadId = await glossa(alice);
      const url = `/api/moderation/threads/${threadId}`;
      expect((await request(app).patch(url).set(as(mod)).send({ hidden: true, reason: 'Senza categoria' })).body.detail).toBe('Per nascondere serve una categoria');
      expect((await request(app).patch(url).set(as(mod)).send({ hidden: true, category: 'spam' })).status).toBe(400);
      expect((await request(app).patch(url).set(as(mod)).send({ hidden: true, category: 'antipatia', reason: 'Motivo' })).status).toBe(400);
    });

    it('lets an admin empty an anonymous contribution on request, never one with an author', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(bob, threadId, 'Testo da togliere');
      const empty = (user: TestUser) => request(app).post(`/api/moderation/comment/${replyId}/empty`).set(as(user)).send({ reason: 'Richiesta dell’autore dopo la cancellazione dell’account' });
      expect((await empty(admin)).status).toBe(409);
      await prisma.articleComment.update({ where: { id: replyId }, data: { userId: null } });
      expect((await empty(mod)).status).toBe(403);
      expect((await empty(admin)).body).toEqual({ outcome: 'emptied' });
      expect(await prisma.articleComment.findUniqueOrThrow({ where: { id: replyId } })).toMatchObject({ body: '' });
      expect((await prisma.forumModerationLog.findFirstOrThrow({ where: { targetId: replyId } })).action).toBe('empty');
    });
  });

  describe('moderators', () => {
    it('are appointed and revoked by an admin with a reason, on the record, from the next request', async () => {
      const put = (body: Record<string, unknown>) => request(app).put(`/api/admin/users/${carla.id}`).set(as(admin)).send(body);
      expect((await put({ forumModerator: true })).status).toBe(400);
      const appointed = await put({ forumModerator: true, reason: 'Domanda formale e impegno scritto ricevuti' });
      expect(appointed.status).toBe(200);
      expect(appointed.body.forum_moderator).toBe(true);
      expect((await request(app).get('/api/moderation/reports').set(as(carla))).status).toBe(200);
      await put({ forumModerator: false, reason: 'Revocato su richiesta' });
      expect((await request(app).get('/api/moderation/reports').set(as(carla))).status).toBe(403);
      const log = await prisma.forumModerationLog.findMany({ where: { targetId: carla.id }, orderBy: { createdAt: 'asc' } });
      expect(log.map((row) => [row.action, row.targetKind])).toEqual([['appoint_moderator', 'user'], ['revoke_moderator', 'user']]);
    });
  });

  describe('the feed’s filters', () => {
    it('filters by subject, by «dove ho risposto», and by answered-not-settled', async () => {
      const civil = await glossa(alice, { materia: 'DIRITTO_CIVILE' });
      const settled = await glossa(alice);
      const open = await glossa(alice);
      const quiet = await glossa(bob);
      const settledReply = await answer(carla, settled, 'Risolve');
      await request(app).post(`/api/article-discussions/${settled}/accept`).set(as(alice)).send({ commentId: settledReply });
      await answer(carla, open, 'Non risolve');
      const emptied = await answer(bob, civil, 'Poi cancellata');
      await answer(carla, civil, 'Commento', emptied);
      await request(app).delete(`/api/article-discussion-comments/${emptied}`).set(as(bob));

      expect(ids(await feed(bob, { materia: 'DIRITTO_CIVILE' }))).toEqual([civil]);
      expect(ids(await feed(carla, { participated: 'true' }))).toEqual([civil, open, settled].sort());
      expect(ids(await feed(bob, { accepted: 'false' }))).toEqual([open]);
      expect(ids(await feed(bob, { accepted: 'true' }))).toEqual([settled]);
      // An emptied reply is no answer.
      expect(ids(await feed(bob, { sort: 'unanswered' }))).toEqual([civil, quiet].sort());
      expect((await feed(bob, { materia: 'DIRITTO_ROMANO' })).status).toBe(400);
    });

    it('orders by the last activity by default', async () => {
      const older = await glossa(alice);
      const newer = await glossa(bob);
      await answer(carla, older, 'Risposta recente');
      expect((await feed(alice)).body.data.map((t: { id: string }) => t.id)).toEqual([older, newer]);
    });
  });

  describe('notifications', () => {
    it('lists, marks read and counts in the Forum’s badge; moderators also see pending reports', async () => {
      const threadId = await glossa(alice);
      const replyId = await answer(bob, threadId, 'Risposta');
      await answer(carla, threadId, 'Altra risposta');
      await request(app).post(`/api/article-discussion-comments/${replyId}/report`).set(as(carla)).send({ reason: 'spam' });

      const listed = await request(app).get('/api/forum/notifications').set(as(alice));
      expect(listed.body.unread).toBe(2);
      expect(listed.body.data[0]).toMatchObject({ kind: 'reply', threadId, thread: { title: 'Inadempimento di scarsa importanza', articleLabel: null } });
      const count = await request(app).get('/api/notifications/forum-unread-count').set(as(alice));
      expect(count.body).toMatchObject({ community: 2, total: 2 });
      expect(count.body).not.toHaveProperty('pendingReports');
      expect((await request(app).get('/api/notifications/forum-unread-count').set(as(mod))).body).toMatchObject({ pendingReports: 1, total: 0 });

      const read = await request(app).post('/api/forum/notifications/read').set(as(alice)).send({ ids: [listed.body.data[0].id] });
      expect(read.body).toEqual({ read: 1 });
      // Someone else's notification is not theirs to mark.
      expect((await request(app).post('/api/forum/notifications/read').set(as(bob)).send({ ids: [listed.body.data[1].id] })).body).toEqual({ read: 0 });
      expect((await request(app).post('/api/forum/notifications/read').set(as(alice)).send({ all: true })).body).toEqual({ read: 1 });
      expect((await request(app).post('/api/forum/notifications/read').set(as(alice)).send({})).status).toBe(400);
    });
  });

  describe('the daily limits', () => {
    const saved = process.env.FORUM_DAILY_GLOSSE;
    afterEach(() => {
      if (saved === undefined) delete process.env.FORUM_DAILY_GLOSSE;
      else process.env.FORUM_DAILY_GLOSSE = saved;
    });

    it('refuses the write past the count with an Italian 429, and a refused write costs nothing', async () => {
      process.env.FORUM_DAILY_GLOSSE = '2';
      const threadId = await glossa(alice);
      // A write refused for its own reason gives its point back.
      expect((await request(app).post('/api/article-discussions').set(as(alice)).send({ ...ARTICLE, normaKey: 'cassazione:civile:1:2024', articleId: '1', body: 'Testo' })).status).toBe(400);
      await glossa(alice);
      const over = await request(app).post('/api/article-discussions').set(as(alice)).send({ ...ARTICLE, title: 'Terza glossa', body: 'Testo' });
      expect(over.status).toBe(429);
      expect(over.body.detail).toBe('Hai pubblicato 2 glosse nelle ultime 24 ore: riprova più tardi.');
      // Another person's count is their own.
      expect((await request(app).post('/api/article-discussions').set(as(bob)).send({ ...ARTICLE, title: 'Di Bob', body: 'Testo' })).status).toBe(201);
      expect(threadId).toBeTruthy();
    });
  });

  // Pending PR2c: no licence check yet; the reader's panel cannot show the text on a 409.
  it('writes without the licence for now, and records no version (lenient until PR2c)', async () => {
    const threadId = await glossa(alice);
    const replyId = await answer(bob, threadId, 'Risposta');
    expect((await prisma.articleThread.findUniqueOrThrow({ where: { id: threadId } })).licenceTextId).toBeNull();
    expect((await prisma.articleComment.findUniqueOrThrow({ where: { id: replyId } })).licenceTextId).toBeNull();
  });

  it('is not reachable by a connected application', async () => {
    const token = await delegated(alice, 'dossier:read');
    const threadId = await glossa(bob);
    for (const [method, url] of [
      ['get', '/api/article-discussions/feed'], ['get', `/api/article-discussions/${threadId}`],
      ['post', `/api/article-discussions/${threadId}/comments`], ['get', '/api/forum/notifications'], ['get', '/api/moderation/reports'],
    ] as const) {
      const res = await request(app)[method](url).set(token).send({ body: 'Da un’applicazione' });
      expect(res.status, url).toBeGreaterThanOrEqual(400);
      expect(res.status, url).toBeLessThan(500);
    }
    expect(await prisma.articleComment.count()).toBe(0);
  });
});
