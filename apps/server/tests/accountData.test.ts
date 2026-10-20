import { describe, expect, it, beforeEach } from 'vitest';
import { request, app, createTestUser, authHeader, prisma, type TestUser } from './helpers';

describe('account data controls', () => {
  let alice: TestUser;
  beforeEach(async () => { alice = await createTestUser('account-alice'); });

  it('exports portable data without credentials', async () => {
    const response = await request(app).get('/api/auth/export').set(authHeader(alice));
    expect(response.status).toBe(200);
    expect(response.body.schemaVersion).toBe(1);
    expect(response.body.user).not.toHaveProperty('password');
    expect(response.body.data).toHaveProperty('dossiers');
    expect(response.body.data).toHaveProperty('threads');
    expect(response.body.data.lingoRipassi).toEqual([]);
    expect(response.body.data.lingoPreferenze).toBeNull();
    expect(response.body.data.lingoGiornate).toEqual([]);
    expect(response.body.data.lingoCreditiXp).toEqual([]);
  });

  it('exports the study days and the review goal', async () => {
    await prisma.lingoPreferenzeStudio.create({ data: { utenteId: alice.id, ripassiAlGiorno: 15 } });
    await prisma.lingoGiornataStudio.create({ data: { utenteId: alice.id, giorno: new Date('2026-10-19T00:00:00Z'), ripassi: 12, nuove: 3, sbagliate: 2, valido: true } });
    const response = await request(app).get('/api/auth/export').set(authHeader(alice));
    expect(response.body.data.lingoPreferenze).toEqual({ nuoveAlGiorno: 20, ripassiAlGiorno: 15, materieComunita: [] });
    expect(response.body.data.lingoGiornate).toEqual([{ giorno: '2026-10-19', ripassi: 12, nuove: 3, sbagliate: 2, codaFinita: false, valido: true, voti: 0 }]);
  });

  it('exports the XP credits, without the events’ ids, and deletes them with the account', async () => {
    const bob = await createTestUser('account-xp-bob');
    const day = (d: string) => new Date(`${d}T00:00:00Z`);
    await prisma.lingoCreditoXp.create({ data: { utenteId: alice.id, missione: 'SCRIVI', periodo: 'G:2026-10-20', giorno: day('2026-10-20'), punti: 25, fonte: 'PROPOSTA', fonteId: 'card-1', materia: 'DIRITTO_PENALE' } });
    await prisma.lingoCreditoXp.create({ data: { utenteId: alice.id, missione: 'SETTIMANA', periodo: 'S:2026-10-12', giorno: day('2026-10-18'), punti: 50, fonte: 'LETTURA' } });
    await prisma.lingoCreditoXp.create({ data: { utenteId: bob.id, missione: 'DOVUTE', periodo: 'G:2026-10-20', giorno: day('2026-10-20'), punti: 20, fonte: 'LETTURA' } });
    const response = await request(app).get('/api/auth/export').set(authHeader(alice));
    expect(response.body.data.lingoCreditiXp).toEqual([
      { missione: 'SETTIMANA', periodo: 'S:2026-10-12', giorno: '2026-10-18', punti: 50, fonte: 'LETTURA', materia: null },
      { missione: 'SCRIVI', periodo: 'G:2026-10-20', giorno: '2026-10-20', punti: 25, fonte: 'PROPOSTA', materia: 'DIRITTO_PENALE' },
    ]);
    const deleted = await request(app).delete('/api/auth/account').set(authHeader(alice)).send({ password: 'test-password', confirmation: 'ELIMINA ACCOUNT' });
    expect(deleted.status).toBe(204);
    expect(await prisma.lingoCreditoXp.findMany({ select: { utenteId: true } })).toEqual([{ utenteId: bob.id }]);
  });

  it('requires the current password and exact confirmation before deletion', async () => {
    const rejected = await request(app).delete('/api/auth/account').set(authHeader(alice)).send({ password: 'wrong', confirmation: 'ELIMINA ACCOUNT' });
    expect(rejected.status).toBe(400);
    expect(await prisma.user.findUnique({ where: { id: alice.id } })).not.toBeNull();

    const deleted = await request(app).delete('/api/auth/account').set(authHeader(alice)).send({ password: 'test-password', confirmation: 'ELIMINA ACCOUNT' });
    expect(deleted.status).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: alice.id } })).toBeNull();
  });

  it('exports a validator’s votes and acceptances, and nobody else’s', async () => {
    const bob = await createTestUser('account-bob');
    await prisma.user.update({ where: { id: alice.id }, data: { lingoValidatore: true } });
    const author = await createTestUser('account-author');
    const card = await prisma.lingoCard.create({
      data: { autoreId: author.id, materia: 'DIRITTO_CIVILE', istituto: 'Risoluzione', domanda: 'D', risposta: 'R', stato: 'PROPOSTA_COMMUNITY' },
    });
    const version = await prisma.lingoTestoVersione.findFirstOrThrow({ where: { chiave: 'PROPOSTA_SCHEDA', versione: 1 } });
    await prisma.lingoValidazioneCard.create({ data: { cardId: card.id, utenteId: alice.id, giudizio: 'ERRATA', motivazione: 'Manca il presupposto.' } });
    await prisma.lingoValidazioneCard.create({ data: { cardId: card.id, utenteId: bob.id, giudizio: 'APPROVATA' } });
    await prisma.lingoAccettazioneTesto.create({ data: { utenteId: alice.id, testoId: version.id } });
    await prisma.lingoAccettazioneTesto.create({ data: { utenteId: bob.id, testoId: version.id } });

    const response = await request(app).get('/api/auth/export').set(authHeader(alice));

    expect(response.status).toBe(200);
    expect(response.body.schemaVersion).toBe(1);
    const { lingoValidazioni, lingoAccettazioni } = response.body.data;
    expect(lingoValidazioni).toEqual([
      { cardId: card.id, giudizio: 'ERRATA', motivazione: 'Manca il presupposto.', createdAt: expect.any(String) },
    ]);
    expect(lingoAccettazioni).toEqual([
      { chiave: 'PROPOSTA_SCHEDA', versione: 1, acceptedAt: expect.any(String) },
    ]);
  });

  it('exports the user’s glossa with the others’ replies as a count, without their id or text', async () => {
    const bob = await createTestUser('account-bob');
    const thread = await prisma.articleThread.create({
      data: { normaKey: 'codice_civile', articleId: '1453', title: 'La mia glossa', body: 'Testo di Alice', userId: alice.id },
    });
    await prisma.articleComment.create({ data: { threadId: thread.id, body: 'Risposta di Bob', userId: bob.id } });
    await prisma.articleComment.create({ data: { threadId: thread.id, body: 'Risposta di Alice', userId: alice.id } });

    const response = await request(app).get('/api/auth/export').set(authHeader(alice));

    expect(response.status).toBe(200);
    const { threads, comments } = response.body.data;
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ id: thread.id, title: 'La mia glossa', body: 'Testo di Alice', userId: alice.id, repliesFromOthers: 1 });
    expect(threads[0]).not.toHaveProperty('comments');
    expect(comments).toEqual([expect.objectContaining({ threadId: thread.id, body: 'Risposta di Alice', userId: alice.id })]);
    const exported = JSON.stringify(response.body);
    expect(exported).not.toContain(bob.id);
    expect(exported).not.toContain('Risposta di Bob');
  });

  it('marks the rows taken from another user without naming them', async () => {
    const bob = await createTestUser('account-bob');
    const taken = { userId: alice.id, originalAuthorId: bob.id };
    await prisma.annotation.create({ data: { ...taken, normaKey: 'k::art::1', content: 'Nota presa' } });
    await prisma.annotation.create({ data: { userId: alice.id, normaKey: 'k::art::1', content: 'Nota mia' } });
    await prisma.highlight.create({ data: { ...taken, normaKey: 'k::art::1', text: 'testo', startOffset: 0, endOffset: 5 } });
    await prisma.dossier.create({ data: { ...taken, name: 'Dossier preso' } });
    await prisma.quickNorm.create({ data: { ...taken, label: 'Norma presa', searchParams: { act_type: 'codice civile' } } });
    await prisma.customAlias.create({ data: { ...taken, trigger: 'cc', aliasType: 'shortcut', expandTo: 'codice civile' } });

    const response = await request(app).get('/api/auth/export').set(authHeader(alice));

    expect(response.status).toBe(200);
    const { annotations, highlights, dossiers, quickNorms, customAliases } = response.body.data;
    expect(annotations.map((a: { content: string; fromAnotherUser: boolean }) => [a.content, a.fromAnotherUser])).toEqual([
      ['Nota presa', true],
      ['Nota mia', false],
    ]);
    for (const rows of [highlights, dossiers, quickNorms, customAliases]) {
      expect(rows).toEqual([expect.objectContaining({ userId: alice.id, fromAnotherUser: true })]);
      expect(rows[0]).not.toHaveProperty('originalAuthorId');
    }
    expect(JSON.stringify(response.body)).not.toContain(bob.id);
  });

  it('drops the original author from an archived environment’s content, at any depth', async () => {
    const bob = await createTestUser('account-bob');
    const content = {
      dossiers: [{ title: 'D', items: [{ type: 'note', data: 'n', originalAuthor: { id: bob.id, username: bob.username } }] }],
      annotations: [
        { text: 'Nota presa', originalAuthor: { id: bob.id, username: bob.username } },
        { text: 'Nota mia', originalAuthor: null },
      ],
      quickNorms: [{ label: 'Q', originalAuthorId: bob.id }],
    };
    await prisma.environment.create({ data: { userId: alice.id, name: 'Archivio', author: alice.username, content } });

    const response = await request(app).get('/api/auth/export').set(authHeader(alice));

    expect(response.status).toBe(200);
    const [env] = response.body.data.environments;
    expect(env).toMatchObject({ name: 'Archivio', author: alice.username });
    expect(env.content).toEqual({
      dossiers: [{ title: 'D', items: [{ type: 'note', data: 'n', fromAnotherUser: true }] }],
      annotations: [{ text: 'Nota presa', fromAnotherUser: true }, { text: 'Nota mia' }],
      quickNorms: [{ label: 'Q', fromAnotherUser: true }],
    });
    const exported = JSON.stringify(response.body);
    expect(exported).not.toContain(bob.id);
    expect(exported).not.toContain(bob.username);
  });

  it('leaves out an archived environment’s author unless it is the user’s own username', async () => {
    const bob = await createTestUser('account-bob');
    await prisma.environment.create({ data: { userId: alice.id, name: 'Dal Forum', author: bob.username, content: {} } });
    await prisma.environment.create({ data: { userId: alice.id, name: 'A mano', author: 'Studio Rossi', content: {} } });

    const response = await request(app).get('/api/auth/export').set(authHeader(alice));

    expect(response.status).toBe(200);
    expect(response.body.data.environments.map((e: { name: string; author: string | null }) => [e.name, e.author])).toEqual([
      ['Dal Forum', null],
      ['A mano', null],
    ]);
    expect(JSON.stringify(response.body)).not.toContain(bob.username);
  });

  it('keeps a `__proto__` key of an archived environment’s content as data', async () => {
    // Written in SQL: Prisma's own input serialisation would drop the key before it reached the row.
    const env = await prisma.environment.create({ data: { userId: alice.id, name: 'Strano', content: {} } });
    await prisma.$executeRaw`UPDATE environments SET content = '{"__proto__":{"nota":"mia"},"b":2}'::jsonb WHERE id = ${env.id}`;

    const response = await request(app).get('/api/auth/export').set(authHeader(alice));

    expect(response.body.data.environments[0].content).toEqual(JSON.parse('{"__proto__":{"nota":"mia"},"b":2}'));
  });

  it('has empty lists for a user who never voted or accepted', async () => {
    const response = await request(app).get('/api/auth/export').set(authHeader(alice));
    expect(response.body.data.lingoValidazioni).toEqual([]);
    expect(response.body.data.lingoAccettazioni).toEqual([]);
  });
});
