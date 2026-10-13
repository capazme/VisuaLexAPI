import { beforeEach, describe, expect, it } from 'vitest';
import type { LingoCardStato } from '@prisma/client';
import { request, app, createTestUser, authHeader, prisma, type TestUser } from './helpers';
import { createLingoCard } from '../src/lingo/cards';
import { deleteUserAccount } from '../src/lingo/deleteUserAccount';

const FINGERPRINT = 'c'.repeat(64);

function cardInput(istituto: string) {
  return {
    materia: 'DIRITTO_CIVILE',
    istituto,
    domanda: 'Quando il contratto può essere risolto?',
    risposta: "Quando l'inadempimento non è di scarsa importanza.",
    ancore: [{ normaKey: 'codice_civile', articleId: 'art_1453', urn: 'urn:nir:stato:regio.decreto:1942-03-16;262~art1453', aknFingerprint: FINGERPRINT }],
  };
}

// A card is created as a draft; move it to the state a test needs.
async function cardIn(author: TestUser, stato: LingoCardStato) {
  const created = await createLingoCard(author.id, cardInput(stato));
  return prisma.lingoCard.update({ where: { id: created.id }, data: { stato } });
}

const SHARED: LingoCardStato[] = ['PROPOSTA_COMMUNITY', 'VALIDATA', 'DA_RIVEDERE'];
const PRIVATE: LingoCardStato[] = ['BOZZA_PERSONALE', 'ARCHIVIATA'];

async function giveCards(author: TestUser) {
  for (const stato of [...PRIVATE, ...SHARED]) await cardIn(author, stato);
}

describe('what happens to a user’s cards when the account goes', () => {
  let alice: TestUser;
  let bob: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('erasure-alice');
    bob = await createTestUser('erasure-bob');
    await giveCards(alice);
    await cardIn(bob, 'BOZZA_PERSONALE');
  });

  async function expectOnlyTheSharedCardsRemain() {
    expect(await prisma.user.findUnique({ where: { id: alice.id } })).toBeNull();

    const remaining = await prisma.lingoCard.findMany({ include: { ancore: true }, orderBy: { istituto: 'asc' } });
    const anonymous = remaining.filter((c) => c.autoreId === null);
    // The cards the community has taken up stay, with their state and their anchors, and no author.
    expect(anonymous.map((c) => c.stato).sort()).toEqual([...SHARED].sort());
    for (const c of anonymous) expect(c.ancore).toHaveLength(1);
    // The private ones (drafts and archived) were personal data: gone, with their anchors.
    expect(remaining.some((c) => PRIVATE.includes(c.stato) && c.autoreId === null)).toBe(false);
    // Nobody else’s card was touched.
    const bobs = remaining.filter((c) => c.autoreId === bob.id);
    expect(bobs).toHaveLength(1);
    expect(bobs[0].stato).toBe('BOZZA_PERSONALE');
    expect(await prisma.lingoCardAncora.count()).toBe(anonymous.length + bobs.length);
  }

  it('keeps the shared cards without an author and removes the private ones, when the user deletes the account', async () => {
    const response = await request(app)
      .delete('/api/auth/account')
      .set(authHeader(alice))
      .send({ password: 'test-password', confirmation: 'ELIMINA ACCOUNT' });
    expect(response.status).toBe(204);
    await expectOnlyTheSharedCardsRemain();
  });

  it('does the same when an administrator deletes the user', async () => {
    const admin = await createTestUser('erasure-admin');
    await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: true } });

    const response = await request(app).delete(`/api/admin/users/${alice.id}`).set(authHeader(admin));
    expect(response.status).toBe(204);
    await expectOnlyTheSharedCardsRemain();
  });

  it('leaves the cards alone when the deletion is refused', async () => {
    const response = await request(app)
      .delete('/api/auth/account')
      .set(authHeader(alice))
      .send({ password: 'wrong', confirmation: 'ELIMINA ACCOUNT' });
    expect(response.status).toBe(400);
    expect(await prisma.lingoCard.count({ where: { autoreId: alice.id } })).toBe(5);
  });

  it('keeps no trace of the person in what remains', async () => {
    await request(app)
      .delete('/api/auth/account')
      .set(authHeader(alice))
      .send({ password: 'test-password', confirmation: 'ELIMINA ACCOUNT' });
    const serialised = JSON.stringify(await prisma.lingoCard.findMany({ where: { autoreId: null }, include: { ancore: true } }));
    expect(serialised).not.toContain(alice.id);
    expect(serialised).not.toContain(alice.email);
    expect(serialised).not.toContain(alice.username);
  });
});

