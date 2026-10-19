import { describe, expect, it, beforeEach } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from './helpers';

const DECISION = 'cassazione:civile:31310:2024';
const URN = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043';

describe('the Forum feed of glosse', () => {
  let alice: TestUser;
  let bob: TestUser;
  let admin: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('feed-alice');
    bob = await createTestUser('feed-bob');
    admin = await createTestUser('feed-admin');
    await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: true } });
  });

  let minute = 0;
  /** A thread written straight to the table, one minute after the previous, so the orders are certain. */
  const seed = (user: TestUser, data: Record<string, unknown> = {}) => {
    minute += 1;
    const at = new Date(Date.UTC(2026, 9, 1, 8, minute));
    return prisma.articleThread.create({
      data: {
        normaKey: 'codice-civile--2043', articleId: '2043', articleLabel: '2043', title: 'Una glossa', body: 'Il testo della glossa.',
        userId: user.id, createdAt: at, updatedAt: at, ...data,
      },
    });
  };
  const decisionThread = (user: TestUser, data: Record<string, unknown> = {}) =>
    seed(user, { targetKind: 'decision', decisionKey: DECISION, normaKey: DECISION, articleId: '', articleLabel: null, ...data });
  const feed = (user: TestUser, query: Record<string, unknown> = {}) =>
    request(app).get('/api/article-discussions/feed').set(authHeader(user)).query(query);
  const ids = (res: { body: { data: { id: string }[] } }) => res.body.data.map((t) => t.id);

  it('lists the glosse of every article and decision, newest first, without the hidden ones', async () => {
    const article = await seed(alice, { articleUrn: URN, version: 'vigente' });
    const decision = await decisionThread(bob);
    await seed(alice, { isHidden: true });
    const other = await seed(bob, { normaKey: 'legge--241--1990-08-07--2', articleId: '2', articleLabel: '2' });

    const res = await feed(bob);
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([other.id, decision.id, article.id]);
    expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 3, pages: 1 });

    const item = res.body.data.find((t: { id: string }) => t.id === article.id);
    expect(item).toMatchObject({
      title: 'Una glossa', excerpt: 'Il testo della glossa.', normaKey: 'codice-civile--2043', articleId: '2043',
      articleLabel: '2043', version: 'vigente', articleUrn: URN, target: { kind: 'article' }, decisionLabel: null,
      passage: null, user: { id: alice.id, username: alice.username }, voteCount: 0, userVoted: false, commentCount: 0,
      isOwner: false,
    });
    expect(item.lastActivityAt).toBe(item.createdAt);
    expect(item).not.toHaveProperty('body');
    expect(item).not.toHaveProperty('comments');

    const onDecision = res.body.data.find((t: { id: string }) => t.id === decision.id);
    expect(onDecision.target).toEqual({ kind: 'decision', key: DECISION });
    expect(onDecision.decisionLabel).toBe('Cass. civ., n. 31310/2024');
    expect(onDecision.isOwner).toBe(true);
  });

  it('counts votes and visible replies, and says whether the reader voted', async () => {
    const thread = await seed(alice);
    await prisma.articleThreadVote.createMany({ data: [{ threadId: thread.id, userId: bob.id }, { threadId: thread.id, userId: admin.id }] });
    await prisma.articleComment.createMany({
      data: [
        { threadId: thread.id, userId: bob.id, body: 'Una risposta.' },
        { threadId: thread.id, userId: bob.id, body: 'Rimossa.', isHidden: true },
      ],
    });
    const [item] = (await feed(bob)).body.data;
    expect(item).toMatchObject({ voteCount: 2, userVoted: true, commentCount: 1 });
    expect((await feed(alice)).body.data[0].userVoted).toBe(false);
  });

  it('cuts a long body into an excerpt at a word', async () => {
    const body = `${'parola '.repeat(60)}fine`;
    await seed(alice, { body });
    const [item] = (await feed(bob)).body.data;
    expect(item.excerpt.length).toBeLessThanOrEqual(281);
    expect(item.excerpt.endsWith('parola…')).toBe(true);
  });

  it('sorts by votes, by last activity and keeps only the unanswered', async () => {
    const quiet = await seed(alice);
    const voted = await seed(alice);
    const answered = await seed(bob);
    const hiddenReply = await seed(bob);
    await prisma.articleThreadVote.createMany({ data: [{ threadId: voted.id, userId: bob.id }, { threadId: voted.id, userId: admin.id }] });
    await prisma.articleThreadVote.create({ data: { threadId: answered.id, userId: alice.id } });
    await prisma.articleComment.create({ data: { threadId: hiddenReply.id, userId: alice.id, body: 'Rimossa.', isHidden: true } });

    // a reply through the route is activity: the oldest thread becomes the most active
    const reply = await request(app).post(`/api/article-discussions/${quiet.id}/comments`).set(authHeader(bob)).send({ body: 'Rispondo.' });
    expect(reply.status).toBe(201);
    await prisma.articleComment.create({ data: { threadId: answered.id, userId: alice.id, body: 'Anche qui.' } });

    expect(ids(await feed(bob, { sort: 'popular' }))).toEqual([voted.id, answered.id, hiddenReply.id, quiet.id]);
    expect(ids(await feed(bob, { sort: 'active' }))[0]).toBe(quiet.id);
    const unanswered = await feed(bob, { sort: 'unanswered' });
    expect(ids(unanswered)).toEqual([hiddenReply.id, voted.id]);
    expect(unanswered.body.pagination.total).toBe(2);
  });

  it('filters by kind, by act and by one article or decision', async () => {
    const art2043 = await seed(alice);
    const art2059 = await seed(alice, { normaKey: 'codice-civile--2059', articleId: '2059' });
    const law241 = await seed(alice, { normaKey: 'legge--241--1990-08-07--2', articleId: '2' });
    const law24 = await seed(alice, { normaKey: 'legge--24--2017-03-08--1', articleId: '1' });
    const decision = await decisionThread(alice);

    expect(ids(await feed(bob, { kind: 'decision' }))).toEqual([decision.id]);
    expect(ids(await feed(bob, { kind: 'article' }))).toEqual([law24.id, law241.id, art2059.id, art2043.id]);
    expect(ids(await feed(bob, { act: 'codice-civile' }))).toEqual([art2059.id, art2043.id]);
    expect(ids(await feed(bob, { act: 'legge--24--2017-03-08' }))).toEqual([law24.id]);
    expect(ids(await feed(bob, { act: 'legge--241--1990-08-07' }))).toEqual([law241.id]);
    expect(ids(await feed(bob, { act: 'legge--2' }))).toEqual([]);
    expect(ids(await feed(bob, { normaKey: 'codice-civile--2043' }))).toEqual([art2043.id]);
    expect(ids(await feed(bob, { normaKey: DECISION }))).toEqual([decision.id]);
  });

  it('reads an underscore in an act as itself, not as any character', async () => {
    const mine = await seed(alice, { normaKey: 'regolamento_ue--2016--679--5', articleId: '5' });
    await seed(alice, { normaKey: 'regolamentoxue--2016--679--5', articleId: '5' });
    expect(ids(await feed(bob, { act: 'regolamento_ue--2016--679' }))).toEqual([mine.id]);
  });

  it('filters by court, by a court’s archive or seat, and never reads a longer court name', async () => {
    const civil = await decisionThread(alice);
    const penal = await decisionThread(alice, { decisionKey: 'cassazione:penale:1200:2023', normaKey: 'cassazione:penale:1200:2023' });
    const constitutional = await decisionThread(alice, { decisionKey: 'corte_costituzionale:242:2019', normaKey: 'corte_costituzionale:242:2019' });
    const tarRome = await decisionThread(alice, { decisionKey: 'tar:roma:sent:1234:2024', normaKey: 'tar:roma:sent:1234:2024' });
    const tarLatina = await decisionThread(alice, { decisionKey: 'tar:latina:sent:55:2024', normaKey: 'tar:latina:sent:55:2024' });
    await seed(alice);

    expect(ids(await feed(bob, { court: 'cassazione' }))).toEqual([penal.id, civil.id]);
    expect(ids(await feed(bob, { court: 'cassazione:civile' }))).toEqual([civil.id]);
    expect(ids(await feed(bob, { court: 'corte_costituzionale', kind: 'decision' }))).toEqual([constitutional.id]);
    expect(ids(await feed(bob, { court: 'tar' }))).toEqual([tarLatina.id, tarRome.id]);
    expect(ids(await feed(bob, { court: 'tar:roma' }))).toEqual([tarRome.id]);
    expect(ids(await feed(bob, { court: 'tar:roma:sent' }))).toEqual([tarRome.id]);
    expect(ids(await feed(bob, { court: 'tar:rom' }))).toEqual([]);
    expect(ids(await feed(bob, { court: 'cgars' }))).toEqual([]);
  });

  it('reads an underscore in a court as itself, not as any character', async () => {
    const mine = await decisionThread(alice, { decisionKey: 'corte_costituzionale:242:2019', normaKey: 'corte_costituzionale:242:2019' });
    // not a key the routes accept, written straight to the table to show what an unescaped `_` would match
    await decisionThread(alice, { decisionKey: 'cortexcostituzionale:1:2019', normaKey: 'cortexcostituzionale:1:2019' });
    expect(ids(await feed(bob, { court: 'corte_costituzionale' }))).toEqual([mine.id]);
  });

  it('keeps the reader’s own glosse with «mine», whatever else is asked', async () => {
    const aliceArticle = await seed(alice);
    await seed(bob);
    const aliceDecision = await decisionThread(alice);
    await decisionThread(bob);

    const own = await feed(alice, { mine: 'true' });
    expect(ids(own)).toEqual([aliceDecision.id, aliceArticle.id]);
    expect(own.body.pagination.total).toBe(2);
    expect(own.body.data.every((t: { isOwner: boolean }) => t.isOwner)).toBe(true);
    expect(ids(await feed(alice, { mine: 'true', kind: 'article' }))).toEqual([aliceArticle.id]);
    expect(ids(await feed(alice, { mine: 'true', court: 'cassazione' }))).toEqual([aliceDecision.id]);
    expect(ids(await feed(alice, { mine: 'false' }))).toHaveLength(4);
    expect(ids(await feed(admin, { mine: 'true' }))).toEqual([]);
  });

  it('pages through the feed', async () => {
    const made = [];
    for (let i = 0; i < 5; i += 1) made.push(await seed(alice));
    const second = await feed(bob, { limit: 2, page: 2 });
    expect(ids(second)).toEqual([made[2].id, made[1].id]);
    expect(second.body.pagination).toEqual({ page: 2, limit: 2, total: 5, pages: 3 });
  });

  it('answers a malformed query with an Italian 400', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ sort: 'best' }, 'L’ordinamento deve essere «recent», «popular», «active» o «unanswered»'],
      [{ kind: 'note' }, 'Il tipo deve essere «article» o «decision»'],
      [{ act: 'Codice Civile' }, 'L’atto non è valido'],
      [{ act: 'codice-civile', normaKey: 'codice-civile--2043' }, 'Indica l’atto o la chiave, non entrambi'],
      [{ act: 'codice-civile', kind: 'decision' }, 'Un atto ha glosse sugli articoli, non sulle decisioni'],
      [{ page: 'abc' }, 'La pagina non è valida'],
      [{ limit: 51 }, 'Al massimo 50 risultati per pagina'],
      [{ court: 'Cassazione' }, 'La corte non è valida'],
      [{ court: 'consiglio' }, 'La corte non è valida'],
      [{ court: 'cassazione:civile:31310' }, 'La corte non è valida'],
      [{ court: 'cassazione:' }, 'La corte non è valida'],
      [{ court: 'cassazione', kind: 'article' }, 'Una corte ha glosse sulle decisioni, non sugli articoli'],
      [{ court: 'cassazione', act: 'codice-civile' }, 'Indica la corte, l’atto o la chiave: uno solo'],
      [{ court: 'cassazione', normaKey: DECISION }, 'Indica la corte, l’atto o la chiave: uno solo'],
      [{ mine: '1' }, '«mine» deve essere «true» o «false»'],
      [{ mine: 'TRUE' }, '«mine» deve essere «true» o «false»'],
    ];
    for (const [query, message] of cases) {
      const res = await feed(bob, query);
      expect(res.status, JSON.stringify(query)).toBe(400);
      expect(res.body.detail, JSON.stringify(query)).toContain(message);
    }
  });

  it('needs a login', async () => {
    expect((await request(app).get('/api/article-discussions/feed')).status).toBe(401);
  });

  it('withholds a decision’s quotation from other readers until an admin releases it', async () => {
    const passage = { passageQuote: 'principio di diritto', passageStart: 10, passagePrefix: '', passageSuffix: '' };
    const onDecision = await decisionThread(alice, passage);
    const onArticle = await seed(alice, passage);
    const find = async (user: TestUser, id: string) =>
      (await feed(user)).body.data.find((t: { id: string }) => t.id === id);

    expect((await find(bob, onArticle.id)).passage).toEqual({ quote: 'principio di diritto', withheld: false });
    expect((await find(bob, onDecision.id)).passage).toEqual({ quote: null, withheld: true });
    expect((await find(alice, onDecision.id)).passage).toEqual({ quote: 'principio di diritto', withheld: false });
    expect((await find(admin, onDecision.id)).passage).toEqual({ quote: 'principio di diritto', withheld: false });

    const released = await request(app).patch(`/api/admin/article-discussions/${onDecision.id}`).set(authHeader(admin)).send({ passageReleased: true });
    expect(released.status).toBe(200);
    expect((await find(bob, onDecision.id)).passage).toEqual({ quote: 'principio di diritto', withheld: false });
  });

  it('keeps the last activity when an admin moderates', async () => {
    const thread = await seed(alice);
    const before = (await prisma.articleThread.findUniqueOrThrow({ where: { id: thread.id } })).updatedAt;
    const res = await request(app).patch(`/api/admin/article-discussions/${thread.id}`).set(authHeader(admin)).send({ hidden: true });
    expect(res.status).toBe(200);
    expect((await prisma.articleThread.findUniqueOrThrow({ where: { id: thread.id } })).updatedAt).toEqual(before);
  });
});

