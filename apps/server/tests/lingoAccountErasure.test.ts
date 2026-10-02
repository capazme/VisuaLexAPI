import { beforeEach, describe, expect, it } from 'vitest';
import type { LingoCardStato } from '@prisma/client';
import { request, app, createTestUser, authHeader, prisma, type TestUser } from './helpers';
import { createLingoCard } from '../src/lingo/cards';

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

  it('has an empty list for a user with no cards', async () => {
    const carol = await createTestUser('export-carol');
    const response = await request(app).get('/api/auth/export').set(authHeader(carol));
    expect(response.body.data.lingoCards).toEqual([]);
  });
});
