import type { LingoCardStato } from '../src/lib/db';
import { describe, expect, it } from 'vitest';
import { app, authHeader, createTestUser, prisma, request, type TestUser } from './helpers';
import { delegated } from './delegatedHelper';

/**
 * Removing one's own contributions to Learn before leaving (G-502).
 * - G-556: the author of a validated or under-review card removes it if nobody else uses it (reviews it, or follows the
 *   course it is in); otherwise it stays without the author's name, and the answer says so.
 * - G-557: a validator erases the reason they wrote; the judgement stays, since it counted for the card's state.
 */
const URN = 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453';

async function makeCard(authorId: string, stato: LingoCardStato, over: Record<string, unknown> = {}) {
  return prisma.lingoCard.create({
    data: {
      autoreId: authorId, materia: 'DIRITTO_CIVILE', istituto: 'Risoluzione', domanda: 'Quando?', risposta: 'Se grave.', stato,
      ancore: { create: [{ normaKey: 'codice_civile', articleId: 'art_1453', urn: URN, aknFingerprint: 'a'.repeat(64), isPrimary: true }] },
      ...over,
    },
  });
}

async function reviewing(user: TestUser, cardId: string) {
  await prisma.lingoStatoRipasso.create({
    data: { utenteId: user.id, cardId, stability: 2.4, difficulty: 4.93, dueAt: new Date('2026-12-20T22:00:00Z'), lastReviewAt: new Date('2026-11-18T10:00:00Z') },
  });
}

/** A course of `author`'s with one module, followed by `learner` when given; returns the module's id. */
async function courseModule(author: TestUser, learner?: TestUser) {
  const testo = await prisma.lingoTestoVersione.findFirstOrThrow();
  const corso = await prisma.lingoCorso.create({
    data: {
      autoreId: author.id, titolo: 'Corso', materia: 'DIRITTO_CIVILE', moduliPrevisti: 1, dichiarazioneTestoId: testo.id,
      moduli: { create: [{ ordine: 1, titolo: 'Modulo', domandePrima: [] }] },
    },
    include: { moduli: true },
  });
  if (learner) await prisma.lingoCorsoIscrizione.create({ data: { corsoId: corso.id, utenteId: learner.id } });
  return corso.moduli[0].id;
}

const remove = (who: TestUser, id: string) => request(app).post(`/api/lingo/cards/${id}/togli`).set(authHeader(who));
const eraseReason = (who: TestUser, cardId: string) => request(app).delete(`/api/lingo/validazione/${cardId}/motivazione`).set(authHeader(who));