describe('votes and texts to accept, when an account goes', () => {
  let alice: TestUser;
  let carol: TestUser;
  let cardId: string;
  let versionOne: { id: string };

  beforeEach(async () => {
    alice = await createTestUser('votes-alice');
    carol = await createTestUser('votes-carol');
    await prisma.user.update({ where: { id: carol.id }, data: { lingoValidatore: true } });
    cardId = (await cardIn(alice, 'PROPOSTA_COMMUNITY')).id;
    versionOne = await prisma.lingoTestoVersione.findFirstOrThrow({ where: { chiave: 'PROPOSTA_SCHEDA', versione: 1 } });
    await prisma.lingoValidazioneCard.create({ data: { cardId, utenteId: carol.id, giudizio: 'MIGLIORABILE', motivazione: 'Cita la norma.' } });
    await prisma.lingoAccettazioneTesto.create({ data: { utenteId: carol.id, testoId: versionOne.id } });
  });

  async function expectTheVoteOutlivesCarol() {
    expect(await prisma.user.findUnique({ where: { id: carol.id } })).toBeNull();
    // The vote stays, anonymous; the card is untouched; the acceptance went with her.
    const votes = await prisma.lingoValidazioneCard.findMany();
    expect(votes).toHaveLength(1);
    expect(votes[0]).toMatchObject({ cardId, utenteId: null, giudizio: 'MIGLIORABILE', motivazione: 'Cita la norma.' });
    const card = await prisma.lingoCard.findUniqueOrThrow({ where: { id: cardId } });
    expect(card).toMatchObject({ autoreId: alice.id, stato: 'PROPOSTA_COMMUNITY' });
    expect(await prisma.lingoAccettazioneTesto.count()).toBe(0);
    // The text she accepted is still there.
    expect(await prisma.lingoTestoVersione.findUnique({ where: { id: versionOne.id } })).not.toBeNull();
  }

  it('keeps the vote without a voter and drops the acceptance, when the user deletes the account', async () => {
    const response = await request(app)
      .delete('/api/auth/account')
      .set(authHeader(carol))
      .send({ password: 'test-password', confirmation: 'ELIMINA ACCOUNT' });
    expect(response.status).toBe(204);
    await expectTheVoteOutlivesCarol();
  });

  it('does the same when an administrator deletes the user', async () => {
    const admin = await createTestUser('votes-admin');
    await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: true } });
    const response = await request(app).delete(`/api/admin/users/${carol.id}`).set(authHeader(admin));
    expect(response.status).toBe(204);
    await expectTheVoteOutlivesCarol();
  });

  it('keeps a text version whose administrator is deleted, without its author', async () => {
    const writer = await createTestUser('votes-writer');
    await prisma.user.update({ where: { id: writer.id }, data: { isAdmin: true } });
    const version = await prisma.lingoTestoVersione.create({
      data: { chiave: 'PROPOSTA_SCHEDA', versione: 2, titolo: 'T', corpo: 'C', conferma: 'Ok', azione: 'Vai', autoreId: writer.id },
    });
    const admin = await createTestUser('votes-other-admin');
    await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: true } });

    const response = await request(app).delete(`/api/admin/users/${writer.id}`).set(authHeader(admin));
    expect(response.status).toBe(204);
    const kept = await prisma.lingoTestoVersione.findUniqueOrThrow({ where: { id: version.id } });
    expect(kept.autoreId).toBeNull();
    expect(kept.versione).toBe(2);
  });
});

