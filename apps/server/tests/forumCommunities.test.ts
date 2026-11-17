import { describe, expect, it, beforeEach } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { request, app, createTestUser, authHeader, type TestUser } from './helpers';

// The Forum's communities by subject (spec 2026-11-14-forum-community-server-design §C; D-214, D-267,
// G-478): moderators and validators per subject, appointed by the owners; a number of validations makes a
// glossa or a reply «validata», never a gate on what is shown; validated replies on top; the appeal to the
// owners, once per hiding.

const CIVILE = 'DIRITTO_CIVILE';
const PENALE = 'DIRITTO_PENALE';
const ARTICLE = { normaKey: 'codice-civile--1453', articleId: '1453' };

describe('the Forum’s communities', () => {
  let owner: TestUser; // an administrator: one of the owners
  let alice: TestUser; // writes glosse
  let bob: TestUser; // answers
  let vera: TestUser; // validator in civil law
  let vito: TestUser; // validator in civil law
  let marco: TestUser; // moderator in civil law
  let carla: TestUser; // no profile
  beforeEach(async () => {
    owner = await createTestUser('communities-owner');
    await prisma.user.update({ where: { id: owner.id }, data: { isAdmin: true } });
    alice = await createTestUser('communities-alice');
    bob = await createTestUser('communities-bob');
    vera = await createTestUser('communities-vera');
    vito = await createTestUser('communities-vito');
    marco = await createTestUser('communities-marco');
    carla = await createTestUser('communities-carla');
    for (const [user, name] of [[alice, 'Alice Rossi'], [bob, 'Roberto Neri'], [vera, 'Vera Bianchi'], [vito, 'Vito Verdi'], [marco, 'Marco Gialli']] as const) {
      const res = await put(user, { identity: 'real_name', realName: name, qualification: 'avvocato', materie: [CIVILE] });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    for (const user of [vera, vito]) expect((await appoint(user, CIVILE, 'validator')).status).toBe(200);
    expect((await appoint(marco, CIVILE, 'moderator')).status).toBe(200);
  });

  const as = (user: TestUser) => authHeader(user);
  const put = (user: TestUser, body: unknown) => request(app).put('/api/forum/profile').set(as(user)).send(body);
  const appoint = (user: TestUser, materia: string, role: string, granted = true, by: TestUser = owner, reason: unknown = 'Nucleo dei validatori') =>
    request(app).put(`/api/admin/users/${user.id}/forum-roles`).set(as(by)).send({ materia, role, granted, reason });
  async function glossa(author: TestUser, materia: string | null = CIVILE, title = 'Inadempimento di scarsa importanza') {
    const res = await request(app).post('/api/article-discussions').set(as(author))
      .send({ ...ARTICLE, title, body: 'Quando la risoluzione è esclusa?', ...(materia ? { materia } : {}) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  }
  async function reply(author: TestUser, threadId: string, body = 'Risposta', parentId?: string) {
    const res = await request(app).post(`/api/article-discussions/${threadId}/comments`).set(as(author)).send({ body, parentId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  }
  const validate = (user: TestUser, kind: 'thread' | 'comment', id: string) => request(app).post(`/api/forum/validations/${kind}/${id}`).set(as(user));
  const unvalidate = (user: TestUser, kind: 'thread' | 'comment', id: string) => request(app).delete(`/api/forum/validations/${kind}/${id}`).set(as(user));
  const page = (user: TestUser, threadId: string) => request(app).get(`/api/article-discussions/${threadId}`).set(as(user));
  const setThreshold = (threshold: unknown, by: TestUser = owner) =>
    request(app).put('/api/admin/forum/validation-threshold').set(as(by)).send({ threshold });
  const profileId = async (user: TestUser) => (await prisma.forumProfile.findUniqueOrThrow({ where: { userId: user.id } })).id;

  describe('appointments', () => {
    it('are the owners’, with a reason, logged with the subject; a validator needs the real name', async () => {
      expect((await appoint(bob, CIVILE, 'validator', true, marco)).status).toBe(403);
      const noReason = await appoint(bob, CIVILE, 'validator', true, owner, 'no');
      expect(noReason.status).toBe(400);
      expect(noReason.body.detail).toBe('Il motivo deve avere almeno 3 caratteri');
      expect((await request(app).put('/api/admin/users/00000000-0000-4000-8000-000000000000/forum-roles').set(as(owner))
        .send({ materia: CIVILE, role: 'validator', granted: true, reason: 'Prova' })).status).toBe(404);
      const noProfile = await appoint(carla, CIVILE, 'validator');
      expect(noProfile.status).toBe(409);
      expect(noProfile.body.detail).toBe('Per nominare un validatore serve il suo profilo con il nome vero');
      expect((await appoint(carla, CIVILE, 'moderator')).body.detail).toBe('Per nominare un moderatore serve il suo profilo nel Forum');
      expect((await put(carla, { identity: 'pseudonym', pseudonym: 'carla_c', qualification: 'studente', materie: [] })).status).toBe(200);
      expect((await appoint(carla, CIVILE, 'validator')).status).toBe(409);
      expect((await appoint(carla, CIVILE, 'moderator')).body).toEqual({ roles: [{ materia: CIVILE, role: 'moderator' }] });

      expect((await appoint(bob, PENALE, 'validator')).body).toEqual({ roles: [{ materia: PENALE, role: 'validator' }] });
      // Granting what is held, or revoking what is not, changes and logs nothing.
      expect((await appoint(bob, PENALE, 'validator')).status).toBe(200);
      expect((await appoint(bob, CIVILE, 'moderator', false)).body).toEqual({ roles: [{ materia: PENALE, role: 'validator' }] });
      expect(await prisma.forumModerationLog.count({ where: { action: 'appoint_validator', targetId: bob.id, materia: PENALE } })).toBe(1);
      expect((await appoint(bob, PENALE, 'validator', false, owner, 'Fine incarico')).body).toEqual({ roles: [] });
      expect(await prisma.forumModerationLog.count({ where: { action: 'revoke_validator', targetId: bob.id, materia: PENALE, reason: 'Fine incarico' } })).toBe(1);
      expect(await prisma.forumModerationLog.count({ where: { action: 'appoint_moderator', targetId: marco.id, materia: CIVILE } })).toBe(1);
    });

    it('show on the profiles, and keep a validator under the real name', async () => {
      expect((await request(app).get('/api/forum/profile').set(as(vera))).body.roles).toEqual([{ materia: CIVILE, role: 'validator' }]);
      const pub = await request(app).get(`/api/forum/profiles/${await profileId(marco)}`).set(as(carla));
      expect(pub.body).toMatchObject({ roles: [{ materia: CIVILE, role: 'moderator' }], validatedCount: 0 });
      const refused = await put(vera, { identity: 'pseudonym', pseudonym: 'vera_b', qualification: 'avvocato', materie: [] });
      expect(refused.status).toBe(409);
      expect(refused.body.detail).toBe('Sei validatore o hai validato con il tuo nome: non puoi passare a uno pseudonimo');
    });
  });

  describe('a subject’s moderators', () => {
    it('act on their subject alone, the subject read after the glossa’s lock', async () => {
      const civil = await glossa(alice, CIVILE);
      const penal = await glossa(alice, PENALE, 'Una glossa penale');
      const none = await glossa(alice, null, 'Una glossa senza materia');
      const civilReply = await reply(bob, civil, 'Risposta civile');
      const penalReply = await reply(bob, penal, 'Risposta penale');
      const hide = (id: string) => request(app).patch(`/api/moderation/comments/${id}`).set(as(marco)).send({ hidden: true, category: 'offensivo', reason: 'Tono offensivo' });
      expect((await hide(civilReply)).status).toBe(200);
      const refused = await hide(penalReply);
      expect(refused.status).toBe(403);
      expect(refused.body.detail).toBe('Riservato ai moderatori di questa materia');
      for (const id of [penal, none]) {
        expect((await request(app).patch(`/api/moderation/threads/${id}`).set(as(marco)).send({ locked: true, reason: 'Chiusa' })).status).toBe(403);
      }
      expect((await request(app).patch(`/api/moderation/threads/${civil}`).set(as(marco)).send({ locked: true, reason: 'Chiusa' })).status).toBe(200);

      // The author moves the glossa to another subject: the subject's moderator loses it.
      expect((await request(app).patch(`/api/article-discussions/${civil}`).set(as(alice)).send({ materia: PENALE })).status).toBe(200);
      expect((await request(app).patch(`/api/moderation/comments/${civilReply}`).set(as(marco)).send({ hidden: false, reason: 'Ripristino' })).status).toBe(403);
    });

    it('see in the queue and the badge only their subject, never an account’s username', async () => {
      const civil = await glossa(alice, CIVILE);
      const penal = await glossa(alice, PENALE, 'Una glossa penale');
      const civilReply = await reply(bob, civil, 'Risposta civile');
      await request(app).post(`/api/article-discussion-comments/${civilReply}/report`).set(as(carla)).send({ reason: 'offensivo' });
      await request(app).post(`/api/article-discussions/${penal}/report`).set(as(carla)).send({ reason: 'spam' });

      const queue = await request(app).get('/api/moderation/reports').set(as(marco));
      expect(queue.status).toBe(200);
      expect(queue.body.data.map((row: { itemId: string }) => row.itemId)).toEqual([civilReply]);
      expect(queue.body.data[0]).toMatchObject({ materia: CIVILE, item: { author: null, authorName: 'Roberto Neri', authorId: await profileId(bob) } });
      expect(JSON.stringify(queue.body)).not.toContain(bob.username);
      const ownerQueue = await request(app).get('/api/moderation/reports').set(as(owner));
      expect(ownerQueue.body.data).toHaveLength(2);
      expect(ownerQueue.body.data.find((row: { itemId: string }) => row.itemId === civilReply).item.author).toBe(bob.username);
      expect((await request(app).get('/api/notifications/forum-unread-count').set(as(marco))).body.pendingReports).toBe(1);
      expect((await request(app).get('/api/notifications/forum-unread-count').set(as(owner))).body.pendingReports).toBe(2);
      // Resolving: their subject only.
      expect((await request(app).post(`/api/moderation/reports/thread/${penal}/resolve`).set(as(marco)).send({ action: 'dismiss', reason: 'Non pertinente' })).status).toBe(403);
      expect((await request(app).post(`/api/moderation/reports/comment/${civilReply}/resolve`).set(as(marco)).send({ action: 'hide', category: 'offensivo', reason: 'Offensiva' })).status).toBe(200);
    });

    it('read hidden contributions on a glossa’s page only in their subject', async () => {
      const civil = await glossa(alice, CIVILE);
      const penal = await glossa(alice, PENALE, 'Una glossa penale');
      const civilReply = await reply(bob, civil, 'Risposta civile');
      const penalReply = await reply(bob, penal, 'Risposta penale');
      await prisma.articleComment.updateMany({ where: { id: { in: [civilReply, penalReply] } }, data: { isHidden: true, hiddenReason: 'spam', hiddenAt: new Date() } });
      expect((await page(marco, civil)).body.replies[0]).toMatchObject({ body: 'Risposta civile', hidden: { category: 'spam' } });
      expect((await page(marco, penal)).body.replies).toEqual([]);
      await prisma.articleThread.update({ where: { id: penal }, data: { isHidden: true, hiddenReason: 'spam', hiddenAt: new Date() } });
      expect((await page(marco, penal)).status).toBe(404);
    });

    it('leave a report on an item gone for good to the whole Community’s moderators', async () => {
      const civil = await glossa(bob, CIVILE, 'Glossa di Bob');
      await request(app).post(`/api/article-discussions/${civil}/report`).set(as(carla)).send({ reason: 'spam' });
      expect((await request(app).delete(`/api/article-discussions/${civil}`).set(as(bob))).body).toEqual({ outcome: 'deleted' });
      const dismiss = (by: TestUser) => request(app).post(`/api/moderation/reports/thread/${civil}/resolve`).set(as(by)).send({ action: 'dismiss', reason: 'Non c’è più' });
      expect((await dismiss(marco)).status).toBe(403);
      expect((await dismiss(owner)).status).toBe(200);
    });
  });

  describe('validation', () => {
    it('makes a reply «validata» at the threshold, names its validators, and never hides what is below', async () => {
      const threadId = await glossa(alice);
      const replyId = await reply(bob, threadId, 'Risposta di Bob');
      const first = await validate(vera, 'comment', replyId);
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body.validation).toMatchObject({ count: 1, threshold: 2, validated: false, validatedAt: null });
      expect(first.body.validation.validators).toEqual([
        { id: await profileId(vera), name: 'Vera Bianchi', identity: 'real_name', qualification: 'avvocato', score: 0, username: 'Vera Bianchi' },
      ]);
      // Below the threshold the reply is published and shown as any other.
      expect((await page(carla, threadId)).body.replies[0]).toMatchObject({ id: replyId, body: 'Risposta di Bob', validation: { count: 1, validated: false } });
      expect((await validate(vera, 'comment', replyId)).body.validation.count).toBe(1);
      const second = await validate(vito, 'comment', replyId);
      expect(second.body.validation).toMatchObject({ count: 2, validated: true, validatedAt: expect.any(String) });
      expect(await prisma.forumNotification.count({ where: { userId: bob.id, kind: 'validated', commentId: replyId } })).toBe(1);

      // Withdrawn and given again: the author is told once.
      expect((await unvalidate(vito, 'comment', replyId)).body.validation).toMatchObject({ count: 1, validated: false });
      expect((await unvalidate(vito, 'comment', replyId)).status).toBe(404);
      await validate(vito, 'comment', replyId);
      expect(await prisma.forumNotification.count({ where: { userId: bob.id, kind: 'validated' } })).toBe(1);

      // A glossa too, with no reply id on its notification.
      expect((await validate(vera, 'thread', threadId)).body.validation.count).toBe(1);
      await validate(vito, 'thread', threadId);
      expect(await prisma.forumNotification.count({ where: { userId: alice.id, kind: 'validated', commentId: null } })).toBe(1);
    });

    it('is a validator’s of the subject, under the real name, on someone else’s glossa or reply', async () => {
      const threadId = await glossa(alice);
      const replyId = await reply(bob, threadId, 'Risposta di Bob');
      const commentId = await reply(vito, threadId, 'Un commento', replyId);
      const own = await reply(vera, threadId, 'Risposta di Vera');
      const penal = await glossa(alice, PENALE, 'Una glossa penale');
      const none = await glossa(alice, null, 'Senza materia');
      for (const [res, status, detail] of [
        [await validate(carla, 'comment', replyId), 403, 'Solo i validatori di questa materia possono validare'],
        [await validate(vera, 'thread', penal), 403, 'Solo i validatori di questa materia possono validare'],
        [await validate(vera, 'comment', own), 403, 'Non puoi validare un tuo contributo'],
        [await validate(vera, 'comment', commentId), 400, 'Si valida una glossa o una risposta, non un commento'],
        [await validate(vera, 'thread', none), 409, 'La glossa non ha una materia: non si può validare'],
        [await validate(vera, 'thread', '00000000-0000-4000-8000-000000000000'), 404, 'Glossa non trovata'],
      ] as const) {
        expect(res.status, detail).toBe(status);
        expect(res.body.detail).toBe(detail);
      }
      expect((await request(app).post(`/api/forum/validations/other/${replyId}`).set(as(vera))).status).toBe(400);
      // Hidden, or under a hidden glossa: not there to validate.
      await prisma.articleComment.update({ where: { id: replyId }, data: { isHidden: true, hiddenReason: 'spam', hiddenAt: new Date() } });
      expect((await validate(vito, 'comment', replyId)).status).toBe(404);
      await prisma.articleComment.update({ where: { id: replyId }, data: { isHidden: false, hiddenReason: null, hiddenAt: null } });
      await prisma.articleThread.update({ where: { id: threadId }, data: { isHidden: true, hiddenReason: 'spam', hiddenAt: new Date() } });
      expect((await validate(vito, 'comment', replyId)).status).toBe(404);
      expect((await validate(vito, 'thread', threadId)).status).toBe(404);
      await prisma.articleThread.update({ where: { id: threadId }, data: { isHidden: false, hiddenReason: null, hiddenAt: null } });
      await prisma.forumProfile.update({ where: { userId: vera.id }, data: { nameWithdrawnAt: new Date(), nameWithdrawnReason: 'Prova' } });
      expect((await validate(vera, 'comment', replyId)).body.error).toBe('name_withdrawn');
    });

    it('follows the owners’ threshold at once, on the record', async () => {
      const threadId = await glossa(alice);
      const replyId = await reply(bob, threadId, 'Risposta');
      await validate(vera, 'comment', replyId);
      expect((await setThreshold(1, marco)).status).toBe(403);
      expect((await setThreshold(6)).body.detail).toBe('La soglia va da 1 a 5');
      expect((await request(app).get('/api/admin/forum/validation-threshold').set(as(owner))).body).toEqual({ threshold: 2, limits: { min: 1, max: 5 }, default: 2 });
      expect((await setThreshold(1)).body).toEqual({ threshold: 1, limits: { min: 1, max: 5 }, default: 2 });
      expect((await page(carla, threadId)).body.replies[0].validation).toMatchObject({ count: 1, threshold: 1, validated: true });
      expect(await prisma.lingoImpostazioneLog.count({ where: { chiave: 'FORUM_SOGLIA_VALIDAZIONI', valorePrecedente: 2, valoreNuovo: 1, utenteId: owner.id } })).toBe(1);
      // Learn's thresholds are untouched.
      expect((await request(app).get('/api/admin/studia/soglie').set(as(owner))).body.soglie).toEqual({ approvazioni: 2, errate: 1 });
    });

    it('is withdrawn by an edit of the text, and a change of subject withdraws the glossa’s and its replies’', async () => {
      const threadId = await glossa(alice);
      const replyId = await reply(bob, threadId, 'Risposta di Bob');
      await validate(vera, 'comment', replyId);
      await validate(vito, 'comment', replyId);
      await validate(vera, 'thread', threadId);
      const edited = await request(app).patch(`/api/article-discussion-comments/${replyId}`).set(as(bob)).send({ body: 'Risposta di Bob, corretta' });
      expect(edited.body).toMatchObject({ validationsWithdrawn: 2 });
      expect(await prisma.forumValidation.count({ where: { commentId: replyId } })).toBe(0);
      await validate(vito, 'comment', replyId);
      // The glossa's own text: its validations go, its replies' stay.
      await validate(vera, 'thread', threadId);
      const retitled = await request(app).patch(`/api/article-discussions/${threadId}`).set(as(alice)).send({ body: 'Un testo nuovo della glossa' });
      expect(retitled.body).toMatchObject({ validationsWithdrawn: 1 });
      expect(await prisma.forumValidation.count({ where: { commentId: replyId } })).toBe(1);
      await validate(vera, 'thread', threadId);
      const moved = await request(app).patch(`/api/article-discussions/${threadId}`).set(as(alice)).send({ materia: PENALE });
      expect(moved.body).toMatchObject({ validationsWithdrawn: 2 });
      expect(await prisma.forumValidation.count()).toBe(0);
      // Emptied by its author (a comment hangs on it): what was validated is gone.
      const civil = await glossa(alice, CIVILE, 'Un’altra glossa civile');
      const civilReply = await reply(bob, civil, 'Risposta da svuotare');
      await validate(vera, 'comment', civilReply);
      await reply(carla, civil, 'Commento', civilReply);
      expect((await request(app).delete(`/api/article-discussion-comments/${civilReply}`).set(as(bob))).body).toEqual({ outcome: 'emptied' });
      expect(await prisma.forumValidation.count({ where: { commentId: civilReply } })).toBe(0);
      // The subject alone, without a change of text: nothing to withdraw, nothing marked edited.
      const same = await request(app).patch(`/api/article-discussions/${threadId}`).set(as(alice)).send({ materia: PENALE });
      expect(same.body).toMatchObject({ validationsWithdrawn: 0 });
    });

    it('puts the validated replies on top, then the accepted one, then by score', async () => {
      await setThreshold(1);
      const threadId = await glossa(alice);
      const accepted = await reply(bob, threadId, 'Risposta accettata');
      const liked = await reply(carla, threadId, 'Risposta molto votata');
      const later = await reply(marco, threadId, 'Validata una volta, dopo');
      const once = await reply(marco, threadId, 'Validata una volta, prima');
      const twice = await reply(bob, threadId, 'Validata due volte');
      await request(app).post(`/api/article-discussions/${threadId}/accept`).set(as(alice)).send({ commentId: accepted });
      await request(app).put(`/api/article-discussion-comments/${liked}/vote`).set(as(alice)).send({ value: 1 });
      await validate(vera, 'comment', once);
      await validate(vera, 'comment', later);
      await validate(vera, 'comment', twice);
      await validate(vito, 'comment', twice);
      // Same count: the earlier to reach the threshold first.
      expect((await page(carla, threadId)).body.replies.map((r: { id: string }) => r.id)).toEqual([twice, once, later, accepted, liked]);
      // A validated reply hidden by moderation does not lead in its author's view.
      await prisma.articleComment.update({ where: { id: twice }, data: { isHidden: true, hiddenReason: 'spam', hiddenAt: new Date() } });
      expect((await page(bob, threadId)).body.replies.map((r: { id: string }) => r.id)).toEqual([once, later, accepted, liked, twice]);
    });

    it('keeps a revoked validator’s validations', async () => {
      await setThreshold(1);
      const threadId = await glossa(alice);
      const replyId = await reply(bob, threadId, 'Risposta');
      await validate(vera, 'comment', replyId);
      expect((await appoint(vera, CIVILE, 'validator', false, owner, 'Fine incarico')).body).toEqual({ roles: [] });
      expect((await page(carla, threadId)).body.replies[0].validation).toMatchObject({ count: 1, validated: true });
      expect((await validate(vera, 'comment', replyId)).status).toBe(403);
    });

    it('marks the feed and filters it, nothing else depending on it', async () => {
      await setThreshold(1);
      const plain = await glossa(alice, CIVILE, 'Senza validazioni');
      const validatedGlossa = await glossa(alice, CIVILE, 'Glossa validata');
      const withReply = await glossa(alice, CIVILE, 'Con una risposta validata');
      const replyId = await reply(bob, withReply, 'Risposta');
      await validate(vera, 'thread', validatedGlossa);
      await validate(vera, 'comment', replyId);
      const feed = await request(app).get('/api/article-discussions/feed').set(as(carla));
      const byId = new Map(feed.body.data.map((t: { id: string }) => [t.id, t]));
      expect(byId.get(validatedGlossa)).toMatchObject({ validated: true, validatedReplies: 0 });
      expect(byId.get(withReply)).toMatchObject({ validated: false, validatedReplies: 1 });
      expect(byId.get(plain)).toMatchObject({ validated: false, validatedReplies: 0 });
      const yes = await request(app).get('/api/article-discussions/feed').set(as(carla)).query({ validated: 'true' });
      expect(yes.body.data.map((t: { id: string }) => t.id).sort()).toEqual([validatedGlossa, withReply].sort());
      const no = await request(app).get('/api/article-discussions/feed').set(as(carla)).query({ validated: 'false' });
      expect(no.body.data.map((t: { id: string }) => t.id)).toEqual([plain]);
    });

    it('lists a person’s validated contributions on the profile', async () => {
      await setThreshold(1);
      const threadId = await glossa(alice);
      const replyId = await reply(bob, threadId, 'Risposta');
      await validate(vera, 'comment', replyId);
      await validate(vera, 'thread', threadId);
      const bobProfile = await profileId(bob);
      expect((await request(app).get(`/api/forum/profiles/${bobProfile}`).set(as(carla))).body.validatedCount).toBe(1);
      const list = await request(app).get(`/api/forum/profiles/${bobProfile}/validated`).set(as(carla));
      expect(list.body.data).toEqual([expect.objectContaining({ kind: 'comment', threadId, commentId: replyId, title: 'Inadempimento di scarsa importanza', materia: CIVILE, count: 1, validatedAt: expect.any(String) })]);
      expect(list.body.pagination).toMatchObject({ page: 1, total: 1 });
      expect((await request(app).get('/api/forum/profiles/00000000-0000-4000-8000-000000000000/validated').set(as(carla))).status).toBe(404);
    });

    it('outlives the validator’s account, unnamed, and still counts', async () => {
      await setThreshold(1);
      const threadId = await glossa(alice);
      const replyId = await reply(bob, threadId, 'Risposta');
      await validate(vera, 'comment', replyId);
      const deleted = await request(app).delete('/api/auth/account').set(as(vera)).send({ password: 'test-password', confirmation: 'ELIMINA ACCOUNT' });
      expect(deleted.status).toBe(204);
      expect((await page(carla, threadId)).body.replies[0].validation).toMatchObject({
        count: 1, validated: true, validators: [{ id: null, name: 'utente cancellato', identity: 'deleted', qualification: null, score: null, username: 'utente cancellato' }],
      });
    });
  });

  it('lists the communities with their counts, moderators and validators', async () => {
    await glossa(alice, CIVILE);
    await glossa(alice, CIVILE, 'Seconda civile');
    await glossa(alice, PENALE, 'Una penale');
    await glossa(alice, null, 'Senza materia');
    const res = await request(app).get('/api/forum/communities').set(as(carla));
    expect(res.body.data).toHaveLength(5);
    const civil = res.body.data.find((c: { materia: string }) => c.materia === CIVILE);
    expect(civil).toMatchObject({ glosse: 2, members: 5 });
    expect(civil.moderators.map((m: { name: string }) => m.name)).toEqual(['Marco Gialli']);
    expect(civil.validators.map((m: { name: string }) => m.name).sort()).toEqual(['Vera Bianchi', 'Vito Verdi']);
    expect(res.body.data.find((c: { materia: string }) => c.materia === PENALE)).toMatchObject({ glosse: 1, members: 0, moderators: [], validators: [] });
    expect(res.body.withoutSubject).toEqual({ glosse: 1 });
  });

  describe('the appeal to the owners', () => {
    const hideReply = (id: string, by: TestUser) =>
      request(app).patch(`/api/moderation/comments/${id}`).set(as(by)).send({ hidden: true, category: 'offensivo', reason: 'Tono offensivo' });
    const appeal = (user: TestUser, itemId: string, kind = 'comment') =>
      request(app).post('/api/forum/appeals').set(as(user)).send({ kind, itemId, text: 'Non era offensiva: citavo una sentenza.' });

    it('comes once per hiding, from the author of what is hidden', async () => {
      const threadId = await glossa(alice);
      const replyId = await reply(bob, threadId, 'Risposta di Bob');
      expect((await appeal(bob, replyId)).status).toBe(404);
      await hideReply(replyId, marco);
      expect((await appeal(carla, replyId)).status).toBe(404);
      const made = await appeal(bob, replyId);
      expect(made.status).toBe(201);
      expect(made.body).toEqual({ id: expect.any(String), status: 'pending' });
      const again = await appeal(bob, replyId);
      expect(again.status).toBe(409);
      expect(again.body.detail).toBe('Hai già fatto ricorso contro questa decisione');
      expect((await page(bob, threadId)).body.replies[0].hidden).toEqual({ category: 'offensivo', appeal: 'pending' });

      expect((await request(app).get('/api/moderation/appeals').set(as(marco))).status).toBe(403);
      const queue = await request(app).get('/api/moderation/appeals').set(as(owner));
      expect(queue.body.data).toEqual([expect.objectContaining({
        id: made.body.id, kind: 'comment', itemId: replyId, threadId, status: 'pending', materia: CIVILE,
        text: 'Non era offensiva: citavo una sentenza.',
        item: expect.objectContaining({ body: 'Risposta di Bob', category: 'offensivo' }), hidingReason: 'Tono offensivo',
      })]);

      const decide = (body: unknown, by: TestUser = owner) => request(app).post(`/api/moderation/appeals/${made.body.id}/decide`).set(as(by)).send(body);
      expect((await decide({ action: 'reject', reason: 'Confermo' }, marco)).status).toBe(403);
      expect((await decide({ action: 'reject' })).status).toBe(400);
      expect((await decide({ action: 'reject', reason: 'Il tono resta offensivo' })).body).toEqual({ status: 'rejected' });
      expect((await decide({ action: 'uphold', reason: 'Ci ripenso' })).status).toBe(409);
      expect(await prisma.forumModerationLog.count({ where: { action: 'appeal_rejected', targetKind: 'comment', targetId: replyId } })).toBe(1);
      expect(await prisma.forumNotification.count({ where: { userId: bob.id, kind: 'appeal', commentId: replyId } })).toBe(1);
      expect((await page(bob, threadId)).body.replies[0].hidden).toEqual({ category: 'offensivo', appeal: 'rejected' });
      expect((await appeal(bob, replyId)).status).toBe(409);

      // Shown again, then hidden again: a new hiding, a new appeal, upheld.
      await request(app).patch(`/api/moderation/comments/${replyId}`).set(as(owner)).send({ hidden: false, reason: 'Ripristino' });
      await hideReply(replyId, marco);
      const second = await appeal(bob, replyId);
      expect(second.status).toBe(201);
      expect((await request(app).post(`/api/moderation/appeals/${second.body.id}/decide`).set(as(owner)).send({ action: 'uphold', reason: 'Era una citazione' })).body).toEqual({ status: 'upheld' });
      expect((await page(carla, threadId)).body.replies[0]).toMatchObject({ body: 'Risposta di Bob', hidden: null });
      expect(await prisma.forumModerationLog.count({ where: { action: 'unhide', targetId: replyId, reason: 'Era una citazione' } })).toBe(1);
    });

    it('works on a glossa hidden from the reports’ queue, and goes when the author empties it', async () => {
      const threadId = await glossa(alice, CIVILE, 'Glossa di Alice');
      await reply(bob, threadId, 'Risposta di Bob');
      await request(app).post(`/api/article-discussions/${threadId}/report`).set(as(carla)).send({ reason: 'offensivo' });
      expect((await request(app).post(`/api/moderation/reports/thread/${threadId}/resolve`).set(as(marco)).send({ action: 'hide', category: 'offensivo', reason: 'Offensiva' })).status).toBe(200);
      const made = await appeal(alice, threadId, 'thread');
      expect(made.status).toBe(201);
      expect((await page(alice, threadId)).body.hidden).toEqual({ category: 'offensivo', appeal: 'pending' });
      expect((await request(app).post('/api/moderation/appeals/00000000-0000-4000-8000-000000000000/decide').set(as(owner)).send({ action: 'reject', reason: 'Nessuno' })).status).toBe(404);
      // A hidden glossa is deleted by its author only as its own: emptied, Bob's reply hangs on it.
      expect((await request(app).delete(`/api/article-discussions/${threadId}`).set(as(alice))).body).toEqual({ outcome: 'emptied' });
      expect(await prisma.forumAppeal.count({ where: { targetId: threadId } })).toBe(0);
    });

    it('never passes the moderator’s free reason on to the author', async () => {
      const threadId = await glossa(alice);
      const replyId = await reply(bob, threadId, 'Risposta di Bob');
      await hideReply(replyId, marco);
      const made = await appeal(bob, replyId);
      await request(app).patch(`/api/moderation/comments/${replyId}`).set(as(marco)).send({ hidden: false, reason: 'Segnalata da Carla per errore' });
      const closed = await prisma.forumAppeal.findUniqueOrThrow({ where: { id: made.body.id } });
      expect(closed).toMatchObject({ status: 'upheld', decisionNote: 'Il contributo è stato ripristinato' });
      expect(JSON.stringify((await request(app).get('/api/auth/export').set(as(bob))).body)).not.toContain('Segnalata da Carla');
    });

    it('closes as upheld when the item is shown again, and goes with the author’s deletion', async () => {
      const threadId = await glossa(alice);
      const replyId = await reply(bob, threadId, 'Risposta di Bob');
      await hideReply(replyId, marco);
      const made = await appeal(bob, replyId);
      await request(app).patch(`/api/moderation/comments/${replyId}`).set(as(marco)).send({ hidden: false, reason: 'Ci ho ripensato' });
      expect((await prisma.forumAppeal.findUniqueOrThrow({ where: { id: made.body.id } })).status).toBe('upheld');

      await hideReply(replyId, marco);
      await appeal(bob, replyId);
      expect((await request(app).delete(`/api/article-discussion-comments/${replyId}`).set(as(bob))).body).toEqual({ outcome: 'deleted' });
      expect(await prisma.forumAppeal.count({ where: { targetId: replyId } })).toBe(0);
    });
  });

  it('exports the person’s roles, validations and appeals, never who appointed or decided', async () => {
    await setThreshold(1);
    const threadId = await glossa(alice);
    const replyId = await reply(bob, threadId, 'Risposta di Bob');
    await validate(vera, 'comment', replyId);
    const veraExport = await request(app).get('/api/auth/export').set(as(vera));
    expect(veraExport.body.data.forumSubjectRoles).toEqual([{ materia: CIVILE, role: 'validator', createdAt: expect.any(String) }]);
    expect(veraExport.body.data.forumValidations).toEqual([{ threadId: null, commentId: replyId, materia: CIVILE, createdAt: expect.any(String) }]);
    await request(app).patch(`/api/moderation/comments/${replyId}`).set(as(marco)).send({ hidden: true, category: 'offensivo', reason: 'Tono' });
    const made = await request(app).post('/api/forum/appeals').set(as(bob)).send({ kind: 'comment', itemId: replyId, text: 'Ricorso di prova' });
    await request(app).post(`/api/moderation/appeals/${made.body.id}/decide`).set(as(owner)).send({ action: 'reject', reason: 'Confermo' });
    const bobExport = await request(app).get('/api/auth/export').set(as(bob));
    expect(bobExport.body.data.forumAppeals).toEqual([{
      targetKind: 'comment', targetId: replyId, text: 'Ricorso di prova', status: 'rejected', createdAt: expect.any(String),
      decidedAt: expect.any(String), decisionNote: 'Confermo',
    }]);
    expect(JSON.stringify(bobExport.body.data.forumAppeals)).not.toContain(owner.id);
    expect(JSON.stringify(veraExport.body.data.forumSubjectRoles)).not.toContain(owner.id);
  });
});
