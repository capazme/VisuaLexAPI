import type { LingoCardStato } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from './helpers';
import { delegated } from './delegatedHelper';

// Proposing a card under the current notice, withdrawing it, the validators'
// queue and vote (Studia PR B, Task B3; spec decisions 5, 12–15, 19, 20, 22).

const URN = 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453';
const OF_1453 = `https://www.normattiva.it/uri-res/N2Ls?${URN}!vig=2026-10-07`;

async function makeCard(authorId: string | null, stato: LingoCardStato = 'BOZZA_PERSONALE', over: Record<string, unknown> = {}) {
  return prisma.lingoCard.create({
    data: {
      autoreId: authorId, materia: 'DIRITTO_CIVILE', istituto: 'Risoluzione', domanda: 'Quando?', risposta: 'Se grave.', stato,
      ancore: { create: [{ normaKey: 'codice_civile', articleId: 'art_1453', urn: URN, aknFingerprint: 'a'.repeat(64), isPrimary: true }] },
      ...over,
    },
  });
}
const makeValidator = async (name: string) => {
  const user = await createTestUser(name);
  await prisma.user.update({ where: { id: user.id }, data: { lingoValidatore: true } });
  return user;
};
const notice = () => prisma.lingoTestoVersione.findFirstOrThrow({ where: { chiave: 'PROPOSTA_SCHEDA' }, orderBy: { versione: 'desc' } });
const propose = (who: TestUser, id: string, body?: unknown) => request(app).post(`/api/lingo/cards/${id}/proponi`).set(authHeader(who)).send(body as object | undefined);
const withdraw = (who: TestUser, id: string) => request(app).post(`/api/lingo/cards/${id}/ritira`).set(authHeader(who));
const vote = (who: TestUser, id: string, body: unknown) => request(app).post(`/api/lingo/validazione/${id}`).set(authHeader(who)).send(body as object);
const queue = (who: TestUser, query = '') => request(app).get(`/api/lingo/validazione/coda${query}`).set(authHeader(who));
const state = async (id: string) => (await prisma.lingoCard.findUniqueOrThrow({ where: { id } })).stato;