describe('removing one’s own validated card (G-556)', () => {
  it('deletes it when nobody else uses it, with everything that hangs on it', async () => {
    const author = await createTestUser('own-card-free');
    const card = await makeCard(author.id, 'VALIDATA');
    await reviewing(author, card.id); // the author's own review is not someone else's use
    const res = await remove(author, card.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ esito: 'cancellata' });
    expect(await prisma.lingoCard.count({ where: { id: card.id } })).toBe(0);
    expect(await prisma.lingoStatoRipasso.count({ where: { cardId: card.id } })).toBe(0);
  });

  it('keeps it without the author’s name when someone else reviews it, and says so', async () => {
    const [author, learner] = await Promise.all(['own-card-used', 'own-card-learner'].map((n) => createTestUser(n)));
    const card = await makeCard(author.id, 'DA_RIVEDERE');
    await reviewing(learner, card.id);
    const res = await remove(author, card.id);
    expect(res.status).toBe(200);
    expect(res.body.esito).toBe('senza_nome');
    expect(res.body.detail).toBe('Altri studiano questa scheda: resta, senza il tuo nome.');
    const kept = await prisma.lingoCard.findUniqueOrThrow({ where: { id: card.id } });
    expect(kept.autoreId).toBeNull();
    expect(kept.stato).toBe('DA_RIVEDERE');
    expect(await prisma.lingoStatoRipasso.count({ where: { cardId: card.id, utenteId: learner.id } })).toBe(1);
  });

  // The two course cases cover a defence: today a course's card is never proposed (`daPercorso`), so the app cannot
  // make a validated one. They pin the rule for when that changes.
  it('keeps it without the author’s name when it is in a course someone else follows', async () => {
    const [author, learner] = await Promise.all(['own-card-course', 'own-card-follower'].map((n) => createTestUser(n)));
    const moduloId = await courseModule(author, learner);
    const card = await makeCard(author.id, 'VALIDATA', { moduloId, daPercorso: true });
    expect((await remove(author, card.id)).body.esito).toBe('senza_nome');
    expect((await prisma.lingoCard.findUniqueOrThrow({ where: { id: card.id } })).autoreId).toBeNull();
  });

  it('deletes a card of the author’s own course that nobody follows', async () => {
    const author = await createTestUser('own-card-own-course');
    const moduloId = await courseModule(author);
    const card = await makeCard(author.id, 'VALIDATA', { moduloId, daPercorso: true });
    expect((await remove(author, card.id)).body).toEqual({ esito: 'cancellata' });
  });

  it('refuses other states with the way that fits them, and another person’s card as not found', async () => {
    const [author, other] = await Promise.all(['own-card-states', 'own-card-other'].map((n) => createTestUser(n)));
    const draft = await makeCard(author.id, 'BOZZA_PERSONALE');
    const proposed = await makeCard(author.id, 'PROPOSTA_COMMUNITY');
    const validated = await makeCard(author.id, 'VALIDATA');
    expect((await remove(author, draft.id)).status).toBe(409);
    expect((await remove(author, proposed.id)).status).toBe(409);
    expect((await remove(other, validated.id)).status).toBe(404);
    expect(await prisma.lingoCard.count({ where: { autoreId: author.id } })).toBe(3);
  });

  it('is not open to a connected application', async () => {
    const author = await createTestUser('own-card-app');
    const card = await makeCard(author.id, 'VALIDATA');
    const asApp = await delegated(author, 'lingo:cards:write');
    const res = await request(app).post(`/api/lingo/cards/${card.id}/togli`).set(asApp);
    expect(res.status).toBe(403);
    expect(await prisma.lingoCard.count({ where: { id: card.id } })).toBe(1);
  });
});

describe('erasing the reason of one’s own vote (G-557)', () => {
  it('is not open to a connected application', async () => {
    const [author, validator] = await Promise.all(['reason-app-author', 'reason-app-validator'].map((n) => createTestUser(n)));
    const card = await makeCard(author.id, 'VALIDATA');
    await prisma.lingoValidazioneCard.create({ data: { cardId: card.id, utenteId: validator.id, giudizio: 'ERRATA', motivazione: 'Sbagliata.' } });
    const asApp = await delegated(validator, 'lingo:cards:write');
    expect((await request(app).delete(`/api/lingo/validazione/${card.id}/motivazione`).set(asApp)).status).toBe(403);
    expect((await prisma.lingoValidazioneCard.findFirstOrThrow({ where: { cardId: card.id } })).motivazione).toBe('Sbagliata.');
  });

  it('erases the written reason and keeps the judgement', async () => {
    const [author, validator, other] = await Promise.all(['reason-author', 'reason-validator', 'reason-other'].map((n) => createTestUser(n)));
    const card = await makeCard(author.id, 'VALIDATA');
    await prisma.lingoValidazioneCard.createMany({ data: [
      { cardId: card.id, utenteId: validator.id, giudizio: 'APPROVATA', motivazione: 'Chiara e fedele al testo.' },
      { cardId: card.id, utenteId: other.id, giudizio: 'APPROVATA', motivazione: 'Va bene.' },
    ] });
    const res = await eraseReason(validator, card.id);
    expect(res.status).toBe(204);
    const mine = await prisma.lingoValidazioneCard.findFirstOrThrow({ where: { cardId: card.id, utenteId: validator.id } });
    expect(mine).toMatchObject({ giudizio: 'APPROVATA', motivazione: null });
    expect((await prisma.lingoValidazioneCard.findFirstOrThrow({ where: { cardId: card.id, utenteId: other.id } })).motivazione).toBe('Va bene.');
  });

  it('answers 404 when the person gave no vote on that card', async () => {
    const [author, stranger] = await Promise.all(['reason-author-2', 'reason-stranger'].map((n) => createTestUser(n)));
    const card = await makeCard(author.id, 'VALIDATA');
    expect((await eraseReason(stranger, card.id)).status).toBe(404);
  });
});
