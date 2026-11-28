import type { LingoCardStato } from '../src/lib/db';
import { describe, expect, it } from 'vitest';
import { app, authHeader, createTestUser, prisma, request, type TestUser } from './helpers';
import { delegated } from './delegatedHelper';

/**
 * «Togli i miei contributi» (G-502, G-558): everything a person wrote for others, removed at once before they leave,
 * each kind by the rule it already has, with an answer that says what was done.
 */
const ARTICLE = { normaKey: 'codice-civile--art-1453', articleId: '1453' };
const PASSAGE = { quote: 'Nei contratti con prestazioni corrispettive', start: 0, prefix: '', suffix: ' quando uno dei contraenti' };
const URN = 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453';

async function writeGlossa(author: TestUser, title: string) {
  const created = await request(app).post('/api/article-discussions').set(authHeader(author))
    .send({ ...ARTICLE, title, body: 'Quando l’inadempimento è di scarsa importanza?', passage: PASSAGE });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

async function reply(author: TestUser, threadId: string, body: string, parentId?: string) {
  const created = await request(app).post(`/api/article-discussions/${threadId}/comments`).set(authHeader(author))
    .send({ body, ...(parentId ? { parentId } : {}) });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

async function card(authorId: string, stato: LingoCardStato) {
  return prisma.lingoCard.create({
    data: {
      autoreId: authorId, materia: 'DIRITTO_CIVILE', istituto: 'Risoluzione', domanda: 'Quando?', risposta: 'Se grave.', stato,
      ancore: { create: [{ normaKey: 'codice_civile', articleId: 'art_1453', urn: URN, aknFingerprint: 'a'.repeat(64), isPrimary: true }] },
    },
  });
}

const removeAll = (who: TestUser, password = 'test-password') =>
  request(app).post('/api/auth/contributions/remove').set(authHeader(who)).send({ password });

describe('removing all of one’s contributions (G-558)', () => {
  it('removes each kind by its own rule and says what it did', async () => {
    const [maria, bob] = await Promise.all(['all-maria', 'all-bob'].map((n) => createTestUser(n)));

    const alone = await writeGlossa(maria, 'Sola');                 // nobody else answered: deleted,
    await reply(maria, alone, 'Mi rispondo da sola');               // with her own reply under it
    const answered = await writeGlossa(maria, 'Con risposte');      // Bob answered: emptied
    await reply(bob, answered, 'Risposta di Bob');
    const bobsGlossa = await writeGlossa(bob, 'Di Bob');
    const lonelyReply = await reply(maria, bobsGlossa, 'Risposta sola');            // nothing under it: deleted
    const answeredReply = await reply(maria, bobsGlossa, 'Risposta con commento');  // Bob commented under it: emptied
    await reply(bob, bobsGlossa, 'Commento di Bob', answeredReply);
    const ownChain = await reply(maria, bobsGlossa, 'Domanda');                     // her own comment under it only:
    await reply(maria, bobsGlossa, 'Mi rispondo', ownChain);                        // both deleted, the newest first
    await prisma.forumValidation.create({ data: { threadId: bobsGlossa, validatorId: maria.id, materia: 'DIRITTO_CIVILE' } });

    const proposed = await card(maria.id, 'PROPOSTA_COMMUNITY');
    const unused = await card(maria.id, 'VALIDATA');
    const used = await card(maria.id, 'DA_RIVEDERE');
    await prisma.lingoStatoRipasso.create({
      data: { utenteId: bob.id, cardId: used.id, stability: 2.4, difficulty: 4.93, dueAt: new Date('2026-12-20T22:00:00Z'), lastReviewAt: new Date('2026-11-18T10:00:00Z') },
    });
    const draft = await card(maria.id, 'BOZZA_PERSONALE');
    const bobsCard = await card(bob.id, 'VALIDATA');
    await prisma.lingoValidazioneCard.create({ data: { cardId: bobsCard.id, utenteId: maria.id, giudizio: 'MIGLIORABILE', motivazione: 'Manca il caso della diffida.' } });

    const res = await removeAll(maria);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      glosse: { cancellate: 1, svuotate: 1 },
      risposte: { cancellate: 4, svuotate: 1 },
      validazioniForum: 1,
      schede: { ritirate: 1, cancellate: 1, senzaNome: 1 },
      motivazioni: 1,
    });

    expect(await prisma.articleThread.count({ where: { id: alone } })).toBe(0);
    expect(await prisma.articleThread.findUniqueOrThrow({ where: { id: answered } })).toMatchObject({ title: '', body: '' });
    expect(await prisma.articleComment.count({ where: { id: lonelyReply } })).toBe(0);
    expect(await prisma.articleComment.findUniqueOrThrow({ where: { id: answeredReply } })).toMatchObject({ body: '' });
    expect(await prisma.articleComment.count({ where: { userId: maria.id, deletedAt: null } })).toBe(0);
    expect(await prisma.forumValidation.count({ where: { validatorId: maria.id } })).toBe(0);
    expect((await prisma.lingoCard.findUniqueOrThrow({ where: { id: proposed.id } })).stato).toBe('BOZZA_PERSONALE');
    expect(await prisma.lingoCard.count({ where: { id: unused.id } })).toBe(0);
    expect((await prisma.lingoCard.findUniqueOrThrow({ where: { id: used.id } })).autoreId).toBeNull();
    expect((await prisma.lingoCard.findUniqueOrThrow({ where: { id: draft.id } })).autoreId).toBe(maria.id);
    expect(await prisma.lingoValidazioneCard.findFirstOrThrow({ where: { cardId: bobsCard.id } }))
      .toMatchObject({ giudizio: 'MIGLIORABILE', motivazione: null });
    // Bob's own writing is untouched.
    expect(await prisma.articleComment.count({ where: { userId: bob.id, deletedAt: null } })).toBe(2);

    // Nothing left to remove: a second call does nothing.
    expect((await removeAll(maria)).body).toEqual({
      glosse: { cancellate: 0, svuotate: 0 }, risposte: { cancellate: 0, svuotate: 0 }, validazioniForum: 0,
      schede: { ritirate: 0, cancellate: 0, senzaNome: 0 }, motivazioni: 0,
    });
  });

  it('asks for the password and changes nothing without it', async () => {
    const maria = await createTestUser('all-wrong-password');
    const glossa = await writeGlossa(maria, 'Resta');
    const res = await removeAll(maria, 'not-the-password');
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('La password non è corretta');
    expect(await prisma.articleThread.count({ where: { id: glossa } })).toBe(1);
  });

  it('counts a wrong password as a failed attempt, as a sign-in does: the sixth from one address is refused', async () => {
    const maria = await createTestUser('all-guessing');
    const guess = () => request(app).post('/api/auth/contributions/remove').set(authHeader(maria))
      .set({ 'X-Forwarded-For': '203.0.123.9' }).send({ password: 'not-the-password' });
    for (let i = 0; i < 5; i += 1) expect((await guess()).status).toBe(400);
    expect((await guess()).status).toBe(429);
  });

  it('is not open to a connected application', async () => {
    const maria = await createTestUser('all-app');
    const glossa = await writeGlossa(maria, 'Resta anche qui');
    const asApp = await delegated(maria, 'lingo:cards:write');
    const res = await request(app).post('/api/auth/contributions/remove').set(asApp).send({ password: 'test-password' });
    expect(res.status).toBe(403);
    expect(await prisma.articleThread.count({ where: { id: glossa } })).toBe(1);
  });
});