describe('proposing a card', () => {
  let alice: TestUser;
  let bob: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('val-alice');
    bob = await createTestUser('val-bob');
  });

  it('without an accepted notice answers 409 with the current version, and the card stays a draft', async () => {
    const card = await makeCard(alice.id);
    const response = await propose(alice, card.id);
    const v1 = await notice();
    expect(response.status).toBe(409);
    expect(response.body.richiedeTesto).toMatchObject({ id: v1.id, chiave: 'PROPOSTA_SCHEDA', versione: 1, titolo: v1.titolo, corpo: v1.corpo, conferma: v1.conferma, azione: v1.azione });
    expect(await state(card.id)).toBe('BOZZA_PERSONALE');
    expect(await prisma.lingoAccettazioneTesto.count()).toBe(0);
  });

  it('with the current version accepted proposes the card, remembers the version and writes one acceptance', async () => {
    const card = await makeCard(alice.id);
    const v1 = await notice();
    const response = await propose(alice, card.id, { accettoTestoId: v1.id });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: card.id, stato: 'PROPOSTA_COMMUNITY' });
    expect(response.body).not.toHaveProperty('propostaTestoId');
    expect(await prisma.lingoCard.findUniqueOrThrow({ where: { id: card.id } })).toMatchObject({ stato: 'PROPOSTA_COMMUNITY', propostaTestoId: v1.id });
    const rows = await prisma.lingoAccettazioneTesto.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ utenteId: alice.id, testoId: v1.id });
    expect(rows[0].acceptedAt).toBeInstanceOf(Date);
  });

  it('needs no body from a person who already accepted that version', async () => {
    const [one, two] = [await makeCard(alice.id), await makeCard(alice.id)];
    await propose(alice, one.id, { accettoTestoId: (await notice()).id });
    const second = await propose(alice, two.id);
    expect(second.status).toBe(200);
    expect(await state(two.id)).toBe('PROPOSTA_COMMUNITY');
    expect(await prisma.lingoAccettazioneTesto.count()).toBe(1);
  });

  it('asks again after a new version, and leaves a card proposed under version 1 as it was', async () => {
    const [one, two] = [await makeCard(alice.id), await makeCard(alice.id)];
    const v1 = await notice();
    await propose(alice, one.id, { accettoTestoId: v1.id });
    const v2 = await prisma.lingoTestoVersione.create({ data: { chiave: 'PROPOSTA_SCHEDA', versione: 2, titolo: 'Nuovo', corpo: 'Corpo nuovo', conferma: 'Accetto', azione: 'Vai' } });
    const response = await propose(alice, two.id);
    expect(response.status).toBe(409);
    expect(response.body.richiedeTesto).toMatchObject({ id: v2.id, versione: 2, titolo: 'Nuovo' });
    expect(await prisma.lingoCard.findUniqueOrThrow({ where: { id: one.id } })).toMatchObject({ stato: 'PROPOSTA_COMMUNITY', propostaTestoId: v1.id });
    expect(await state(two.id)).toBe('BOZZA_PERSONALE');
  });

  it('refuses the id of a superseded version with the current one, and writes no acceptance', async () => {
    const card = await makeCard(alice.id);
    const v1 = await notice();
    const v2 = await prisma.lingoTestoVersione.create({ data: { chiave: 'PROPOSTA_SCHEDA', versione: 2, titolo: 'Nuovo', corpo: 'C', conferma: 'A', azione: 'V' } });
    const response = await propose(alice, card.id, { accettoTestoId: v1.id });
    expect(response.status).toBe(409);
    expect(response.body.richiedeTesto.id).toBe(v2.id);
    expect(await prisma.lingoAccettazioneTesto.count()).toBe(0);
    expect(await state(card.id)).toBe('BOZZA_PERSONALE');
  });

  it('refuses an unknown id with 409 and writes nothing', async () => {
    const card = await makeCard(alice.id);
    const response = await propose(alice, card.id, { accettoTestoId: 'no-such-version' });
    expect(response.status).toBe(409);
    expect(response.body.richiedeTesto.versione).toBe(1);
    expect(await prisma.lingoAccettazioneTesto.count()).toBe(0);
    expect(await state(card.id)).toBe('BOZZA_PERSONALE');
  });

  it('tolerates the same acceptance sent twice at once', async () => {
    const [one, two] = [await makeCard(alice.id), await makeCard(alice.id)];
    const v1 = await notice();
    const both = await Promise.all([propose(alice, one.id, { accettoTestoId: v1.id }), propose(alice, two.id, { accettoTestoId: v1.id })]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect(await prisma.lingoAccettazioneTesto.count()).toBe(1);
  });

  it('refuses a body with an unknown key or a NUL in the id (400), and a state in the body changes nothing', async () => {
    const card = await makeCard(alice.id);
    const v1 = await notice();
    expect((await propose(alice, card.id, { accettoTestoId: v1.id, stato: 'VALIDATA' })).status).toBe(400);
    expect((await propose(alice, card.id, { accettoTestoId: 'a\u0000b' })).status).toBe(400);
    expect((await propose(alice, card.id, { accettoTestoId: 7 })).status).toBe(400);
    expect(await state(card.id)).toBe('BOZZA_PERSONALE');
  });

  it('answers 404 for someone else’s card, an unknown card and an id with a NUL', async () => {
    const card = await makeCard(alice.id);
    const v1 = await notice();
    expect((await propose(bob, card.id, { accettoTestoId: v1.id })).status).toBe(404);
    expect((await propose(alice, 'nothing', { accettoTestoId: v1.id })).status).toBe(404);
    expect((await propose(alice, 'a%00b', { accettoTestoId: v1.id })).status).toBe(404);
    expect(await state(card.id)).toBe('BOZZA_PERSONALE');
    expect(await prisma.lingoAccettazioneTesto.count()).toBe(0);
  });

  it('answers 409 for a card that is not a draft', async () => {
    const v1 = await notice();
    for (const stato of ['PROPOSTA_COMMUNITY', 'VALIDATA', 'DA_RIVEDERE', 'ARCHIVIATA'] as const) {
      const card = await makeCard(alice.id, stato);
      expect((await propose(alice, card.id, { accettoTestoId: v1.id })).status).toBe(409);
      expect(await state(card.id)).toBe(stato);
    }
    expect(await prisma.lingoAccettazioneTesto.count()).toBe(0);
  });
});

