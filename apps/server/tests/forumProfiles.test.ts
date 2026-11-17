import { describe, expect, it, beforeEach } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { sweepCommunity } from '../src/forum/sweep';
import { request, app, createTestUser, authHeader, type TestUser } from './helpers';

// The Forum's minimal profile (spec 2026-11-14-forum-community-server-design §B; D-246, D-247, D-249, G-477,
// G-479): one public identity, the real name or a pseudonym; the qualification and the real name declared;
// the profile's own public id; writing behind a profile once the switch `forum_identity` is on; the report
// «non è chi dice di essere», read by the owners, who may withdraw the name.

const ARTICLE = { normaKey: 'codice-civile--1453', articleId: '1453' };
const REAL = { identity: 'real_name', realName: 'Maria Bianchi', qualification: 'avvocato', materie: ['DIRITTO_CIVILE'] };
const PSEUDO = { identity: 'pseudonym', pseudonym: 'civilista42', qualification: 'praticante', materie: [] };

describe('the Forum’s profile', () => {
  let alice: TestUser;
  let bob: TestUser;
  let carla: TestUser;
  let owner: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('profiles-alice');
    bob = await createTestUser('profiles-bob');
    carla = await createTestUser('profiles-carla');
    owner = await createTestUser('profiles-owner');
    await prisma.user.update({ where: { id: owner.id }, data: { isAdmin: true } });
  });

  const as = (user: TestUser) => authHeader(user);
  const put = (user: TestUser, body: unknown) => request(app).put('/api/forum/profile').set(as(user)).send(body);
  const mine = (user: TestUser) => request(app).get('/api/forum/profile').set(as(user));
  const publicOf = (viewer: TestUser, id: string) => request(app).get(`/api/forum/profiles/${id}`).set(as(viewer));
  const switchIdentity = (enabled: boolean) => prisma.appSwitch.upsert({
    where: { key: 'forum_identity' }, create: { key: 'forum_identity', enabled }, update: { enabled },
  });
  const writeGlossa = (author: TestUser, title = 'Inadempimento di scarsa importanza') =>
    request(app).post('/api/article-discussions').set(as(author)).send({ ...ARTICLE, title, body: 'Quando la risoluzione è esclusa?' });
  const writeReply = (author: TestUser, threadId: string, body = 'Risposta', parentId?: string) =>
    request(app).post(`/api/article-discussions/${threadId}/comments`).set(as(author)).send({ body, parentId });
  async function glossa(author: TestUser) {
    const res = await writeGlossa(author);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  }
  async function reply(author: TestUser, threadId: string, body = 'Risposta', parentId?: string) {
    const res = await writeReply(author, threadId, body, parentId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  }

  describe('one’s own profile', () => {
    it('is null at first, then created and changed, answering as its read', async () => {
      const empty = await mine(alice);
      expect(empty.body).toEqual({
        profile: null, required: false, canWrite: true, canSign: true, score: 0,
        contributions: { glosse: 0, risposte: 0 }, roles: [], nameWithdrawn: null,
      });

      const created = await put(alice, REAL);
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      expect(created.body).toMatchObject({
        profile: { id: expect.any(String), identity: 'real_name', realName: 'Maria Bianchi', pseudonym: null,
          qualification: 'avvocato', materie: ['DIRITTO_CIVILE'], updatedAt: expect.any(String) },
        required: false, canWrite: true, canSign: true, nameWithdrawn: null,
      });
      expect(created.body.profile.id).not.toBe(alice.id);
      expect((await mine(alice)).body).toEqual(created.body);

      const changed = await put(alice, { ...REAL, realName: 'Maria Rossi Bianchi', qualification: 'docente', materie: ['DIRITTO_PENALE', 'DIRITTO_PENALE'] });
      expect(changed.body.profile).toMatchObject({ id: created.body.profile.id, realName: 'Maria Rossi Bianchi', qualification: 'docente', materie: ['DIRITTO_PENALE'] });
    });

    it('refuses each field out of its form, in Italian', async () => {
      for (const [body, detail] of [
        [{ ...REAL, realName: 'Ma' }, 'Il nome deve avere da 3 a 80 caratteri'],
        [{ ...REAL, realName: 'Maria B4' }, 'Il nome può contenere solo lettere, spazi, apostrofi, trattini e punti'],
        [{ ...REAL, qualification: 'giudice' }, 'La qualifica non è valida'],
        [{ ...REAL, materie: ['DIRITTO_TRIBUTARIO'] }, 'La materia non è valida'],
        [{ ...PSEUDO, pseudonym: 'ci' }, 'Lo pseudonimo deve avere da 3 a 30 caratteri'],
        [{ ...PSEUDO, pseudonym: 'civil ista' }, 'Lo pseudonimo può contenere solo lettere, cifre, punti, trattini e trattini bassi'],
        // A letter of another alphabet that looks like a Latin one (a Cyrillic «а»): no lookalike names.
        [{ ...PSEUDO, pseudonym: 'civilistа42' }, 'Lo pseudonimo può contenere solo lettere, cifre, punti, trattini e trattini bassi'],
        [{ ...REAL, realName: 'Mаria Bianchi' }, 'Il nome può contenere solo lettere, spazi, apostrofi, trattini e punti'],
        // Counted in characters, as the database counts them.
        [{ ...PSEUDO, pseudonym: 'é'.normalize('NFD') + 'b' }, 'Lo pseudonimo deve avere da 3 a 30 caratteri'],
        [{ identity: 'both', realName: 'Maria Bianchi', qualification: 'avvocato' }, 'Scegli il nome vero o uno pseudonimo'],
      ] as const) {
        const res = await put(alice, body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(res.body.detail).toBe(detail);
      }
    });

    it('keeps a pseudonym one person’s, against pseudonyms and usernames, without regard to case', async () => {
      expect((await put(alice, PSEUDO)).status).toBe(200);
      const taken = await put(bob, { ...PSEUDO, pseudonym: 'CIVILISTA42' });
      expect(taken.status).toBe(409);
      expect(taken.body.detail).toBe('Questo pseudonimo è già usato');
      expect((await put(bob, { ...PSEUDO, pseudonym: carla.username.toUpperCase() })).status).toBe(409);
      // One's own username would name the person: the Forum's published dossiers show it.
      const ownName = await put(bob, { ...PSEUDO, pseudonym: bob.username.toUpperCase() });
      expect(ownName.status).toBe(400);
      expect(ownName.body.detail).toBe('Lo pseudonimo non può essere il tuo nome utente: lo mostrano i dossier che pubblichi');
      // `_` is a letter of the pseudonym, never a wildcard.
      await createTestUser('axb');
      expect((await put(bob, { ...PSEUDO, pseudonym: 'a_b' })).status).toBe(200);
      for (const reserved of ['utente_cancellato', 'Moderatore', 'admin', 'visualex', 'LexCraft', 'lingolex', 'MERL-T']) {
        const res = await put(carla, { ...PSEUDO, pseudonym: reserved });
        expect(res.status, reserved).toBe(400);
        expect(res.body.detail).toBe('Questo pseudonimo è riservato');
      }
    });

    it('takes a pseudonym only when nothing stands under another name, with a new public id', async () => {
      const threadId = await glossa(carla);
      const replyId = await reply(bob, threadId, 'Risposta di Bob con il suo username');
      const refused = await put(bob, PSEUDO);
      expect(refused.status).toBe(409);
      expect(refused.body.detail).toBe('Hai contributi pubblicati con un altro nome: cancellali prima di usare uno pseudonimo');
      // Hidden still stands under his name: the author and the moderators read it.
      await prisma.articleComment.update({ where: { id: replyId }, data: { isHidden: true, hiddenReason: 'spam' } });
      expect((await put(bob, PSEUDO)).status).toBe(409);
      expect((await mine(bob)).body.contributions).toEqual({ glosse: 0, risposte: 1 });
      // Deleted (nothing hangs on it): free to take one.
      await prisma.articleComment.update({ where: { id: replyId }, data: { isHidden: false, hiddenReason: null } });
      expect((await request(app).delete(`/api/article-discussion-comments/${replyId}`).set(as(bob))).body).toEqual({ outcome: 'deleted' });
      expect((await put(bob, PSEUDO)).status).toBe(200);

      // From the real name to a pseudonym: refused while a glossa is signed, then a new id.
      const signed = await put(alice, REAL);
      const aliceGlossa = await glossa(alice);
      expect((await put(alice, { ...PSEUDO, pseudonym: 'penalista7' })).status).toBe(409);
      await reply(carla, aliceGlossa, 'Risposta di Carla');
      expect((await request(app).delete(`/api/article-discussions/${aliceGlossa}`).set(as(alice))).body).toEqual({ outcome: 'emptied' });
      const moved = await put(alice, { ...PSEUDO, pseudonym: 'penalista7' });
      expect(moved.status).toBe(200);
      expect(moved.body.profile.id).not.toBe(signed.body.profile.id);
      expect((await publicOf(carla, signed.body.profile.id)).status).toBe(404);
      // Another pseudonym, then the real name: the same id, a revelation the person chooses.
      const again = await put(alice, { ...PSEUDO, pseudonym: 'penalista8' });
      expect(again.body.profile.id).toBe(moved.body.profile.id);
      await reply(alice, threadId, 'Risposta sotto pseudonimo');
      const revealed = await put(alice, REAL);
      expect(revealed.body.profile.id).toBe(moved.body.profile.id);
      const page = await request(app).get(`/api/article-discussions/${threadId}`).set(as(carla));
      expect(page.body.replies.find((r: { body: string }) => r.body === 'Risposta sotto pseudonimo').user)
        .toMatchObject({ id: moved.body.profile.id, name: 'Maria Bianchi', identity: 'real_name' });
    });

    it('keeps a pseudonym one person’s in the database too, without regard to case', async () => {
      await prisma.forumProfile.create({ data: { userId: alice.id, identity: 'pseudonym', pseudonym: 'Civilista42', qualification: 'altro' } });
      await expect(prisma.forumProfile.create({ data: { userId: bob.id, identity: 'pseudonym', pseudonym: 'civilista42', qualification: 'altro' } })).rejects.toThrow();
      await expect(prisma.forumProfile.create({ data: { userId: bob.id, identity: 'real_name', realName: 'Bob', pseudonym: 'altro_nome', qualification: 'altro' } })).rejects.toThrow();
      // A withdrawn name always says why.
      await expect(prisma.forumProfile.update({ where: { userId: alice.id }, data: { nameWithdrawnAt: new Date() } })).rejects.toThrow();
    });
  });

  describe('writing, and the switch', () => {
    it('with the switch off: no profile needed, but a pseudonym never signs a glossa', async () => {
      const threadId = await glossa(alice);
      await reply(bob, threadId);
      expect((await put(carla, PSEUDO)).status).toBe(200);
      const refused = await writeGlossa(carla);
      expect(refused.status).toBe(403);
      expect(refused.body).toEqual({ detail: 'Per firmare una glossa serve il profilo con il nome vero', error: 'real_name_required' });
      await reply(carla, threadId, 'Sotto pseudonimo si discute');
      expect((await mine(carla)).body).toMatchObject({ required: false, canWrite: true, canSign: false });
    });

    it('with the switch on: a profile to write, the real name to sign', async () => {
      await switchIdentity(true);
      expect((await writeGlossa(owner)).status).toBe(403);
      expect((await writeGlossa(alice)).body).toEqual({ detail: 'Per firmare una glossa serve il profilo con il nome vero', error: 'real_name_required' });
      expect((await mine(alice)).body).toMatchObject({ required: true, canWrite: false, canSign: false });

      await put(alice, REAL);
      const threadId = await glossa(alice);
      expect((await writeReply(bob, threadId)).body).toEqual({ detail: 'Per scrivere nel Forum completa il profilo: nome o pseudonimo e qualifica', error: 'profile_required' });
      await put(bob, PSEUDO);
      await reply(bob, threadId);
      expect((await writeGlossa(bob)).status).toBe(403);
      expect((await mine(bob)).body).toMatchObject({ required: true, canWrite: true, canSign: false });
      // Voting and reporting need no profile.
      expect((await request(app).put(`/api/article-discussions/${threadId}/vote`).set(as(carla)).send({ value: 1 })).status).toBe(200);
      expect((await request(app).post(`/api/article-discussions/${threadId}/report`).set(as(carla)).send({ reason: 'spam' })).status).toBe(204);
    });
  });

  describe('what others see', () => {
    it('shows a public profile with its name, qualification, subjects and score, nothing else', async () => {
      const created = await put(alice, REAL);
      const threadId = await glossa(alice);
      await request(app).put(`/api/article-discussions/${threadId}/vote`).set(as(bob)).send({ value: 1 });
      const res = await publicOf(bob, created.body.profile.id);
      expect(res.body).toEqual({
        id: created.body.profile.id, name: 'Maria Bianchi', identity: 'real_name', qualification: 'avvocato',
        materie: ['DIRITTO_CIVILE'], score: 1, roles: [], validatedCount: 0,
      });
      expect(JSON.stringify(res.body)).not.toContain(alice.email);
      expect(JSON.stringify(res.body)).not.toContain(alice.username);
      expect(JSON.stringify(res.body)).not.toContain(alice.id);
      const missing = await publicOf(bob, '00000000-0000-4000-8000-000000000000');
      expect(missing.status).toBe(404);
      expect(missing.body.detail).toBe('Profilo non trovato');
    });

    it('names every author by the profile in the feed, a glossa’s page and the reader’s lists', async () => {
      const real = await put(alice, REAL);
      const pseudo = await put(bob, PSEUDO);
      const threadId = await glossa(alice);
      const replyId = await reply(bob, threadId, 'Risposta di Bob');
      await reply(carla, threadId, 'Commento di Carla', replyId);
      const aliceView = { id: real.body.profile.id, name: 'Maria Bianchi', identity: 'real_name', qualification: 'avvocato', score: 0, username: 'Maria Bianchi' };
      const bobView = { id: pseudo.body.profile.id, name: 'civilista42', identity: 'pseudonym', qualification: 'praticante', score: 0, username: 'civilista42' };
      const carlaView = { id: null, name: carla.username, identity: 'username', qualification: null, score: 0, username: carla.username };

      const feed = await request(app).get('/api/article-discussions/feed').set(as(carla));
      expect(feed.body.data[0].user).toEqual(aliceView);
      const page = await request(app).get(`/api/article-discussions/${threadId}`).set(as(carla));
      expect(page.body.user).toEqual(aliceView);
      expect(page.body.replies[0].user).toEqual(bobView);
      expect(page.body.replies[0].comments[0].user).toEqual(carlaView);
      const list = await request(app).get('/api/article-discussions').set(as(carla)).query(ARTICLE);
      expect(list.body.data[0].user).toEqual(aliceView);
      expect(list.body.data[0].comments.map((c: { user: unknown }) => c.user)).toEqual([bobView, carlaView]);
      expect(JSON.stringify(page.body)).not.toContain(bob.id);
    });
  });

  it('names the author by the profile in the moderators’ queue, beside the account’s username', async () => {
    await put(alice, REAL);
    const threadId = await glossa(alice);
    await request(app).post(`/api/article-discussions/${threadId}/report`).set(as(bob)).send({ reason: 'spam' });
    const queue = await request(app).get('/api/moderation/reports').set(as(owner));
    expect(queue.body.data[0].item).toMatchObject({ author: alice.username, authorName: 'Maria Bianchi' });
  });

  describe('«non è chi dice di essere»', () => {
    it('goes to the owners alone, who may withdraw the name everywhere and give it back', async () => {
      const real = await put(alice, REAL);
      const profileId = real.body.profile.id as string;
      const threadId = await glossa(alice);
      const report = (user: TestUser, details?: string) =>
        request(app).post(`/api/forum/profiles/${profileId}/report`).set(as(user)).send(details === undefined ? {} : { details });

      expect((await report(alice)).status).toBe(400);
      expect((await request(app).post('/api/forum/profiles/00000000-0000-4000-8000-000000000000/report').set(as(bob)).send({})).status).toBe(404);
      expect((await report(bob, 'Non è un avvocato iscritto')).status).toBe(204);
      expect((await report(bob, 'Lo conosco: si chiama in un altro modo')).status).toBe(204);
      expect((await report(carla)).status).toBe(204);
      expect(await prisma.forumProfileReport.count({ where: { profileId, status: 'pending' } })).toBe(2);

      expect((await request(app).get('/api/moderation/profile-reports').set(as(bob))).status).toBe(403);
      const queue = await request(app).get('/api/moderation/profile-reports').set(as(owner));
      expect(queue.body.data).toHaveLength(1);
      expect(queue.body.data[0]).toMatchObject({
        profileId, deleted: false, count: 2,
        profile: { name: 'Maria Bianchi', identity: 'real_name', qualification: 'avvocato', withdrawn: false },
        account: { username: alice.username, email: alice.email },
      });
      expect(queue.body.data[0].reports.map((r: { details: string | null }) => r.details).sort())
        .toEqual([null, 'Lo conosco: si chiama in un altro modo'].sort());
      expect(JSON.stringify(queue.body)).not.toContain(bob.username);

      const resolve = (user: TestUser, body: unknown) =>
        request(app).post(`/api/moderation/profile-reports/${profileId}/resolve`).set(as(user)).send(body);
      expect((await resolve(bob, { action: 'confirm', reason: 'Verificato' })).status).toBe(403);
      expect((await resolve(owner, { action: 'confirm', reason: 'no' })).status).toBe(400);
      expect((await resolve(owner, { action: 'confirm', reason: 'Non risulta iscritto all’albo' })).body).toEqual({ closed: 2, status: 'confirmed' });

      const withdrawnView = { id: profileId, name: 'nome ritirato', identity: 'withdrawn', qualification: null, score: 0, username: 'nome ritirato' };
      expect((await request(app).get(`/api/article-discussions/${threadId}`).set(as(bob))).body.user).toEqual(withdrawnView);
      expect((await request(app).get('/api/article-discussions/feed').set(as(bob))).body.data[0].user).toEqual(withdrawnView);
      expect((await request(app).get('/api/article-discussions').set(as(bob)).query(ARTICLE)).body.data[0].user).toEqual(withdrawnView);
      expect((await publicOf(bob, profileId)).body).toMatchObject({ name: 'nome ritirato', identity: 'withdrawn', qualification: null });
      const own = await mine(alice);
      expect(own.body).toMatchObject({ canWrite: false, canSign: false, nameWithdrawn: { at: expect.any(String), reason: 'Non risulta iscritto all’albo' } });
      const blocked = { detail: 'Il nome del tuo profilo è stato ritirato dai responsabili del Forum', error: 'name_withdrawn' };
      expect((await writeReply(alice, threadId)).body).toEqual(blocked);
      expect((await writeGlossa(alice)).body).toEqual(blocked);
      expect((await put(alice, { ...REAL, realName: 'Maria Verdi' })).body).toEqual(blocked);
      expect((await request(app).patch(`/api/article-discussions/${threadId}`).set(as(alice)).send({ body: 'Testo cambiato' })).body).toEqual(blocked);
      // Withdrawn already: a second confirmation closes the reports and logs nothing new.
      await report(carla, 'Ancora');
      expect((await resolve(owner, { action: 'confirm', reason: 'Di nuovo' })).body).toEqual({ closed: 1, status: 'confirmed' });
      expect(await prisma.forumModerationLog.count({ where: { action: 'withdraw_name', targetKind: 'profile', targetId: profileId } })).toBe(1);
      expect((await resolve(owner, { action: 'dismiss', reason: 'Nessuna segnalazione aperta' })).status).toBe(404);

      const restore = await request(app).post(`/api/moderation/profile-reports/${profileId}/restore`).set(as(owner)).send({ reason: 'Ha mostrato il tesserino' });
      expect(restore.body).toEqual({ withdrawn: false });
      expect((await mine(alice)).body).toMatchObject({ canWrite: true, canSign: true, nameWithdrawn: null });
      expect((await request(app).post(`/api/moderation/profile-reports/${profileId}/restore`).set(as(owner)).send({ reason: 'Di nuovo' })).status).toBe(409);
      expect(await prisma.forumModerationLog.count({ where: { action: 'restore_name', targetId: profileId } })).toBe(1);
    });

    it('closes the reports as dismissed, on the record', async () => {
      const real = await put(alice, REAL);
      const profileId = real.body.profile.id as string;
      await request(app).post(`/api/forum/profiles/${profileId}/report`).set(as(bob)).send({});
      const res = await request(app).post(`/api/moderation/profile-reports/${profileId}/resolve`).set(as(owner)).send({ action: 'dismiss', reason: 'Nome verificato' });
      expect(res.body).toEqual({ closed: 1, status: 'dismissed' });
      expect((await mine(alice)).body.nameWithdrawn).toBeNull();
      expect((await request(app).get('/api/moderation/profile-reports').set(as(owner)).query({ status: 'dismissed' })).body.data).toHaveLength(1);
      expect(await prisma.forumModerationLog.count({ where: { action: 'dismiss', targetKind: 'report', targetId: `profile:${profileId}` } })).toBe(1);
    });
  });

  it('erases the details of a report closed more than 90 days ago, and keeps the record', async () => {
    const real = await put(alice, REAL);
    const day = 24 * 60 * 60 * 1000;
    const now = new Date();
    await prisma.forumProfileReport.createMany({ data: [
      { profileId: real.body.profile.id, userId: bob.id, details: 'Vecchia', status: 'dismissed', resolvedAt: new Date(now.getTime() - 91 * day), resolvedById: owner.id, resolutionNote: 'Verificato' },
      { profileId: real.body.profile.id, userId: carla.id, details: 'Recente', status: 'dismissed', resolvedAt: new Date(now.getTime() - 10 * day), resolvedById: owner.id, resolutionNote: 'Verificato' },
    ] });
    expect((await sweepCommunity(now)).profileReportDetails).toBe(1);
    const rows = await prisma.forumProfileReport.findMany({ orderBy: { resolvedAt: 'asc' } });
    expect(rows.map((row) => row.details)).toEqual([null, 'Recente']);
  });

  describe('the account', () => {
    it('takes the profile with it, and the export carries it with the reports the person made', async () => {
      const real = await put(alice, REAL);
      await put(bob, PSEUDO);
      await request(app).post(`/api/forum/profiles/${real.body.profile.id}/report`).set(as(bob)).send({ details: 'Dubbio' });
      const exported = await request(app).get('/api/auth/export').set(as(bob));
      expect(exported.body.data.forumProfile).toMatchObject({ identity: 'pseudonym', pseudonym: 'civilista42', qualification: 'praticante', materie: [] });
      expect(exported.body.data.forumProfileReports).toEqual([{ profileId: real.body.profile.id, details: 'Dubbio', status: 'pending', createdAt: expect.any(String) }]);

      const deleted = await request(app).delete('/api/auth/account').set(as(alice)).send({ password: 'test-password', confirmation: 'ELIMINA ACCOUNT' });
      expect(deleted.status).toBe(204);
      expect(await prisma.forumProfile.count({ where: { userId: alice.id } })).toBe(0);
      expect((await publicOf(bob, real.body.profile.id)).status).toBe(404);
    });
  });
});
