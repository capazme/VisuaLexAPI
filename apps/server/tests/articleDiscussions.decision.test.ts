import { describe, expect, it, beforeEach } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from './helpers';

const KEY = 'cassazione:civile:99999:2024';
const PASSAGE = { quote: 'principio di diritto', start: 120, prefix: 'enuncia il ', suffix: ' secondo cui' };
const HASH = 'b'.repeat(64);

describe('discussions anchored on a court decision', () => {
  let alice: TestUser;
  let bob: TestUser;
  let admin: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('decision-alice');
    bob = await createTestUser('decision-bob');
    admin = await createTestUser('decision-admin');
    await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: true } });
  });

  const open = (user: TestUser, extra: Record<string, unknown> = {}) =>
    request(app).post('/api/article-discussions').set(authHeader(user)).send({
      normaKey: KEY, articleId: '', title: 'Sul principio di diritto', body: 'Una domanda sulla massima.', ...extra,
    });

  it('creates, lists, comments, votes and reports a thread on a decision', async () => {
    const created = await open(alice);
    expect(created.status).toBe(201);
    expect(created.body.target).toEqual({ kind: 'decision', key: KEY });
    expect(created.body.passageReleased).toBe(false);
    expect(created.body.normaKey).toBe(KEY);
    expect(created.body.articleId).toBe('');

    const row = await prisma.articleThread.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row).toMatchObject({ targetKind: 'decision', decisionKey: KEY, normaKey: KEY, articleId: '', version: null, articleUrn: null });

    const listed = await request(app).get('/api/article-discussions').set(authHeader(bob)).query({ normaKey: KEY, articleId: '' });
    expect(listed.status).toBe(200);
    expect(listed.body.data.map((t: { id: string }) => t.id)).toEqual([created.body.id]);
    const withoutArticleId = await request(app).get('/api/article-discussions').set(authHeader(bob)).query({ normaKey: KEY });
    expect(withoutArticleId.body.data).toHaveLength(1);

    const comment = await request(app).post(`/api/article-discussions/${created.body.id}/comments`).set(authHeader(bob)).send({ body: 'Concordo.' });
    expect(comment.status).toBe(201);
    const vote = await request(app).post(`/api/article-discussions/${created.body.id}/vote`).set(authHeader(bob));
    expect(vote.body).toMatchObject({ voted: true, voteCount: 1 });
    const report = await request(app).post(`/api/article-discussions/${created.body.id}/report`).set(authHeader(bob)).send({ reason: 'spam' });
    expect(report.status).toBe(204);

    const hidden = await request(app).patch(`/api/admin/article-discussions/${created.body.id}`).set(authHeader(admin)).send({ hidden: true });
    expect(hidden.status).toBe(200);
    expect(hidden.body.isHidden).toBe(true);
    const after = await request(app).get('/api/article-discussions').set(authHeader(bob)).query({ normaKey: KEY, articleId: '' });
    expect(after.body.data).toHaveLength(0);
  });

  it('lists the passages of a decision with the stored quotation', async () => {
    const created = await open(alice, { title: undefined, passage: PASSAGE, textHash: HASH });
    expect(created.status).toBe(201);
    expect(created.body.passage).toEqual(PASSAGE);
    expect(created.body.textHash).toBe(HASH);
    const passages = await request(app).get('/api/article-discussions/passages').set(authHeader(bob)).query({ normaKey: KEY, articleId: '' });
    expect(passages.status).toBe(200);
    expect(passages.body.data).toHaveLength(1);
    expect(passages.body.data[0].passage).toEqual(PASSAGE);
  });

  it('keeps a norm thread an article thread with no decision key', async () => {
    const created = await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
      normaKey: 'codice-civile--art-2043', articleId: '2043', title: 'Una domanda', body: 'Sul testo.',
    });
    expect(created.status).toBe(201);
    expect(created.body.target).toEqual({ kind: 'article' });
    const row = await prisma.articleThread.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row).toMatchObject({ targetKind: 'article', decisionKey: null });
  });

  it('never mixes a decision thread into an article list, nor the reverse', async () => {
    await open(alice);
    await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
      normaKey: 'codice-civile--art-2043', articleId: '2043', title: 'Una domanda', body: 'Sul testo.',
    });
    const articles = await request(app).get('/api/article-discussions').set(authHeader(bob)).query({ normaKey: 'codice-civile--art-2043', articleId: '2043' });
    expect(articles.body.data.every((t: { target: { kind: string } }) => t.target.kind === 'article')).toBe(true);
    expect(articles.body.data).toHaveLength(1);
    const decisions = await request(app).get('/api/article-discussions').set(authHeader(bob)).query({ normaKey: KEY, articleId: '' });
    expect(decisions.body.data.every((t: { target: { kind: string } }) => t.target.kind === 'decision')).toBe(true);
    expect(decisions.body.data).toHaveLength(1);
    const wrong = await request(app).get('/api/article-discussions').set(authHeader(bob)).query({ normaKey: KEY, articleId: '2043' });
    expect(wrong.status).toBe(400);
  });

  it('refuses a malformed key, a bad court shape, a future year, a version, an URN or an article id', async () => {
    const nextYear = new Date().getFullYear() + 1;
    for (const normaKey of [
      'cassazione:civile:007:2024',
      `cassazione:civile:99999:${nextYear}`,
      'corte_costituzionale:civile:1:2020',
      'cassazione:99999:2024',
    ]) {
      const res = await open(alice, { normaKey });
      expect(res.status, normaKey).toBe(400);
      expect(res.body.detail).toContain('La chiave della decisione non è valida');
    }
    for (const [extra, detail] of [
      [{ version: 'vigente' }, 'non ha una versione'],
      [{ articleUrn: 'urn:nir:stato:legge:1990-08-07;241' }, 'non ha un URN'],
      [{ articleId: '12' }, 'non ha un articolo'],
    ] as const) {
      const res = await open(alice, extra);
      expect(res.status).toBe(400);
      expect(res.body.detail).toContain(detail);
    }
    expect(await prisma.articleThread.count({ where: { userId: alice.id } })).toBe(0);
  });

  it('takes the optional target only when it agrees with the key', async () => {
    expect((await open(alice, { target: { kind: 'decision', key: KEY } })).status).toBe(201);
    expect((await open(alice, { target: { kind: 'article' } })).status).toBe(400);
    expect((await open(alice, { target: { kind: 'decision', key: 'cassazione:civile:99998:2024' } })).status).toBe(400);
    const norm = await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
      normaKey: 'codice-civile--art-2043', articleId: '2043', title: 'Una domanda', body: 'Sul testo.', target: { kind: 'decision', key: KEY },
    });
    expect(norm.status).toBe(400);
  });

  it('answers the target and moderation 400s in Italian', async () => {
    const bad = await open(alice, { target: { kind: 'case' } });
    expect(bad.status).toBe(400);
    expect(bad.body.detail).toContain('La destinazione deve essere');
    const keyed = await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
      normaKey: 'codice-civile--art-2043', articleId: '2043', title: 'Una domanda', body: 'Sul testo.', target: { kind: 'article', key: 'x' },
    });
    expect(keyed.status).toBe(400);
    expect(keyed.body.detail).toBe('Una destinazione articolo non ha una chiave');

    const created = await open(alice);
    const url = `/api/admin/article-discussions/${created.body.id}`;
    const empty = await request(app).patch(url).set(authHeader(admin)).send({});
    expect(empty.body.detail).toBe('Nessuna modifica richiesta');
    const notBool = await request(app).patch(url).set(authHeader(admin)).send({ passageReleased: 'yes' });
    expect(notBool.status).toBe(400);
    expect(notBool.body.detail).toContain('vero o falso');
    expect((await request(app).patch(url).set(authHeader(admin)).send({ hidden: 'yes' })).body.detail).toContain('vero o falso');
  });

  it('answers the body, comment and report 400s in Italian', async () => {
    const short = await open(alice, { body: 'no' });
    expect(short.status).toBe(400);
    expect(short.body.detail).toBe('Il testo deve avere almeno 3 caratteri');
    const untitled = await open(alice, { title: undefined });
    expect(untitled.body.detail).toBe('Il titolo è obbligatorio (almeno 3 caratteri) per una discussione senza un passo citato');
    const badPassage = await open(alice, { title: undefined, passage: { ...PASSAGE, start: -1 } });
    expect(badPassage.body.detail).toBe('La posizione del passo non è valida');

    const created = await open(alice);
    const emptyComment = await request(app).post(`/api/article-discussions/${created.body.id}/comments`).set(authHeader(bob)).send({ body: ' ' });
    expect(emptyComment.status).toBe(400);
    expect(emptyComment.body.detail).toBe('Il testo è obbligatorio');
    const noReason = await request(app).post(`/api/article-discussions/${created.body.id}/report`).set(authHeader(bob)).send({});
    expect(noReason.status).toBe(400);
    expect(noReason.body.detail).toBe('Il motivo è obbligatorio');
  });

  describe('the table refuses what the controller would not write', () => {
    const insert = (cols: { kind: string; key: string | null; norma: string; article: string; version: string | null; urn: string | null }, userId: string) =>
      prisma.$executeRaw`INSERT INTO article_threads (id, norma_key, article_id, version, article_urn, target_kind, decision_key, title, body, user_id, created_at, updated_at)
        VALUES (gen_random_uuid()::text, ${cols.norma}, ${cols.article}, ${cols.version}, ${cols.urn}, ${cols.kind}, ${cols.key}, 't', 'b', ${userId}, now(), now())`;
    const good = { kind: 'decision', key: KEY, norma: KEY, article: '', version: null, urn: null };

    it('accepts the good shape', async () => {
      await expect(insert(good, alice.id)).resolves.toBe(1);
    });
    it('refuses an unknown target kind', async () => {
      await expect(insert({ ...good, kind: 'comment' }, alice.id)).rejects.toThrow(/target_kind_check/);
    });
    it.each([
      ['a decision without a key', { key: null }],
      ['a decision whose norma_key differs from its key', { norma: 'cassazione:civile:99998:2024' }],
      ['a decision with an article id', { article: '12' }],
      ['a decision with a version', { version: 'vigente' }],
      ['a decision with an URN', { urn: 'urn:x' }],
      ['an article with a decision key', { kind: 'article', article: '12', norma: 'norma-a', key: KEY }],
    ])('refuses %s', async (_label, patch) => {
      await expect(insert({ ...good, ...patch }, alice.id)).rejects.toThrow(/target_shape_check/);
    });
    it('accepts a release time with no author (the admin was deleted)', async () => {
      await expect(prisma.$executeRaw`INSERT INTO article_threads (id, norma_key, article_id, title, body, user_id, passage_released_at, created_at, updated_at)
        VALUES (gen_random_uuid()::text, 'n', '1', 't', 'b', ${alice.id}, now(), now(), now())`).resolves.toBe(1);
    });
    it('refuses a release author without a release time', async () => {
      await expect(prisma.$executeRaw`INSERT INTO article_threads (id, norma_key, article_id, title, body, user_id, passage_released_by, created_at, updated_at)
        VALUES (gen_random_uuid()::text, 'n', '1', 't', 'b', ${alice.id}, ${admin.id}, now(), now())`).rejects.toThrow(/passage_release_check/);
    });
  });

  describe('releasing a withdrawn quotation', () => {
    it('lets an admin set and clear it, and nobody else', async () => {
      const created = await open(alice, { title: undefined, passage: PASSAGE });
      const url = `/api/admin/article-discussions/${created.body.id}`;
      expect((await request(app).patch(url).set(authHeader(alice)).send({ passageReleased: true })).status).toBe(403);
      expect((await request(app).patch(url).set(authHeader(admin)).send({})).status).toBe(400);

      const set = await request(app).patch(url).set(authHeader(admin)).send({ passageReleased: true });
      expect(set.status).toBe(200);
      expect(set.body.passageReleased).toBe(true);
      const row = await prisma.articleThread.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(row.passageReleasedById).toBe(admin.id);
      expect(row.passageReleasedAt).not.toBeNull();
      const listed = await request(app).get('/api/article-discussions').set(authHeader(bob)).query({ normaKey: KEY, articleId: '' });
      expect(listed.body.data[0].passageReleased).toBe(true);

      const cleared = await request(app).patch(url).set(authHeader(admin)).send({ passageReleased: false });
      expect(cleared.body.passageReleased).toBe(false);
      const after = await prisma.articleThread.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(after).toMatchObject({ passageReleasedById: null, passageReleasedAt: null });
    });

    it('answers 404 for a thread that does not exist', async () => {
      const res = await request(app).patch('/api/admin/article-discussions/no-such-thread').set(authHeader(admin)).send({ passageReleased: true });
      expect(res.status).toBe(404);
    });

    it('refuses the release of an article thread and leaves hidden unchanged', async () => {
      const article = await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
        normaKey: 'norma-a', articleId: '1', body: 'Sul passo.', passage: PASSAGE,
      });
      const res = await request(app).patch(`/api/admin/article-discussions/${article.body.id}`).set(authHeader(admin)).send({ hidden: true, passageReleased: true });
      expect(res.status).toBe(400);
      expect(res.body.detail).toContain('rimesso in chiaro');
      expect((await prisma.articleThread.findUniqueOrThrow({ where: { id: article.body.id } })).isHidden).toBe(false);
    });

    it('refuses a thread that is not a decision passage', async () => {
      const wholeDecision = await open(alice);
      expect((await request(app).patch(`/api/admin/article-discussions/${wholeDecision.body.id}`).set(authHeader(admin)).send({ passageReleased: true })).status).toBe(400);
      const article = await request(app).post('/api/article-discussions').set(authHeader(alice)).send({
        normaKey: 'norma-a', articleId: '1', body: 'Sul passo.', passage: PASSAGE,
      });
      expect((await request(app).patch(`/api/admin/article-discussions/${article.body.id}`).set(authHeader(admin)).send({ passageReleased: true })).status).toBe(400);
    });
  });

  describe('the account', () => {
    it('exports the thread with its target', async () => {
      const created = await open(alice);
      const exported = await request(app).get('/api/auth/export').set(authHeader(alice));
      expect(exported.status).toBe(200);
      const thread = exported.body.data.threads.find((t: { id: string }) => t.id === created.body.id);
      expect(thread).toMatchObject({ targetKind: 'decision', decisionKey: KEY, normaKey: KEY });
    });

    it('removes the thread with the account', async () => {
      const created = await open(alice);
      const res = await request(app).delete('/api/auth/account').set(authHeader(alice)).send({ password: 'test-password', confirmation: 'ELIMINA ACCOUNT' });
      expect(res.status).toBe(204);
      expect(await prisma.articleThread.count({ where: { id: created.body.id } })).toBe(0);
    });

    it("leaves passage_released_by null when the releasing admin is deleted", async () => {
      const releaser = await createTestUser('decision-releaser');
      await prisma.user.update({ where: { id: releaser.id }, data: { isAdmin: true } });
      const created = await open(alice, { title: undefined, passage: PASSAGE });
      await request(app).patch(`/api/admin/article-discussions/${created.body.id}`).set(authHeader(releaser)).send({ passageReleased: true });
      const res = await request(app).delete(`/api/admin/users/${releaser.id}`).set(authHeader(admin));
      expect(res.status).toBe(204);
      const row = await prisma.articleThread.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(row.passageReleasedById).toBeNull();
      expect(row.passageReleasedAt).not.toBeNull();
    });
  });
});