describe('withdrawing a proposal', () => {
  let alice: TestUser;
  beforeEach(async () => { alice = await createTestUser('wd-alice'); });

  it('makes the card a draft again, drops its votes and the version it was proposed under', async () => {
    const carol = await makeValidator('wd-carol');
    const v1 = await notice();
    const card = await makeCard(alice.id, 'PROPOSTA_COMMUNITY', { propostaTestoId: v1.id });
    await prisma.lingoValidazioneCard.create({ data: { cardId: card.id, utenteId: carol.id, giudizio: 'MIGLIORABILE', motivazione: 'Precisa meglio' } });
    const response = await withdraw(alice, card.id);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: card.id, stato: 'BOZZA_PERSONALE' });
    expect(await prisma.lingoCard.findUniqueOrThrow({ where: { id: card.id } })).toMatchObject({ stato: 'BOZZA_PERSONALE', propostaTestoId: null });
    expect(await prisma.lingoValidazioneCard.count({ where: { cardId: card.id } })).toBe(0);
  });

  it('lets the draft be proposed again, with no votes carried over', async () => {
    const carol = await makeValidator('wd-carol2');
    const v1 = await notice();
    const card = await makeCard(alice.id);
    await propose(alice, card.id, { accettoTestoId: v1.id });
    await vote(carol, card.id, { giudizio: 'APPROVATA' });
    await withdraw(alice, card.id);
    expect((await propose(alice, card.id)).status).toBe(200);
    expect(await prisma.lingoValidazioneCard.count({ where: { cardId: card.id } })).toBe(0);
    expect((await vote(carol, card.id, { giudizio: 'APPROVATA' })).status).toBe(200);
  });

  it('answers 409 for a validated card (and every other state but proposed), 404 for someone else’s', async () => {
    const bob = await createTestUser('wd-bob');
    for (const stato of ['BOZZA_PERSONALE', 'VALIDATA', 'DA_RIVEDERE', 'ARCHIVIATA'] as const) {
      const card = await makeCard(alice.id, stato);
      expect((await withdraw(alice, card.id)).status).toBe(409);
      expect(await state(card.id)).toBe(stato);
    }
    const proposed = await makeCard(alice.id, 'PROPOSTA_COMMUNITY');
    expect((await withdraw(bob, proposed.id)).status).toBe(404);
    expect(await state(proposed.id)).toBe('PROPOSTA_COMMUNITY');
    expect((await withdraw(alice, 'nothing')).status).toBe(404);
  });
});

