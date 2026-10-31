import { describe, expect, it, beforeEach } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { sweepCommunity } from '../src/forum/sweep';
import { request, app, createTestUser, authHeader, type TestUser } from './helpers';

// The Community's data (spec 2026-10-20-forum-community-glosse-design, pull request 1): contributions
// outlive their author's account (G-307), a report keeps a copy of what it reported (G-308), the feed's
// last activity moves only with a reply.

const ARTICLE = { normaKey: 'codice-civile--art-1453', articleId: '1453' };
const PASSAGE = { quote: 'Nei contratti con prestazioni corrispettive', start: 0, prefix: '', suffix: ' quando uno dei contraenti' };
const DAY_MS = 24 * 60 * 60 * 1000;

async function writeGlossa(author: TestUser, title = 'Risoluzione per inadempimento') {
  const created = await request(app).post('/api/article-discussions').set(authHeader(author))
    .send({ ...ARTICLE, title, body: 'Quando l’inadempimento è di scarsa importanza?', passage: PASSAGE });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

async function reply(author: TestUser, threadId: string, body: string) {
  const created = await request(app).post(`/api/article-discussions/${threadId}/comments`).set(authHeader(author)).send({ body });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

async function deleteAccount(user: TestUser) {
  const deleted = await request(app).delete('/api/auth/account').set(authHeader(user))
    .send({ password: 'test-password', confirmation: 'ELIMINA ACCOUNT' });
  expect(deleted.status).toBe(204);
}

describe('the Community’s data', () => {
  let alice: TestUser;
  let bob: TestUser;
  let carla: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('community-alice');
    bob = await createTestUser('community-bob');
    carla = await createTestUser('community-carla');
  });

  describe('deleting an account (G-307)', () => {
    it('keeps the author’s glossa and the replies others wrote under it, without the author', async () => {
      const threadId = await writeGlossa(alice);
      await reply(bob, threadId, 'Risposta di Bob');
      await reply(alice, threadId, 'Alice risponde a Bob');
      await request(app).post(`/api/article-discussions/${threadId}/vote`).set(authHeader(alice));
      await request(app).post(`/api/article-discussions/${threadId}/vote`).set(authHeader(bob));
      const bobThread = await writeGlossa(bob, 'La glossa di Bob');
      await request(app).post(`/api/article-discussions/${bobThread}/report`).set(authHeader(alice)).send({ reason: 'spam' });

      await deleteAccount(alice);

      const listed = await request(app).get('/api/article-discussions').set(authHeader(bob)).query(ARTICLE);
      expect(listed.status).toBe(200);
      const glossa = listed.body.data.find((thread: { id: string }) => thread.id === threadId);
      expect(glossa).toMatchObject({ user: { id: null, username: 'utente cancellato' }, isOwner: false, voteCount: 1 });
      expect(glossa.comments.map((comment: { body: string; user: { username: string }; isOwner: boolean }) => [comment.body, comment.user.username, comment.isOwner]))
        .toEqual([['Risposta di Bob', bob.username, true], ['Alice risponde a Bob', 'utente cancellato', false]]);

      // The reader's passage signs read the same rows.
      const passages = await request(app).get('/api/article-discussions/passages').set(authHeader(bob)).query(ARTICLE);
      expect(passages.status).toBe(200);
      expect(passages.body.data.find((thread: { id: string }) => thread.id === threadId))
        .toMatchObject({ user: { id: null, username: 'utente cancellato' }, commentCount: 2 });

      // Her report stays, without a reporter: it is the moderators' evidence.
      const report = await prisma.articleThreadReport.findFirstOrThrow({ where: { threadId: bobThread } });
      expect(report.userId).toBeNull();
    });

    it('keeps a reply whose author is gone, and nobody owns it', async () => {
      const threadId = await writeGlossa(alice);
      await reply(bob, threadId, 'Risposta di Bob');

      await deleteAccount(bob);

      const listed = await request(app).get('/api/article-discussions').set(authHeader(alice)).query(ARTICLE);
      expect(listed.body.data[0]).toMatchObject({ isOwner: true });
      expect(listed.body.data[0].comments[0]).toMatchObject({ body: 'Risposta di Bob', user: { id: null, username: 'utente cancellato' }, isOwner: false });
    });

    it('takes the person’s votes and notifications with the account', async () => {
      const threadId = await writeGlossa(alice);
      const replyId = await reply(bob, threadId, 'Risposta di Bob');
      await request(app).post(`/api/article-discussion-comments/${replyId}/vote`).set(authHeader(carla));
      await prisma.forumNotification.create({ data: { userId: carla.id, kind: 'comment', threadId, commentId: replyId } });

      await deleteAccount(carla);

      expect(await prisma.articleCommentVote.count({ where: { commentId: replyId } })).toBe(0);
      expect(await prisma.forumNotification.count()).toBe(0);
    });
  });

  describe('reports (G-308)', () => {
    it('keeps a copy of the reported glossa, and a second report replaces it and is pending again', async () => {
      const threadId = await writeGlossa(alice, 'Titolo originale');

      expect((await request(app).post(`/api/article-discussions/${threadId}/report`).set(authHeader(bob)).send({ reason: 'dati_personali', details: 'Nomina un cliente' })).status).toBe(204);
      let report = await prisma.articleThreadReport.findFirstOrThrow({ where: { threadId } });
      expect(report).toMatchObject({ reason: 'dati_personali', details: 'Nomina un cliente', status: 'pending',
        reportedText: 'Titolo originale\n\nQuando l’inadempimento è di scarsa importanza?' });

      await prisma.articleThreadReport.update({ where: { id: report.id }, data: { status: 'dismissed', resolvedAt: new Date(), resolvedById: carla.id, resolutionNote: 'Nessun dato' } });
      await prisma.articleThread.update({ where: { id: threadId }, data: { title: 'Titolo cambiato' } });
      expect((await request(app).post(`/api/article-discussions/${threadId}/report`).set(authHeader(bob)).send({ reason: 'spam' })).status).toBe(204);

      report = await prisma.articleThreadReport.findFirstOrThrow({ where: { threadId } });
      expect(report).toMatchObject({ reason: 'spam', details: null, status: 'pending', resolvedAt: null, resolvedById: null, resolutionNote: null });
      expect(report.reportedText).toMatch(/^Titolo cambiato\n\n/);
    });

    it('keeps a report after its glossa is deleted for good', async () => {
      const threadId = await writeGlossa(alice);
      await request(app).post(`/api/article-discussions/${threadId}/report`).set(authHeader(bob)).send({ reason: 'offensivo' });

      await prisma.articleThread.delete({ where: { id: threadId } });

      expect(await prisma.articleThreadReport.findFirst({ where: { threadId } })).toMatchObject({ reason: 'offensivo', status: 'pending' });
    });

    // Pending PR2c: with the panel's menu of reasons, a reason outside the closed list becomes a 400.
    it('reads a free reason as «altro», its text kept in the details (lenient until PR2c)', async () => {
      const threadId = await writeGlossa(alice);

      expect((await request(app).post(`/api/article-discussions/${threadId}/report`).set(authHeader(bob)).send({ reason: 'segnalazione' })).status).toBe(204);
      expect((await request(app).post(`/api/article-discussions/${threadId}/report`).set(authHeader(carla)).send({ reason: 'abuso', details: 'Insulta' })).status).toBe(204);

      const reports = await prisma.articleThreadReport.findMany({ where: { threadId }, orderBy: { createdAt: 'asc' } });
      expect(reports.map((report) => [report.reason, report.details])).toEqual([['altro', 'segnalazione'], ['altro', 'abuso: Insulta']]);
    });

    it('refuses a reason or a status outside the closed lists in the database', async () => {
      const threadId = await writeGlossa(alice);
      await expect(prisma.articleThreadReport.create({ data: { threadId, userId: bob.id, reason: 'segnalazione' } })).rejects.toThrow();
      await expect(prisma.articleThreadReport.create({ data: { threadId, userId: bob.id, reason: 'spam', status: 'chiusa' } })).rejects.toThrow();
    });
  });

  describe('the sweep', () => {
    it('erases a closed report’s copy after 90 days and deletes notifications read 90 days ago', async () => {
      const threadId = await writeGlossa(alice);
      const replyId = await reply(bob, threadId, 'Risposta di Bob');
      const now = new Date();
      const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);
      const report = (userId: string, status: string, resolvedAt: Date | null) =>
        prisma.articleThreadReport.create({ data: { threadId, userId, reason: 'spam', status, resolvedAt, reportedText: 'copia' } });
      const old = await report(bob.id, 'dismissed', daysAgo(91));
      const recent = await report(carla.id, 'resolved', daysAgo(89));
      const pending = await report(alice.id, 'pending', null);
      const commentReport = await prisma.articleCommentReport.create({
        data: { commentId: replyId, threadId, userId: carla.id, reason: 'spam', status: 'dismissed', resolvedAt: daysAgo(100), reportedText: 'copia' },
      });
      const notification = (readAt: Date | null) => prisma.forumNotification.create({ data: { userId: alice.id, kind: 'reply', threadId, commentId: replyId, readAt } });
      const readLongAgo = await notification(daysAgo(91));
      const readRecently = await notification(daysAgo(10));
      const unread = await notification(null);

      expect(await sweepCommunity(now)).toEqual({ reportCopies: 2, notifications: 1 });

      const copy = async (id: string) => (await prisma.articleThreadReport.findUniqueOrThrow({ where: { id } })).reportedText;
      expect(await copy(old.id)).toBeNull();
      expect(await copy(recent.id)).toBe('copia');
      expect(await copy(pending.id)).toBe('copia');
      expect((await prisma.articleCommentReport.findUniqueOrThrow({ where: { id: commentReport.id } })).reportedText).toBeNull();
      const left = (await prisma.forumNotification.findMany()).map((row) => row.id).sort();
      expect(left).toEqual([readRecently.id, unread.id].sort());
      expect(left).not.toContain(readLongAgo.id);
    });
  });

  describe('the last activity', () => {
    it('moves with a reply, not with a moderator’s act, and orders «active»', async () => {
      const first = await writeGlossa(alice, 'Prima glossa');
      const second = await writeGlossa(bob, 'Seconda glossa');
      const past = new Date(Date.now() - 10 * DAY_MS);
      await prisma.articleThread.updateMany({ data: { lastActivityAt: past } });

      await reply(carla, first, 'Risposta recente');
      const admin = await prisma.user.update({ where: { id: carla.id }, data: { isAdmin: true } });
      expect(admin.isAdmin).toBe(true);
      expect((await request(app).patch(`/api/admin/article-discussions/${second}`).set(authHeader(carla)).send({ hidden: false })).status).toBe(200);

      const rows = await prisma.articleThread.findMany({ orderBy: { title: 'asc' } });
      expect(rows[0].lastActivityAt.getTime()).toBeGreaterThan(past.getTime());
      expect(rows[1].lastActivityAt.getTime()).toBe(past.getTime());

      const active = await request(app).get('/api/article-discussions').set(authHeader(alice)).query({ ...ARTICLE, sort: 'active' });
      expect(active.body.data.map((thread: { id: string }) => thread.id)).toEqual([first, second]);
    });
  });

  describe('the closed lists and the emptied text', () => {
    it('holds in the database', async () => {
      const threadId = await writeGlossa(alice);
      const replyId = await reply(bob, threadId, 'Risposta di Bob');
      await expect(prisma.articleThread.update({ where: { id: threadId }, data: { deletedAt: new Date() } })).rejects.toThrow();
      await expect(prisma.articleComment.update({ where: { id: replyId }, data: { deletedAt: new Date() } })).rejects.toThrow();
      await expect(prisma.articleThread.update({ where: { id: threadId }, data: { hiddenReason: 'antipatico' } })).rejects.toThrow();
      await expect(prisma.forumNotification.create({ data: { userId: alice.id, kind: 'reply', threadId } })).rejects.toThrow();
      await expect(prisma.forumModerationLog.create({ data: { actorId: carla.id, action: 'hide', targetKind: 'thread', targetId: threadId } })).rejects.toThrow();
      await expect(prisma.forumModerationLog.create({ data: { actorId: carla.id, action: 'release_passage', targetKind: 'thread', targetId: threadId } })).resolves.toBeTruthy();

      await prisma.articleThread.update({ where: { id: threadId }, data: { deletedAt: new Date(), title: '', body: '' } });
      await prisma.articleComment.update({ where: { id: replyId }, data: { deletedAt: new Date(), body: '' } });
    });

    it('seeds version 1 of the Community’s licence', async () => {
      const text = await prisma.lingoTestoVersione.findFirstOrThrow({ where: { chiave: 'CONTRIBUTO_COMMUNITY' } });
      expect(text).toMatchObject({ versione: 1, autoreId: null });
      expect(text.corpo).toContain('CC BY-SA 4.0');
    });
  });
});