describe('one glossa', () => {
  let alice: TestUser;
  let bob: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('glossa-alice');
    bob = await createTestUser('glossa-bob');
  });

  const get = (user: TestUser, id: string) => request(app).get(`/api/article-discussions/${id}`).set(authHeader(user));

  it('gives the thread with its visible replies and the feed’s fields', async () => {
    const thread = await prisma.articleThread.create({
      data: { normaKey: 'codice-civile--2043', articleId: '2043', title: 'Sul danno', body: 'Il testo intero.', userId: alice.id },
    });
    await prisma.articleComment.createMany({
      data: [
        { threadId: thread.id, userId: bob.id, body: 'Visibile.' },
        { threadId: thread.id, userId: bob.id, body: 'Nascosta.', isHidden: true },
      ],
    });
    const res = await get(bob, thread.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: thread.id, title: 'Sul danno', body: 'Il testo intero.', target: { kind: 'article' }, commentCount: 1,
      decisionLabel: null, passage: null, passageWithheld: false, isOwner: false,
    });
    expect(res.body.comments.map((c: { body: string }) => c.body)).toEqual(['Visibile.']);
    expect(res.body.lastActivityAt).toBeDefined();
  });

  it('withholds a decision’s quotation as the feed does', async () => {
    const thread = await prisma.articleThread.create({
      data: {
        targetKind: 'decision', decisionKey: DECISION, normaKey: DECISION, articleId: '', title: '', body: 'Sul passo.',
        passageQuote: 'parole ritirate', passageStart: 40, passagePrefix: 'il contesto prima', passageSuffix: 'il contesto dopo', userId: alice.id,
      },
    });
    const other = await get(bob, thread.id);
    expect(other.body.passage).toBeNull();
    expect(JSON.stringify(other.body)).not.toContain('contesto');
    expect(other.body.passageWithheld).toBe(true);
    expect(other.body.decisionLabel).toBe('Cass. civ., n. 31310/2024');
    const author = await get(alice, thread.id);
    expect(author.body.passage).toEqual({ quote: 'parole ritirate', start: 40, prefix: 'il contesto prima', suffix: 'il contesto dopo' });
    expect(author.body.passageWithheld).toBe(false);
  });

  it('answers 404 for a hidden or missing glossa', async () => {
    const hidden = await prisma.articleThread.create({
      data: { normaKey: 'codice-civile--2043', articleId: '2043', title: 'Nascosta', body: 'Testo.', userId: alice.id, isHidden: true },
    });
    for (const id of [hidden.id, '00000000-0000-0000-0000-000000000000', 'non-un-id']) {
      const res = await get(bob, id);
      expect(res.status).toBe(404);
      expect(res.body.detail).toContain('Glossa non trovata');
    }
  });
});

describe('the per-article list', () => {
  it('answers a page that is not a number with an Italian 400', async () => {
    const alice = await createTestUser('list-alice');
    const res = await request(app).get('/api/article-discussions').set(authHeader(alice))
      .query({ normaKey: 'codice-civile--2043', articleId: '2043', page: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.detail).toContain('La pagina non è valida');
  });
});