describe('the validators’ queue', () => {
  let alice: TestUser;
  let carol: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('q-alice');
    carol = await makeValidator('q-carol');
  });

  it('is for validators only, the flag being read from the database', async () => {
    expect((await queue(alice)).status).toBe(403);
    expect((await queue(await createTestUser('q-plain'))).status).toBe(403);
  });

  it('lists proposed cards oldest first, with anchors, and not her own, nor the voted, nor drafts, nor other states', async () => {
    const t = (n: number) => new Date(Date.UTC(2026, 9, n));
    const second = await makeCard(alice.id, 'PROPOSTA_COMMUNITY', { createdAt: t(2) });
    const first = await makeCard(alice.id, 'PROPOSTA_COMMUNITY', { createdAt: t(1) });
    const voted = await makeCard(alice.id, 'PROPOSTA_COMMUNITY', { createdAt: t(3) });
    await prisma.lingoValidazioneCard.create({ data: { cardId: voted.id, utenteId: carol.id, giudizio: 'APPROVATA' } });
    await makeCard(carol.id, 'PROPOSTA_COMMUNITY', { createdAt: t(4) });
    await makeCard(alice.id, 'BOZZA_PERSONALE', { createdAt: t(5) });
    await makeCard(alice.id, 'VALIDATA', { createdAt: t(6) });
    await makeCard(alice.id, 'ARCHIVIATA', { createdAt: t(7) });
    const response = await queue(carol);
    expect(response.status).toBe(200);
    expect(response.body.cards.map((c: { id: string }) => c.id)).toEqual([first.id, second.id]);
    expect(response.body.cards[0].ancore).toEqual([{ normaKey: 'codice_civile', articleId: 'art_1453', urn: URN, isPrimary: true }]);
  });

  it('never carries the author, and shows a card whose author’s account is gone', async () => {
    const orphan = await makeCard(null, 'PROPOSTA_COMMUNITY');
    const mine = await makeCard(alice.id, 'PROPOSTA_COMMUNITY');
    const response = await queue(carol);
    expect(response.body.cards.map((c: { id: string }) => c.id).sort()).toEqual([orphan.id, mine.id].sort());
    const text = JSON.stringify(response.body);
    expect(text).not.toContain(alice.id);
    expect(text).not.toContain('q-alice');
    expect(text).not.toContain('autore');
  });

  it('filters by subject and honours the limit (1–20, default 10)', async () => {
    for (let i = 0; i < 12; i += 1) await makeCard(alice.id, 'PROPOSTA_COMMUNITY', { createdAt: new Date(Date.UTC(2026, 0, i + 1)) });
    const penal = await makeCard(alice.id, 'PROPOSTA_COMMUNITY', { materia: 'DIRITTO_PENALE' });
    expect((await queue(carol)).body.cards).toHaveLength(10);
    expect((await queue(carol, '?limit=3')).body.cards).toHaveLength(3);
    expect((await queue(carol, '?limit=20')).body.cards).toHaveLength(13);
    expect((await queue(carol, '?materia=DIRITTO_PENALE')).body.cards.map((c: { id: string }) => c.id)).toEqual([penal.id]);
    for (const bad of ['?limit=0', '?limit=21', '?limit=x', '?materia=NOPE']) expect((await queue(carol, bad)).status).toBe(400);
  });
});