// A review of `card` by `user`: the state row and one log row, as the review route writes them.
async function reviewed(user: TestUser, cardId: string) {
  await prisma.lingoStatoRipasso.create({
    data: { utenteId: user.id, cardId, stability: 2.4, difficulty: 4.93, dueAt: new Date('2026-10-20T22:00:00Z'), lastReviewAt: new Date('2026-10-18T10:00:00Z') },
  });
  await prisma.lingoRevisioneSRS.create({
    data: { utenteId: user.id, cardId, rating: 3, scheduledDays: 2, stability: 2.4, difficulty: 4.93, durataMs: 4200 },
  });
}

describe('what happens to a user’s reviews when the account goes', () => {
  it('removes their review state, log and preferences, and nobody else’s', async () => {
    const alice = await createTestUser('review-erasure-alice');
    const bob = await createTestUser('review-erasure-bob');
    const shared = await cardIn(bob, 'VALIDATA');
    await reviewed(alice, shared.id);
    await reviewed(bob, shared.id);
    await prisma.lingoPreferenzeStudio.create({ data: { utenteId: alice.id, nuoveAlGiorno: 5, materieComunita: ['DIRITTO_CIVILE'] } });
    await prisma.lingoPreferenzeStudio.create({ data: { utenteId: bob.id } });

    const response = await request(app)
      .delete('/api/auth/account')
      .set(authHeader(alice))
      .send({ password: 'test-password', confirmation: 'ELIMINA ACCOUNT' });
    expect(response.status).toBe(204);

    expect(await prisma.lingoStatoRipasso.findMany({ select: { utenteId: true } })).toEqual([{ utenteId: bob.id }]);
    expect(await prisma.lingoRevisioneSRS.findMany({ select: { utenteId: true } })).toEqual([{ utenteId: bob.id }]);
    expect(await prisma.lingoPreferenzeStudio.findMany({ select: { utenteId: true } })).toEqual([{ utenteId: bob.id }]);
  });

  it('removes the reviews of a card that goes with its author', async () => {
    const alice = await createTestUser('review-erasure-own');
    const draft = await cardIn(alice, 'BOZZA_PERSONALE');
    await reviewed(alice, draft.id);
    await request(app)
      .delete('/api/auth/account')
      .set(authHeader(alice))
      .send({ password: 'test-password', confirmation: 'ELIMINA ACCOUNT' });
    expect(await prisma.lingoStatoRipasso.count()).toBe(0);
    expect(await prisma.lingoRevisioneSRS.count()).toBe(0);
  });

  it('removes everyone’s reviews of a card when the card is deleted', async () => {
    const author = await createTestUser('review-card-author');
    const reader = await createTestUser('review-card-reader');
    const card = await cardIn(author, 'VALIDATA');
    await reviewed(author, card.id);
    await reviewed(reader, card.id);
    const other = await cardIn(author, 'PROPOSTA_COMMUNITY');
    await reviewed(reader, other.id);

    await prisma.lingoCard.delete({ where: { id: card.id } });

    expect(await prisma.lingoStatoRipasso.findMany({ select: { cardId: true } })).toEqual([{ cardId: other.id }]);
    expect(await prisma.lingoRevisioneSRS.findMany({ select: { cardId: true } })).toEqual([{ cardId: other.id }]);
  });

  it('keeps one state row per user and card', async () => {
    const alice = await createTestUser('review-state-unique');
    const card = await cardIn(alice, 'BOZZA_PERSONALE');
    await reviewed(alice, card.id);
    await expect(
      prisma.lingoStatoRipasso.create({
        data: { utenteId: alice.id, cardId: card.id, stability: 1, difficulty: 5, dueAt: new Date(), lastReviewAt: new Date() },
      })
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('exporting an account', () => {
  it('includes the user’s own cards, in every state, with their anchors, and nobody else’s', async () => {
    const alice = await createTestUser('export-alice');
    const bob = await createTestUser('export-bob');
    await giveCards(alice);
    await cardIn(bob, 'VALIDATA');

    const response = await request(app).get('/api/auth/export').set(authHeader(alice));

    expect(response.status).toBe(200);
    const cards = response.body.data.lingoCards;
    expect(cards).toHaveLength(5);
    expect(cards.map((c: { stato: string }) => c.stato).sort()).toEqual([...PRIVATE, ...SHARED].sort());
    for (const c of cards) {
      expect(c.autoreId).toBe(alice.id);
      expect(c.ancore).toHaveLength(1);
    }
  });

  it('includes the review log, oldest first, and the preferences, and nobody else’s', async () => {
    const alice = await createTestUser('export-review-alice');
    const bob = await createTestUser('export-review-bob');
    const first = await cardIn(alice, 'BOZZA_PERSONALE');
    const second = await cardIn(alice, 'VALIDATA');
    await prisma.lingoRevisioneSRS.create({
      data: { utenteId: alice.id, cardId: second.id, dataRevisione: new Date('2026-10-19T09:00:00Z'), rating: 4, scheduledDays: 9, stability: 8.2, difficulty: 4.1 },
    });
    await prisma.lingoRevisioneSRS.create({
      data: { utenteId: alice.id, cardId: first.id, dataRevisione: new Date('2026-10-18T09:00:00Z'), rating: 3, scheduledDays: 2, stability: 2.4, difficulty: 4.93, durataMs: 4200 },
    });
    await prisma.lingoRevisioneSRS.create({
      data: { utenteId: bob.id, cardId: second.id, rating: 1, scheduledDays: 1, stability: 0.4, difficulty: 7.2 },
    });
    await prisma.lingoPreferenzeStudio.create({ data: { utenteId: alice.id, nuoveAlGiorno: 12, materieComunita: ['DIRITTO_CIVILE', 'DIRITTO_PENALE'] } });

    const response = await request(app).get('/api/auth/export').set(authHeader(alice));

    expect(response.status).toBe(200);
    expect(response.body.schemaVersion).toBe(1);
    expect(response.body.data.lingoRipassi).toEqual([
      { cardId: first.id, dataRevisione: '2026-10-18T09:00:00.000Z', rating: 3, scheduledDays: 2, stability: 2.4, difficulty: 4.93, durataMs: 4200 },
      { cardId: second.id, dataRevisione: '2026-10-19T09:00:00.000Z', rating: 4, scheduledDays: 9, stability: 8.2, difficulty: 4.1, durataMs: null },
    ]);
    expect(response.body.data.lingoPreferenze).toEqual({ nuoveAlGiorno: 12, materieComunita: ['DIRITTO_CIVILE', 'DIRITTO_PENALE'] });
  });

  it('has an empty log and no preferences for a user who never studied', async () => {
    const dora = await createTestUser('export-review-dora');
    const response = await request(app).get('/api/auth/export').set(authHeader(dora));
    expect(response.body.data.lingoRipassi).toEqual([]);
    expect(response.body.data.lingoPreferenze).toBeNull();
  });

  it('has an empty list for a user with no cards', async () => {
    const carol = await createTestUser('export-carol');
    const response = await request(app).get('/api/auth/export').set(authHeader(carol));
    expect(response.body.data.lingoCards).toEqual([]);
  });
});

describe('an account deleted while a vote archives one of its cards', () => {
  it('takes the card that the vote archived, instead of leaving it with no author', async () => {
    const carla = await createTestUser('erasure-carla');
    const card = await cardIn(carla, 'PROPOSTA_COMMUNITY');
    let deleting: Promise<void> | undefined;
    // The vote's transaction: the card row locked, then archived after a while.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM lingo_cards WHERE id = ${card.id} FOR UPDATE`;
      deleting = deleteUserAccount(carla.id);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tx.lingoCard.update({ where: { id: card.id }, data: { stato: 'ARCHIVIATA' } });
    });
    await deleting;
    expect(await prisma.lingoCard.findUnique({ where: { id: card.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: carla.id } })).toBeNull();
  });
});