describe('voting', () => {
  let alice: TestUser;
  let carol: TestUser;
  let dave: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('v-alice');
    carol = await makeValidator('v-carol');
    dave = await makeValidator('v-dave');
  });

  it('validates a card on two approvals', async () => {
    const card = await makeCard(alice.id, 'PROPOSTA_COMMUNITY');
    const first = await vote(carol, card.id, { giudizio: 'APPROVATA' });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ stato: 'PROPOSTA_COMMUNITY' });
    const second = await vote(dave, card.id, { giudizio: 'APPROVATA', motivazione: '  Chiara.  ' });
    expect(second.body).toEqual({ stato: 'VALIDATA' });
    expect(await state(card.id)).toBe('VALIDATA');
    const votes = await prisma.lingoValidazioneCard.findMany({ where: { cardId: card.id }, orderBy: { createdAt: 'asc' } });
    expect(votes.map((v) => [v.utenteId, v.giudizio, v.motivazione])).toEqual([[carol.id, 'APPROVATA', null], [dave.id, 'APPROVATA', 'Chiara.']]);
  });

  it('archives a card on one «errata» with a reason', async () => {
    const card = await makeCard(alice.id, 'PROPOSTA_COMMUNITY');
    const response = await vote(carol, card.id, { giudizio: 'ERRATA', motivazione: 'La norma citata è abrogata.' });
    expect(response.body).toEqual({ stato: 'ARCHIVIATA' });
    expect(await state(card.id)).toBe('ARCHIVIATA');
  });

  it('deletes an author-less card that one «errata» archives, with its votes, anchors and review state', async () => {
    const card = await makeCard(null, 'PROPOSTA_COMMUNITY');
    await vote(dave, card.id, { giudizio: 'APPROVATA' });
    await prisma.lingoStatoRipasso.create({
      data: { utenteId: carol.id, cardId: card.id, stability: 1, difficulty: 5, reps: 1, lapses: 0, lastReviewAt: new Date(), dueAt: new Date() },
    });
    const response = await vote(carol, card.id, { giudizio: 'ERRATA', motivazione: 'La norma citata è abrogata.' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ stato: 'ARCHIVIATA' });
    expect(await prisma.lingoCard.findUnique({ where: { id: card.id } })).toBeNull();
    expect(await prisma.lingoValidazioneCard.count({ where: { cardId: card.id } })).toBe(0);
    expect(await prisma.lingoCardAncora.count({ where: { cardId: card.id } })).toBe(0);
    expect(await prisma.lingoStatoRipasso.count({ where: { cardId: card.id } })).toBe(0);
  });

  it('keeps an author-less card that is validated, or left proposed', async () => {
    const validated = await makeCard(null, 'PROPOSTA_COMMUNITY');
    await vote(carol, validated.id, { giudizio: 'APPROVATA' });
    await vote(dave, validated.id, { giudizio: 'APPROVATA' });
    expect(await state(validated.id)).toBe('VALIDATA');
    const improvable = await makeCard(null, 'PROPOSTA_COMMUNITY');
    await vote(carol, improvable.id, { giudizio: 'MIGLIORABILE', motivazione: 'Aggiungi un esempio.' });
    expect(await state(improvable.id)).toBe('PROPOSTA_COMMUNITY');
  });

  it('leaves the card proposed on a «migliorabile»', async () => {
    const card = await makeCard(alice.id, 'PROPOSTA_COMMUNITY');
    expect((await vote(carol, card.id, { giudizio: 'MIGLIORABILE', motivazione: 'Aggiungi un esempio.' })).body).toEqual({ stato: 'PROPOSTA_COMMUNITY' });
  });

  it('requires a reason unless approving, and refuses a long, blank or NUL reason', async () => {
    const card = await makeCard(alice.id, 'PROPOSTA_COMMUNITY');
    for (const giudizio of ['MIGLIORABILE', 'ERRATA']) {
      for (const motivazione of [undefined, '', '   ']) {
        const response = await vote(carol, card.id, { giudizio, motivazione });
        expect(response.status).toBe(400);
        expect(response.body.detail).toContain('Scrivi il motivo');
      }
    }
    expect((await vote(carol, card.id, { giudizio: 'MIGLIORABILE', motivazione: 'x'.repeat(2001) })).status).toBe(400);
    expect((await vote(carol, card.id, { giudizio: 'MIGLIORABILE', motivazione: 'a\u0000b' })).status).toBe(400);
    expect((await vote(carol, card.id, { giudizio: 'ERRATA', motivazione: 'x'.repeat(2000) })).status).toBe(200);
    expect(await prisma.lingoValidazioneCard.count()).toBe(1);
  });

  it('accepts an approval with an empty reason, and refuses an unknown judgement or key', async () => {
    const card = await makeCard(alice.id, 'PROPOSTA_COMMUNITY');
    expect((await vote(carol, card.id, { giudizio: 'BOH' })).status).toBe(400);
    expect((await vote(carol, card.id, { giudizio: 'APPROVATA', utenteId: dave.id })).status).toBe(400);
    expect((await vote(carol, card.id, { giudizio: 'APPROVATA', motivazione: '' })).status).toBe(200);
    expect((await prisma.lingoValidazioneCard.findFirstOrThrow({ where: { cardId: card.id } })).motivazione).toBeNull();
  });

  it('refuses the vote on one’s own card (403), a second vote (409), a draft or unknown card (404)', async () => {
    const own = await makeCard(carol.id, 'PROPOSTA_COMMUNITY');
    expect((await vote(carol, own.id, { giudizio: 'APPROVATA' })).status).toBe(403);
    const card = await makeCard(alice.id, 'PROPOSTA_COMMUNITY');
    expect((await vote(carol, card.id, { giudizio: 'APPROVATA' })).status).toBe(200);
    expect((await vote(carol, card.id, { giudizio: 'ERRATA', motivazione: 'Ci ho ripensato.' })).status).toBe(409);
    const draft = await makeCard(alice.id);
    expect((await vote(carol, draft.id, { giudizio: 'APPROVATA' })).status).toBe(404);
    expect((await vote(carol, 'nothing', { giudizio: 'APPROVATA' })).status).toBe(404);
    expect((await vote(carol, 'a%00b', { giudizio: 'APPROVATA' })).status).toBe(404);
    expect(await prisma.lingoValidazioneCard.count()).toBe(1);
    expect(await prisma.lingoValidazioneCard.count({ where: { cardId: own.id } })).toBe(0);
  });

  it('refuses a vote on a card that is already validated or archived (404)', async () => {
    for (const stato of ['VALIDATA', 'ARCHIVIATA', 'DA_RIVEDERE'] as const) {
      const card = await makeCard(alice.id, stato);
      expect((await vote(carol, card.id, { giudizio: 'APPROVATA' })).status).toBe(404);
    }
  });

  it('refuses a person who is not a validator (403) and writes nothing', async () => {
    const bob = await createTestUser('v-bob');
    const card = await makeCard(alice.id, 'PROPOSTA_COMMUNITY');
    expect((await vote(bob, card.id, { giudizio: 'APPROVATA' })).status).toBe(403);
    expect(await prisma.lingoValidazioneCard.count()).toBe(0);
  });

  it('Review Focus 2: two approvals sent together leave exactly two votes and a validated card', async () => {
    const card = await makeCard(alice.id, 'PROPOSTA_COMMUNITY');
    const both = await Promise.all([vote(carol, card.id, { giudizio: 'APPROVATA' }), vote(dave, card.id, { giudizio: 'APPROVATA' })]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect(await prisma.lingoValidazioneCard.count({ where: { cardId: card.id } })).toBe(2);
    expect(await state(card.id)).toBe('VALIDATA');
  });

  it('Review Focus 2: a vote sent after the withdrawal gets 404 and leaves no vote', async () => {
    const v1 = await notice();
    const card = await makeCard(alice.id);
    await propose(alice, card.id, { accettoTestoId: v1.id });
    expect((await withdraw(alice, card.id)).status).toBe(200);
    expect((await vote(carol, card.id, { giudizio: 'APPROVATA' })).status).toBe(404);
    expect(await prisma.lingoValidazioneCard.count()).toBe(0);
  });

  it('Review Focus 2: a vote and a withdrawal sent together never leave a vote on a draft', async () => {
    const v1 = await notice();
    const card = await makeCard(alice.id);
    await propose(alice, card.id, { accettoTestoId: v1.id });
    const [voted, withdrawn] = await Promise.all([vote(carol, card.id, { giudizio: 'MIGLIORABILE', motivazione: 'Meglio così.' }), withdraw(alice, card.id)]);
    expect(withdrawn.status).toBe(200);
    expect([200, 404]).toContain(voted.status);
    expect(await state(card.id)).toBe('BOZZA_PERSONALE');
    expect(await prisma.lingoValidazioneCard.count({ where: { cardId: card.id } })).toBe(0);
  });

  it('Review Focus 4: a validator demoted between two calls is refused on the next vote', async () => {
    const [one, two] = [await makeCard(alice.id, 'PROPOSTA_COMMUNITY'), await makeCard(alice.id, 'PROPOSTA_COMMUNITY')];
    expect((await queue(carol)).status).toBe(200);
    expect((await vote(carol, one.id, { giudizio: 'APPROVATA' })).status).toBe(200);
    await prisma.user.update({ where: { id: carol.id }, data: { lingoValidatore: false } });
    expect((await vote(carol, two.id, { giudizio: 'APPROVATA' })).status).toBe(403);
    expect((await queue(carol)).status).toBe(403);
    expect(await prisma.lingoValidazioneCard.count({ where: { cardId: two.id } })).toBe(0);
  });
});

describe('what the author and the reader see', () => {
  let alice: TestUser;
  let carol: TestUser;
  let dave: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('see-alice');
    carol = await makeValidator('see-carol');
    dave = await makeValidator('see-dave');
  });

  it('shows the author the approvals and each remark, oldest first, without the voter', async () => {
    const card = await makeCard(alice.id, 'PROPOSTA_COMMUNITY');
    await prisma.lingoValidazioneCard.create({ data: { cardId: card.id, utenteId: carol.id, giudizio: 'MIGLIORABILE', motivazione: 'Aggiungi un esempio.', createdAt: new Date(Date.UTC(2026, 9, 1)) } });
    await prisma.lingoValidazioneCard.create({ data: { cardId: card.id, utenteId: dave.id, giudizio: 'APPROVATA', createdAt: new Date(Date.UTC(2026, 9, 2)) } });
    const response = await request(app).get(`/api/lingo/cards/${card.id}`).set(authHeader(alice));
    expect(response.status).toBe(200);
    expect(response.body.approvazioni).toBe(1);
    expect(response.body.rilievi).toEqual([{ giudizio: 'MIGLIORABILE', motivazione: 'Aggiungi un esempio.', createdAt: '2026-10-01T00:00:00.000Z' }]);
    const text = JSON.stringify(response.body);
    for (const leak of [carol.id, dave.id, 'see-carol', 'see-dave', 'utenteId']) expect(text).not.toContain(leak);
  });

  it('gives a connected application the card without the votes or the reasons', async () => {
    const card = await makeCard(alice.id, 'PROPOSTA_COMMUNITY');
    await prisma.lingoValidazioneCard.create({ data: { cardId: card.id, utenteId: carol.id, giudizio: 'ERRATA', motivazione: 'Lo ha scritto Mario Rossi.' } });
    const response = await request(app).get(`/api/lingo/cards/${card.id}`).set(await delegated(alice, 'lingo:cards:read'));
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(card.id);
    expect(response.body).not.toHaveProperty('rilievi');
    expect(response.body).not.toHaveProperty('approvazioni');
    expect(JSON.stringify(response.body)).not.toContain('Mario Rossi');
  });

  it('shows a draft with no approvals and no remarks, and still only to its author', async () => {
    const card = await makeCard(alice.id);
    const response = await request(app).get(`/api/lingo/cards/${card.id}`).set(authHeader(alice));
    expect(response.body).toMatchObject({ approvazioni: 0, rilievi: [] });
    expect((await request(app).get(`/api/lingo/cards/${card.id}`).set(authHeader(carol))).status).toBe(404);
  });

  describe('the article’s cards', () => {
    const ofArticle = (who: TestUser) => request(app).get('/api/lingo/articolo').query({ urn: OF_1453 }).set(authHeader(who));

    it('adds other people’s validated cards with the approvals, and never their drafts, proposals or archived', async () => {
      const bob = await createTestUser('see-bob');
      const validated = await makeCard(alice.id, 'VALIDATA');
      await prisma.lingoValidazioneCard.createMany({
        data: [
          { cardId: validated.id, utenteId: carol.id, giudizio: 'APPROVATA' },
          { cardId: validated.id, utenteId: dave.id, giudizio: 'APPROVATA' },
        ],
      });
      for (const stato of ['BOZZA_PERSONALE', 'PROPOSTA_COMMUNITY', 'ARCHIVIATA', 'DA_RIVEDERE'] as const) await makeCard(alice.id, stato);
      const response = await ofArticle(bob);
      expect(response.status).toBe(200);
      expect(response.body.cards).toHaveLength(1);
      expect(response.body.cards[0]).toMatchObject({ id: validated.id, stato: 'VALIDATA', comunita: true, approvazioni: 2 });
      expect(JSON.stringify(response.body)).not.toContain(alice.id);
    });

    it('lists the caller’s own cards first (not archived), then the others’, at most 50 in all', async () => {
      const bob = await createTestUser('see-bob2');
      const ownDraft = await makeCard(bob.id);
      await makeCard(bob.id, 'ARCHIVIATA');
      const ownValidated = await makeCard(bob.id, 'VALIDATA');
      const theirs = await makeCard(alice.id, 'VALIDATA');
      const orphan = await makeCard(null, 'VALIDATA');
      const response = await ofArticle(bob);
      const rows = response.body.cards as Array<{ id: string; comunita: boolean; approvazioni: number | null }>;
      expect(rows.map((r) => r.comunita)).toEqual([false, false, true, true]);
      expect(rows.slice(0, 2).map((r) => r.id).sort()).toEqual([ownDraft.id, ownValidated.id].sort());
      expect(rows.slice(0, 2).every((r) => r.approvazioni === null)).toBe(true);
      expect(rows.slice(2).map((r) => r.id).sort()).toEqual([theirs.id, orphan.id].sort());
      expect(rows.slice(2).every((r) => r.approvazioni === 0)).toBe(true);

      for (let i = 0; i < 52; i += 1) await makeCard(alice.id, 'VALIDATA');
      expect((await ofArticle(bob)).body.cards).toHaveLength(50);
    });
  });
});

describe('who may reach these routes', () => {
  it('refuses an exchanged token on proponi, ritira, the queue and the vote', async () => {
    const alice = await createTestUser('tok-alice');
    // The queue and the vote are tried with a validator's token, so a 403 can only be the delegated gate's.
    const carol = await makeValidator('tok-carol');
    const card = await makeCard(alice.id, 'PROPOSTA_COMMUNITY');
    const v1 = await notice();
    const refusedByGate = (res: { status: number; body: { error?: string } }) => {
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('forbidden');
    };
    for (const scope of ['lingo:cards:read', 'lingo:cards:write']) {
      const asAlice = await delegated(alice, scope);
      const asCarol = await delegated(carol, scope);
      refusedByGate(await request(app).post(`/api/lingo/cards/${card.id}/proponi`).set(asAlice).send({ accettoTestoId: v1.id }));
      refusedByGate(await request(app).post(`/api/lingo/cards/${card.id}/ritira`).set(asAlice));
      refusedByGate(await request(app).get('/api/lingo/validazione/coda').set(asCarol));
      refusedByGate(await request(app).post(`/api/lingo/validazione/${card.id}`).set(asCarol).send({ giudizio: 'APPROVATA' }));
    }
    expect(await state(card.id)).toBe('PROPOSTA_COMMUNITY');
    expect(await prisma.lingoAccettazioneTesto.count()).toBe(0);
    expect(await prisma.lingoValidazioneCard.count()).toBe(0);
  });

  it('shows the validator flag to the person themselves on /api/auth/me and on login', async () => {
    const carol = await makeValidator('me-carol');
    const plain = await createTestUser('me-plain');
    expect((await request(app).get('/api/auth/me').set(authHeader(carol))).body.lingo_validatore).toBe(true);
    expect((await request(app).get('/api/auth/me').set(authHeader(plain))).body.lingo_validatore).toBe(false);
    await prisma.user.update({ where: { id: carol.id }, data: { lingoValidatore: false } });
    expect((await request(app).get('/api/auth/me').set(authHeader(carol))).body.lingo_validatore).toBe(false);
    const login = await request(app).post('/api/auth/login').send({ email: plain.email, password: 'test-password' });
    expect(login.status).toBe(200);
    expect(login.body.user.lingo_validatore).toBe(false);
  });
});
