import type { LingoCardStato, LingoMateria, Prisma } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from './helpers';
import { exchangeCode, startAuthorization, tokenExchange } from './oauth/oauthHelpers';
import { previewIntervals } from '../src/lingo/reviewQueue';
import { daysBetween, romeDay, startOfRomeDay } from '../src/lingo/studyDay';
import { review } from '../src/srs/fsrsEngine';

// The review routes of the study cards (Studia PR C, spec §5): the day's session, a grade, the preferences.
// «Today» is the calendar day in Rome, so the clock is moved with fake Dates (timers stay real).

const MONDAY_MORNING = '2026-10-19T08:00:00Z'; // 10:00 in Rome (CEST)
const SESSION = '/api/lingo/srs/sessione';
const GRADE = '/api/lingo/srs/revisioni';
const PREFS = '/api/lingo/srs/preferenze';

function setClock(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

// The clock jumps a day or more in these tests, past the one-hour life of the helper's token.
function longLived(user: TestUser, jti = 'a') {
  const token = jwt.sign({ userId: user.id, email: user.email, type: 'access' }, process.env.JWT_SECRET || 'test-secret', {
    expiresIn: '90d',
    jwtid: jti,
  });
  return { Authorization: `Bearer ${token}` };
}

/** An API token for `scope`, as the MCP server holds it. */
async function delegated(user: TestUser, scope: string) {
  const flow = await startAuthorization({ scope: 'dossier:read dossier:write lingo:cards:read lingo:cards:write' });
  const auth = authHeader(user);
  await request(app).get(`/api/oauth/requests/${flow.requestId}`).set(auth);
  const decision = await request(app).post(`/api/oauth/requests/${flow.requestId}/decision`).set(auth).send({ approve: true, allowDelete: true });
  const code = new URL(decision.body.redirectTo).searchParams.get('code')!;
  const access = (await exchangeCode(flow.clientId, code, flow.verifier)).body.access_token as string;
  const exchanged = await tokenExchange(access, { scope });
  if (exchanged.status !== 200) throw new Error(`exchange failed: ${JSON.stringify(exchanged.body)}`);
  return { Authorization: `Bearer ${exchanged.body.access_token}` };
}

let sequence = 0;
/** A card in `stato`, written by `author` (null: anonymous), created `sequence` seconds after the others: the order of «new». */
async function card(author: TestUser | null, stato: LingoCardStato = 'BOZZA_PERSONALE', over: { materia?: LingoMateria; istituto?: string } = {}) {
  sequence += 1;
  return prisma.lingoCard.create({
    data: {
      autoreId: author?.id ?? null,
      materia: over.materia ?? 'DIRITTO_CIVILE',
      istituto: over.istituto ?? `Istituto ${sequence}`,
      domanda: `Domanda ${sequence}?`,
      risposta: `Risposta ${sequence}.`,
      stato,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
      ancore: {
        create: [{ normaKey: 'codice_civile', articleId: 'art_1453', urn: 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453', aknFingerprint: 'a'.repeat(64), isPrimary: true }],
      },
    },
    include: { ancore: true },
  });
}

/** The scheduler state of a card for a user, due at the start of Rome day `dueDay`. */
async function stateDueOn(user: TestUser, cardId: string, dueDay: string, lastReviewAt: Date, over: { reps?: number; lapses?: number } = {}) {
  return prisma.lingoStatoRipasso.create({
    data: { utenteId: user.id, cardId, stability: 8.2, difficulty: 4.1, dueAt: startOfRomeDay(dueDay), lastReviewAt, reps: over.reps ?? 2, lapses: over.lapses ?? 0 },
  });
}

const session = (who: Record<string, string>, materia?: string, istituto?: string) =>
  request(app).get(SESSION).query({ ...(materia ? { materia } : {}), ...(istituto ? { istituto } : {}) }).set(who);
const grade = (who: Record<string, string>, body: unknown) => request(app).post(GRADE).set(who).send(body as object);
const idsOf = (response: { body: { cards: { id: string }[] } }) => response.body.cards.map((c) => c.id);

describe('the review routes', () => {
  let alice: TestUser;
  let bob: TestUser;
  let a: Record<string, string>;
  beforeEach(async () => {
    sequence = 0;
    alice = await createTestUser('srs-alice');
    bob = await createTestUser('srs-bob');
    a = longLived(alice);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('the session', () => {
    it('holds the due cards, earliest first, then new cards up to the daily goal', async () => {
      setClock(MONDAY_MORNING);
      const cards = [];
      for (let i = 0; i < 33; i++) cards.push(await card(alice));
      // Three are due, the latest due date on the oldest card: the order is by due date, not by creation.
      await stateDueOn(alice, cards[0].id, '2026-10-17', new Date('2026-10-10T08:00:00Z'));
      await stateDueOn(alice, cards[1].id, '2026-10-19', new Date('2026-10-10T08:00:00Z'));
      await stateDueOn(alice, cards[2].id, '2026-10-12', new Date('2026-10-10T08:00:00Z'));

      const response = await session(a);

      expect(response.status).toBe(200);
      expect(response.body.conteggi).toEqual({ dovute: 3, nuove: 20 });
      expect(idsOf(response)).toEqual([
        cards[2].id, cards[0].id, cards[1].id,
        ...cards.slice(3, 23).map((c) => c.id),
      ]);
      expect(response.body.cards.map((c: { nuova: boolean }) => c.nuova)).toEqual([...Array(3).fill(false), ...Array(20).fill(true)]);
      expect(response.body.cards[0]).toMatchObject({
        id: cards[2].id, materia: 'DIRITTO_CIVILE', stato: 'BOZZA_PERSONALE', comunita: false,
        ancore: [{ normaKey: 'codice_civile', articleId: 'art_1453', isPrimary: true }],
      });
    });

    it('lists a card due today and not one due tomorrow: the due day is the Rome day', async () => {
      setClock('2026-10-19T21:30:00Z'); // 23:30 on the 19th in Rome
      const dueToday = await card(alice);
      const dueTomorrow = await card(alice);
      await stateDueOn(alice, dueToday.id, '2026-10-19', new Date('2026-10-17T08:00:00Z'));
      await stateDueOn(alice, dueTomorrow.id, '2026-10-20', new Date('2026-10-17T08:00:00Z'));
      expect(idsOf(await session(a))).toEqual([dueToday.id]);

      setClock('2026-10-19T22:30:00Z'); // 00:30 on the 20th
      expect(idsOf(await session(a))).toEqual([dueToday.id, dueTomorrow.id]);
    });

    it('counts the new cards graded today against the goal, from any device', async () => {
      setClock(MONDAY_MORNING);
      const cards = [];
      for (let i = 0; i < 30; i++) cards.push(await card(alice));
      for (const c of cards.slice(0, 5)) expect((await grade(a, { cardId: c.id, rating: 3 })).body.registrata).toBe(true);

      const again = await session(a);
      expect(again.body.conteggi).toEqual({ dovute: 0, nuove: 15 });
      expect(idsOf(again)).toEqual(cards.slice(5, 20).map((c) => c.id));

      const secondDevice = await session(longLived(alice, 'phone'));
      expect(secondDevice.body.conteggi).toEqual({ dovute: 0, nuove: 15 });
      expect(idsOf(secondDevice)).toEqual(idsOf(again));
    });

    it('does not count a card first graded on an earlier day, and starts the goal afresh the next day', async () => {
      setClock(MONDAY_MORNING);
      const cards = [];
      for (let i = 0; i < 30; i++) cards.push(await card(alice));
      await prisma.lingoPreferenzeStudio.create({ data: { utenteId: alice.id, nuoveAlGiorno: 3 } });
      for (const c of cards.slice(0, 3)) await grade(a, { cardId: c.id, rating: 3 });
      expect((await session(a)).body.conteggi).toEqual({ dovute: 0, nuove: 0 });

      setClock('2026-10-20T08:00:00Z');
      const next = await session(a);
      expect(next.body.conteggi.nuove).toBe(3);
      expect(idsOf(next)).toEqual(cards.slice(3, 6).map((c) => c.id));
    });

    it('follows the daily goal the user set, and has no cap on the due cards', async () => {
      setClock(MONDAY_MORNING);
      const cards = [];
      for (let i = 0; i < 30; i++) cards.push(await card(alice));
      for (const c of cards.slice(0, 25)) await stateDueOn(alice, c.id, '2026-10-18', new Date('2026-10-10T08:00:00Z'));
      expect((await request(app).put(PREFS).set(a).send({ nuoveAlGiorno: 2 })).status).toBe(200);

      const response = await session(a);
      expect(response.body.conteggi).toEqual({ dovute: 25, nuove: 2 });
      expect(response.body.cards).toHaveLength(27);
    });

    it('never offers a card to review, archived or someone else’s private card', async () => {
      setClock(MONDAY_MORNING);
      const own = await card(alice, 'BOZZA_PERSONALE');
      const proposed = await card(alice, 'PROPOSTA_COMMUNITY');
      const validated = await card(alice, 'VALIDATA');
      await card(alice, 'DA_RIVEDERE');
      await card(alice, 'ARCHIVIATA');
      await card(bob, 'BOZZA_PERSONALE');
      await card(bob, 'PROPOSTA_COMMUNITY');
      await card(bob, 'DA_RIVEDERE');

      expect(idsOf(await session(a))).toEqual([own.id, proposed.id, validated.id]);
    });

    it('offers a card of the community only when its subject is switched on', async () => {
      setClock(MONDAY_MORNING);
      const civile = await card(bob, 'VALIDATA', { materia: 'DIRITTO_CIVILE' });
      const penale = await card(bob, 'VALIDATA', { materia: 'DIRITTO_PENALE' });
      const orphan = await card(null, 'VALIDATA', { materia: 'DIRITTO_CIVILE' });
      await card(bob, 'PROPOSTA_COMMUNITY', { materia: 'DIRITTO_CIVILE' });

      // All off at first: `in: []` matches nothing.
      expect((await session(a)).body).toEqual({ conteggi: { dovute: 0, nuove: 0 }, cards: [] });

      await request(app).put(PREFS).set(a).send({ materieComunita: ['DIRITTO_CIVILE'] });
      const civileOnly = await session(a);
      expect(idsOf(civileOnly)).toEqual([civile.id, orphan.id]);
      expect(civileOnly.body.cards.map((c: { comunita: boolean }) => c.comunita)).toEqual([true, true]);

      await request(app).put(PREFS).set(a).send({ materieComunita: ['DIRITTO_CIVILE', 'DIRITTO_PENALE'] });
      expect(idsOf(await session(a))).toEqual([civile.id, penale.id, orphan.id]);
    });

    it('does not show the community card of a subject to the author as a community card, nor twice', async () => {
      setClock(MONDAY_MORNING);
      const mine = await card(alice, 'VALIDATA', { materia: 'DIRITTO_CIVILE' });
      await request(app).put(PREFS).set(a).send({ materieComunita: ['DIRITTO_CIVILE'] });
      const response = await session(a);
      expect(idsOf(response)).toEqual([mine.id]);
      expect(response.body.cards[0].comunita).toBe(false);
    });

    it('narrows to one subject, due and new alike', async () => {
      setClock(MONDAY_MORNING);
      const civileDue = await card(alice, 'BOZZA_PERSONALE', { materia: 'DIRITTO_CIVILE' });
      const penaleDue = await card(alice, 'BOZZA_PERSONALE', { materia: 'DIRITTO_PENALE' });
      const civileNew = await card(alice, 'BOZZA_PERSONALE', { materia: 'DIRITTO_CIVILE' });
      await card(alice, 'BOZZA_PERSONALE', { materia: 'DIRITTO_PENALE' });
      await stateDueOn(alice, civileDue.id, '2026-10-18', new Date('2026-10-10T08:00:00Z'));
      await stateDueOn(alice, penaleDue.id, '2026-10-18', new Date('2026-10-10T08:00:00Z'));

      const response = await session(a, 'DIRITTO_CIVILE');
      expect(response.body.conteggi).toEqual({ dovute: 1, nuove: 1 });
      expect(idsOf(response)).toEqual([civileDue.id, civileNew.id]);
      expect((await session(a, 'DIRITTO_ALIENO')).status).toBe(400);
    });

    describe('narrowed to one institute', () => {
      it('keeps the due and the new cards of that institute, own and community alike', async () => {
        setClock(MONDAY_MORNING);
        await request(app).put(PREFS).set(a).send({ materieComunita: ['DIRITTO_CIVILE'] });
        const dueOwn = await card(alice, 'BOZZA_PERSONALE', { istituto: 'Contratto' });
        const newOwn = await card(alice, 'BOZZA_PERSONALE', { istituto: 'Contratto' });
        const newCommunity = await card(bob, 'VALIDATA', { istituto: 'Contratto' });
        const dueOther = await card(alice, 'BOZZA_PERSONALE', { istituto: 'Proprietà' });
        await card(alice, 'BOZZA_PERSONALE', { istituto: 'Proprietà' });
        await card(bob, 'VALIDATA', { istituto: 'Proprietà' });
        await stateDueOn(alice, dueOwn.id, '2026-10-18', new Date('2026-10-10T08:00:00Z'));
        await stateDueOn(alice, dueOther.id, '2026-10-18', new Date('2026-10-10T08:00:00Z'));

        const response = await session(a, 'DIRITTO_CIVILE', 'Contratto');

        expect(response.status).toBe(200);
        expect(response.body.conteggi).toEqual({ dovute: 1, nuove: 2 });
        expect(idsOf(response)).toEqual([dueOwn.id, newOwn.id, newCommunity.id]);
        expect(response.body.cards.map((c: { comunita: boolean }) => c.comunita)).toEqual([false, false, true]);
      });

      it('does not match an institute of another subject, nor a different spelling', async () => {
        setClock(MONDAY_MORNING);
        await card(alice, 'BOZZA_PERSONALE', { materia: 'DIRITTO_PENALE', istituto: 'Dolo' });
        const mine = await card(alice, 'BOZZA_PERSONALE', { materia: 'DIRITTO_CIVILE', istituto: 'Dolo' });

        expect(idsOf(await session(a, 'DIRITTO_CIVILE', 'Dolo'))).toEqual([mine.id]);
        expect(idsOf(await session(a, 'DIRITTO_CIVILE', 'dolo'))).toEqual([]);
        expect(idsOf(await session(a, 'DIRITTO_AMMINISTRATIVO', 'Dolo'))).toEqual([]);
      });

      it('keeps the daily goal of new cards, counted across institutes: one introduced in B leaves one slot in A', async () => {
        setClock(MONDAY_MORNING);
        await request(app).put(PREFS).set(a).send({ nuoveAlGiorno: 2 });
        const first = await card(alice, 'BOZZA_PERSONALE', { istituto: 'A' });
        await card(alice, 'BOZZA_PERSONALE', { istituto: 'A' });
        const seen = await card(alice, 'BOZZA_PERSONALE', { istituto: 'B' });
        await prisma.lingoStatoRipasso.create({
          data: { utenteId: alice.id, cardId: seen.id, stability: 2.4, difficulty: 4.9, dueAt: startOfRomeDay('2026-10-21'), lastReviewAt: new Date('2026-10-19T07:00:00Z'), reps: 1 },
        });

        const response = await session(a, 'DIRITTO_CIVILE', 'A');

        expect(response.body.conteggi).toEqual({ dovute: 0, nuove: 1 });
        expect(idsOf(response)).toEqual([first.id]);
      });

      it('answers 400 without the subject, or with an empty or NUL-bearing institute', async () => {
        expect((await session(a, undefined, 'Contratto')).status).toBe(400);
        expect((await request(app).get(SESSION).query({ materia: 'DIRITTO_CIVILE', istituto: '   ' }).set(a)).status).toBe(400);
        expect((await session(a, 'DIRITTO_CIVILE', 'Con\u0000tratto')).status).toBe(400);
        expect((await session(a, 'DIRITTO_CIVILE', 'x'.repeat(201))).status).toBe(400);
      });

      it('trims the institute it is given', async () => {
        setClock(MONDAY_MORNING);
        const c = await card(alice, 'BOZZA_PERSONALE', { istituto: 'Contratto' });
        expect(idsOf(await session(a, 'DIRITTO_CIVILE', '  Contratto '))).toEqual([c.id]);
      });

      it('never marks the day’s queue finished, though the whole queue is', async () => {
        setClock(MONDAY_MORNING);
        const c = await card(alice, 'BOZZA_PERSONALE', { istituto: 'Contratto' });
        await stateDueOn(alice, c.id, '2026-10-25', new Date('2026-10-19T07:00:00Z'));

        const filtered = await session(a, 'DIRITTO_CIVILE', 'Contratto');
        expect(filtered.body.conteggi).toEqual({ dovute: 0, nuove: 0 });
        expect(await prisma.lingoGiornataStudio.count()).toBe(0);

        await session(a); // the unfiltered read does mark it: the guard is the filter's
        expect(await prisma.lingoGiornataStudio.count()).toBe(1);
      });
    });

    it('gives each card the four intervals the engine would give, from its state', async () => {
      setClock(MONDAY_MORNING);
      const due = await card(alice);
      const fresh = await card(alice);
      await stateDueOn(alice, due.id, '2026-10-19', new Date('2026-10-10T08:00:00Z')); // reviewed 9 Rome days ago

      const response = await session(a);
      const [dueCard, freshCard] = response.body.cards;
      expect(dueCard.id).toBe(due.id);
      expect(dueCard.anteprima).toEqual(previewIntervals({ stability: 8.2, difficulty: 4.1 }, 9));
      expect(freshCard.id).toBe(fresh.id);
      expect(freshCard.anteprima).toEqual({ 1: 1, 2: 1, 3: 2, 4: 6 });
      expect(Object.keys(freshCard.anteprima)).toEqual(['1', '2', '3', '4']);
    });

    it('keeps the elapsed days in Rome days: a card reviewed last night is one day old this morning', async () => {
      setClock('2026-10-19T22:30:00Z'); // 00:30 on the 20th in Rome
      const c = await card(alice);
      await stateDueOn(alice, c.id, '2026-10-20', new Date('2026-10-19T21:30:00Z')); // 23:30 on the 19th
      const [only] = (await session(a)).body.cards;
      expect(only.anteprima).toEqual(previewIntervals({ stability: 8.2, difficulty: 4.1 }, 1));
    });

    it('is each user’s own', async () => {
      setClock(MONDAY_MORNING);
      const mine = await card(alice);
      await card(bob);
      await grade(a, { cardId: mine.id, rating: 3 });
      expect((await session(longLived(bob))).body.conteggi).toEqual({ dovute: 0, nuove: 1 });
    });
  });

  describe('a grade', () => {
    it('stores a new card’s first «Bene»: stability 2.4, difficulty 4.93, two days later, and one log row', async () => {
      setClock(MONDAY_MORNING);
      const c = await card(alice);

      const response = await grade(a, { cardId: c.id, rating: 3, durataMs: 4200 });

      expect(response.status).toBe(200);
      // Her only card is graded: the whole queue is finished, so the day counts at once (Studia progress spec D7).
      expect(response.body).toEqual({
        registrata: true, prossimoRipasso: '2026-10-21', scheduledDays: 2,
        oggi: { giorno: '2026-10-19', ripassi: 1, obiettivo: 10, raggiunto: true, appenaRaggiunto: true, serie: 1 },
      });
      const state = await prisma.lingoStatoRipasso.findUniqueOrThrow({ where: { utenteId_cardId: { utenteId: alice.id, cardId: c.id } } });
      expect(state).toMatchObject({ stability: 2.4, difficulty: 4.93, reps: 1, lapses: 0 });
      expect(state.dueAt.toISOString()).toBe('2026-10-20T22:00:00.000Z'); // 00:00 on the 21st in Rome
      expect(state.lastReviewAt.toISOString()).toBe('2026-10-19T08:00:00.000Z');
      const log = await prisma.lingoRevisioneSRS.findMany();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ utenteId: alice.id, cardId: c.id, rating: 3, scheduledDays: 2, stability: 2.4, difficulty: 4.93, durataMs: 4200 });
      expect(log[0].dataRevisione.toISOString()).toBe('2026-10-19T08:00:00.000Z');
    });

    it('records no time spent when none is sent', async () => {
      setClock(MONDAY_MORNING);
      const c = await card(alice);
      await grade(a, { cardId: c.id, rating: 4 });
      expect((await prisma.lingoRevisioneSRS.findFirstOrThrow()).durataMs).toBeNull();
    });

    it('records only the first grade of a Rome day: a second answers registrata false and changes nothing', async () => {
      setClock(MONDAY_MORNING);
      const c = await card(alice);
      await grade(a, { cardId: c.id, rating: 3 });
      const before = await prisma.lingoStatoRipasso.findFirstOrThrow();

      setClock('2026-10-19T19:00:00Z'); // 21:00 the same day
      const second = await grade(a, { cardId: c.id, rating: 1 });

      expect(second.status).toBe(200);
      expect(second.body).toEqual({ registrata: false, prossimoRipasso: '2026-10-21', scheduledDays: 2 });
      expect(await prisma.lingoStatoRipasso.findFirstOrThrow()).toEqual(before);
      expect(await prisma.lingoRevisioneSRS.count()).toBe(1);
    });

    it('answers the days left on a repeated grade, counted from today', async () => {
      setClock(MONDAY_MORNING);
      const c = await card(alice);
      await grade(a, { cardId: c.id, rating: 3 });
      setClock('2026-10-19T20:00:00Z');
      const response = await grade(a, { cardId: c.id, rating: 3 });
      expect(response.body.scheduledDays).toBe(daysBetween('2026-10-19', '2026-10-21'));
    });

    it('uses the elapsed Rome days on the next day: reps up, the log grows', async () => {
      setClock(MONDAY_MORNING);
      const c = await card(alice);
      await grade(a, { cardId: c.id, rating: 3 });

      setClock('2026-10-22T08:00:00Z'); // three Rome days later
      const response = await grade(a, { cardId: c.id, rating: 3 });

      const expected = review({ stability: 2.4, difficulty: 4.93 }, 3, 3);
      expect(response.body).toMatchObject({ registrata: true, prossimoRipasso: romeDay(startOfRomeDay('2026-10-22', expected.scheduledDays)), scheduledDays: expected.scheduledDays });
      const state = await prisma.lingoStatoRipasso.findFirstOrThrow();
      expect(state).toMatchObject({ stability: expected.stability, difficulty: expected.difficulty, reps: 2, lapses: 0 });
      expect(state.dueAt.toISOString()).toBe(startOfRomeDay('2026-10-22', expected.scheduledDays).toISOString());
      expect(await prisma.lingoRevisioneSRS.count()).toBe(2);
    });

    it('treats 23:59 and 00:01 in Rome as two days: the second grade is recorded', async () => {
      setClock('2026-10-19T21:59:00Z'); // 23:59 on the 19th
      const c = await card(alice);
      expect((await grade(a, { cardId: c.id, rating: 3 })).body.registrata).toBe(true);

      setClock('2026-10-19T22:01:00Z'); // 00:01 on the 20th
      const next = await grade(a, { cardId: c.id, rating: 3 });

      expect(next.body.registrata).toBe(true);
      const expected = review({ stability: 2.4, difficulty: 4.93 }, 3, 1);
      expect(next.body.scheduledDays).toBe(expected.scheduledDays);
      expect(await prisma.lingoRevisioneSRS.count()).toBe(2);
    });

    it('treats 00:01 and 23:59 in Rome as one day', async () => {
      setClock('2026-10-18T22:01:00Z'); // 00:01 on the 19th
      const c = await card(alice);
      expect((await grade(a, { cardId: c.id, rating: 3 })).body.registrata).toBe(true);
      setClock('2026-10-19T21:59:00Z'); // 23:59 on the 19th
      expect((await grade(a, { cardId: c.id, rating: 3 })).body.registrata).toBe(false);
    });

    it('counts a lapse only for «Di nuovo» on a card seen before', async () => {
      setClock(MONDAY_MORNING);
      const first = await card(alice);
      const seen = await card(alice);
      await grade(a, { cardId: first.id, rating: 1 });
      expect((await prisma.lingoStatoRipasso.findFirstOrThrow({ where: { cardId: first.id } })).lapses).toBe(0);

      await grade(a, { cardId: seen.id, rating: 3 });
      setClock('2026-10-22T08:00:00Z');
      await grade(a, { cardId: seen.id, rating: 1 });
      const lapsed = await prisma.lingoStatoRipasso.findFirstOrThrow({ where: { cardId: seen.id } });
      expect(lapsed).toMatchObject({ lapses: 1, reps: 2 });
      // No steps in minutes: «Di nuovo» is scheduled in whole days, at least one, never today.
      const days = review({ stability: 2.4, difficulty: 4.93 }, 1, 3).scheduledDays;
      expect(days).toBeGreaterThanOrEqual(1);
      expect(lapsed.dueAt.toISOString()).toBe(startOfRomeDay('2026-10-22', days).toISOString());
    });

    it('writes one row when the same first grade arrives twice at once', async () => {
      setClock(MONDAY_MORNING);
      const c = await card(alice);
      const answers = await Promise.all([grade(a, { cardId: c.id, rating: 3 }), grade(longLived(alice, 'phone'), { cardId: c.id, rating: 3 })]);
      expect(answers.map((r) => r.status)).toEqual([200, 200]);
      expect(answers.map((r) => r.body.registrata).sort()).toEqual([false, true]);
      expect(await prisma.lingoRevisioneSRS.count()).toBe(1);
      expect(await prisma.lingoStatoRipasso.count()).toBe(1);
    });

    it('grades a community card for the reviewer alone', async () => {
      setClock(MONDAY_MORNING);
      const shared = await card(bob, 'VALIDATA');
      await request(app).put(PREFS).set(a).send({ materieComunita: ['DIRITTO_CIVILE'] });

      expect((await grade(a, { cardId: shared.id, rating: 4 })).body.registrata).toBe(true);
      expect(await prisma.lingoStatoRipasso.count({ where: { utenteId: bob.id } })).toBe(0);
      expect((await grade(longLived(bob), { cardId: shared.id, rating: 2 })).body.registrata).toBe(true);
      expect(await prisma.lingoStatoRipasso.count()).toBe(2);
    });

    it('refuses a rating that is not 1 to 4, and a body with anything else', async () => {
      setClock(MONDAY_MORNING);
      const c = await card(alice);
      const bad: unknown[] = [
        { cardId: c.id, rating: 5 },
        { cardId: c.id, rating: 0 },
        { cardId: c.id, rating: '3' },
        { cardId: c.id, rating: 2.5 },
        { cardId: c.id },
        { rating: 3 },
        { cardId: '', rating: 3 },
        { cardId: 'x'.repeat(65), rating: 3 },
        { cardId: `${c.id}\u0000`, rating: 3 },
        { cardId: c.id, rating: 3, durataMs: -1 },
        { cardId: c.id, rating: 3, durataMs: 3_600_001 },
        { cardId: c.id, rating: 3, durataMs: 1.5 },
        { cardId: c.id, rating: 3, utenteId: bob.id },
        { cardId: c.id, rating: 3, dueAt: '2030-01-01' },
      ];
      for (const body of bad) expect((await grade(a, body)).status, JSON.stringify(body)).toBe(400);
      expect((await grade(a, { cardId: c.id, rating: 3, durataMs: 3_600_000 })).status).toBe(200);
      expect(await prisma.lingoRevisioneSRS.count()).toBe(1);
    });

    it('answers 404 for another user’s draft, a missing card and a card out of scope, and writes nothing', async () => {
      setClock(MONDAY_MORNING);
      const theirs = await card(bob, 'BOZZA_PERSONALE');
      const proposed = await card(bob, 'PROPOSTA_COMMUNITY');
      const validatedOff = await card(bob, 'VALIDATA'); // community card, subject not switched on
      const archived = await card(alice, 'ARCHIVIATA');
      for (const id of [theirs.id, proposed.id, validatedOff.id, archived.id, 'no-such-card']) {
        const response = await grade(a, { cardId: id, rating: 3 });
        expect(response.status, id).toBe(404);
        expect(response.body.detail).toBe('Scheda non trovata.');
      }
      expect(await prisma.lingoStatoRipasso.count()).toBe(0);
      expect(await prisma.lingoRevisioneSRS.count()).toBe(0);
    });

    it('refuses a community card that left the pool after the session was fetched, and the next session no longer lists it', async () => {
      setClock(MONDAY_MORNING);
      const shared = await card(bob, 'VALIDATA');
      const stays = await card(bob, 'VALIDATA');
      await request(app).put(PREFS).set(a).send({ materieComunita: ['DIRITTO_CIVILE'] });
      expect(idsOf(await session(a))).toEqual([shared.id, stays.id]);

      await prisma.lingoCard.update({ where: { id: shared.id }, data: { stato: 'DA_RIVEDERE' } });

      const refused = await grade(a, { cardId: shared.id, rating: 3 });
      expect(refused.status).toBe(404);
      expect(await prisma.lingoStatoRipasso.count()).toBe(0);
      expect(await prisma.lingoRevisioneSRS.count()).toBe(0);
      expect(idsOf(await session(a))).toEqual([stays.id]);

      await prisma.lingoCard.update({ where: { id: stays.id }, data: { stato: 'ARCHIVIATA' } });
      expect((await grade(a, { cardId: stays.id, rating: 3 })).status).toBe(404);
    });

    it('refuses a community card once its subject is switched off, even one graded before', async () => {
      setClock(MONDAY_MORNING);
      const shared = await card(bob, 'VALIDATA');
      await request(app).put(PREFS).set(a).send({ materieComunita: ['DIRITTO_CIVILE'] });
      await grade(a, { cardId: shared.id, rating: 3 });
      await request(app).put(PREFS).set(a).send({ materieComunita: [] });
      setClock('2026-10-22T08:00:00Z');
      expect((await grade(a, { cardId: shared.id, rating: 3 })).status).toBe(404);
      expect(await prisma.lingoRevisioneSRS.count()).toBe(1);
    });
  });

  describe('the stored day (Studia progress spec §5.1)', () => {
    /** Today's stored row for `user` on Rome day `day`, or null. */
    async function storedDay(user: TestUser, day: string) {
      const row = await prisma.lingoGiornataStudio.findUnique({ where: { utenteId_giorno: { utenteId: user.id, giorno: new Date(`${day}T00:00:00Z`) } } });
      return row && { ripassi: row.ripassi, nuove: row.nuove, sbagliate: row.sbagliate, codaFinita: row.codaFinita, valido: row.valido };
    }

    it('counts each recorded grade into today: reviews, first reviews, wrong ones; a second grade of the day adds nothing', async () => {
      setClock(MONDAY_MORNING);
      const [one, two] = [await card(alice), await card(alice), await card(alice)];

      const first = await grade(a, { cardId: one.id, rating: 3 });
      expect(first.body.oggi).toEqual({ giorno: '2026-10-19', ripassi: 1, obiettivo: 10, raggiunto: false, appenaRaggiunto: false, serie: 0 });
      await grade(a, { cardId: two.id, rating: 1 });
      expect(await storedDay(alice, '2026-10-19')).toEqual({ ripassi: 2, nuove: 2, sbagliate: 1, codaFinita: false, valido: false });

      const again = await grade(a, { cardId: one.id, rating: 1 });
      expect(again.body).toMatchObject({ registrata: false });
      expect(again.body.oggi).toBeUndefined();
      expect(await storedDay(alice, '2026-10-19')).toEqual({ ripassi: 2, nuove: 2, sbagliate: 1, codaFinita: false, valido: false });

      // The next day the same card is not new.
      setClock('2026-10-22T08:00:00Z');
      await grade(a, { cardId: one.id, rating: 3 });
      expect(await storedDay(alice, '2026-10-22')).toEqual({ ripassi: 1, nuove: 0, sbagliate: 0, codaFinita: false, valido: false });
      expect(await storedDay(bob, '2026-10-19')).toBeNull();
    });

    it('says the goal closed on the grade that reaches N, and only on that one', async () => {
      setClock(MONDAY_MORNING);
      const cards = [];
      for (let i = 0; i < 5; i++) cards.push(await card(alice));
      await request(app).put(PREFS).set(a).send({ ripassiAlGiorno: 3 });

      const answers = [];
      for (const c of cards.slice(0, 4)) answers.push((await grade(a, { cardId: c.id, rating: 3 })).body.oggi);

      expect(answers.map((o) => o.appenaRaggiunto)).toEqual([false, false, true, false]);
      expect(answers.map((o) => o.raggiunto)).toEqual([false, false, true, true]);
      expect(answers[2]).toEqual({ giorno: '2026-10-19', ripassi: 3, obiettivo: 3, raggiunto: true, appenaRaggiunto: true, serie: 1 });
    });

    it('counts a day whose whole queue is finished with fewer than N reviews', async () => {
      setClock(MONDAY_MORNING);
      const [one, two] = [await card(alice), await card(alice)];

      expect((await grade(a, { cardId: one.id, rating: 3 })).body.oggi.raggiunto).toBe(false);
      const last = await grade(a, { cardId: two.id, rating: 3 });

      expect(last.body.oggi).toEqual({ giorno: '2026-10-19', ripassi: 2, obiettivo: 10, raggiunto: true, appenaRaggiunto: true, serie: 1 });
      expect(await storedDay(alice, '2026-10-19')).toEqual({ ripassi: 2, nuove: 2, sbagliate: 0, codaFinita: true, valido: true });
    });

    it('counts two grades racing on the day’s first row, without an error', async () => {
      setClock(MONDAY_MORNING);
      const [one, two] = [await card(alice), await card(alice), await card(alice)];

      const answers = await Promise.all([grade(a, { cardId: one.id, rating: 3 }), grade(a, { cardId: two.id, rating: 3 })]);

      expect(answers.map((r) => r.status)).toEqual([200, 200]);
      expect(answers.map((r) => r.body.oggi.ripassi).sort()).toEqual([1, 2]);
      expect(await storedDay(alice, '2026-10-19')).toMatchObject({ ripassi: 2, nuove: 2 });
    });

    it('says the goal closed exactly once when two grades race on the threshold', async () => {
      setClock(MONDAY_MORNING);
      const [one, two] = [await card(alice), await card(alice), await card(alice)];
      await request(app).put(PREFS).set(a).send({ ripassiAlGiorno: 2 });

      const answers = await Promise.all([grade(a, { cardId: one.id, rating: 3 }), grade(a, { cardId: two.id, rating: 3 })]);

      expect(answers.map((r) => r.body.oggi.appenaRaggiunto).sort()).toEqual([false, true]);
      expect(await storedDay(alice, '2026-10-19')).toMatchObject({ ripassi: 2, valido: true });
    });

    it('puts a grade at 23:59 and one at 00:01 in Rome on two days', async () => {
      const [one, two] = [await card(alice), await card(alice), await card(alice)];
      setClock('2026-10-19T21:59:00Z'); // 23:59 in Rome (CEST)
      await grade(a, { cardId: one.id, rating: 3 });
      setClock('2026-10-19T22:01:00Z'); // 00:01 on the 20th
      await grade(a, { cardId: two.id, rating: 3 });

      expect(await storedDay(alice, '2026-10-19')).toMatchObject({ ripassi: 1 });
      expect(await storedDay(alice, '2026-10-20')).toMatchObject({ ripassi: 1 });
    });

    it('counts a day with nothing to review once the session is read, once', async () => {
      setClock(MONDAY_MORNING);
      // One card, reviewed before and due next week: nothing to do today.
      const c = await card(alice);
      await stateDueOn(alice, c.id, '2026-10-25', new Date('2026-10-18T08:00:00Z'));
      await session(a);
      await session(a);
      expect(await prisma.lingoGiornataStudio.count({ where: { utenteId: alice.id } })).toBe(1);
      expect(await storedDay(alice, '2026-10-19')).toEqual({ ripassi: 0, nuove: 0, sbagliate: 0, codaFinita: true, valido: true });
    });

    it('never counts a day for someone with no card to study', async () => {
      setClock(MONDAY_MORNING);
      await session(a);
      expect(await prisma.lingoGiornataStudio.count()).toBe(0);
    });

    it('writes nothing on a session read while cards are left, or narrowed to one subject', async () => {
      setClock(MONDAY_MORNING);
      await card(alice);
      await session(a);
      const b = longLived(bob, 'b');
      await session(b, 'DIRITTO_PENALE');
      expect(await prisma.lingoGiornataStudio.count()).toBe(0);
    });

    it('recounts today when the goal changes, and leaves the past days as they were', async () => {
      setClock(MONDAY_MORNING);
      for (let i = 0; i < 5; i++) await card(alice);
      await prisma.lingoGiornataStudio.create({ data: { utenteId: alice.id, giorno: new Date('2026-10-18T00:00:00Z'), ripassi: 3, valido: true } });
      await request(app).put(PREFS).set(a).send({ ripassiAlGiorno: 3 });
      for (const c of (await prisma.lingoCard.findMany({ take: 3, orderBy: { createdAt: 'asc' } }))) await grade(a, { cardId: c.id, rating: 3 });
      expect(await storedDay(alice, '2026-10-19')).toMatchObject({ valido: true });

      await request(app).put(PREFS).set(a).send({ ripassiAlGiorno: 5 });

      expect(await storedDay(alice, '2026-10-19')).toMatchObject({ ripassi: 3, valido: false });
      expect(await storedDay(alice, '2026-10-18')).toMatchObject({ ripassi: 3, valido: true });
    });
  });

  describe('the preferences', () => {
    it('answers the defaults without creating a row', async () => {
      const response = await request(app).get(PREFS).set(a);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ nuoveAlGiorno: 20, ripassiAlGiorno: 10, materieComunita: [] });
      expect(await prisma.lingoPreferenzeStudio.count()).toBe(0);
    });

    it('stores the goal and the subjects, each on its own, and answers them', async () => {
      const goal = await request(app).put(PREFS).set(a).send({ nuoveAlGiorno: 5 });
      expect(goal.status).toBe(200);
      expect(goal.body).toEqual({ nuoveAlGiorno: 5, ripassiAlGiorno: 10, materieComunita: [] });

      const subjects = await request(app).put(PREFS).set(a).send({ materieComunita: ['DIRITTO_PENALE', 'DIRITTO_CIVILE', 'DIRITTO_PENALE'] });
      expect(subjects.body).toEqual({ nuoveAlGiorno: 5, ripassiAlGiorno: 10, materieComunita: ['DIRITTO_PENALE', 'DIRITTO_CIVILE'] });
      expect((await request(app).get(PREFS).set(a)).body).toEqual(subjects.body);
      expect((await request(app).get(PREFS).set(authHeader(bob))).body).toEqual({ nuoveAlGiorno: 20, ripassiAlGiorno: 10, materieComunita: [] });
      expect(await prisma.lingoPreferenzeStudio.count()).toBe(1);

      const both = await request(app).put(PREFS).set(a).send({ nuoveAlGiorno: 200, materieComunita: [] });
      expect(both.body).toEqual({ nuoveAlGiorno: 200, ripassiAlGiorno: 10, materieComunita: [] });

      const reviews = await request(app).put(PREFS).set(a).send({ ripassiAlGiorno: 1 });
      expect(reviews.body).toEqual({ nuoveAlGiorno: 200, ripassiAlGiorno: 1, materieComunita: [] });
      expect((await request(app).put(PREFS).set(a).send({ ripassiAlGiorno: 200 })).body.ripassiAlGiorno).toBe(200);
    });

    it('refuses what is out of range, unknown, or not the user’s to set', async () => {
      const bad: unknown[] = [
        { nuoveAlGiorno: 0 },
        { nuoveAlGiorno: 201 },
        { nuoveAlGiorno: 1.5 },
        { nuoveAlGiorno: '5' },
        { ripassiAlGiorno: 0 },
        { ripassiAlGiorno: 201 },
        { ripassiAlGiorno: 2.5 },
        { ripassiAlGiorno: '10' },
        { materieComunita: ['DIRITTO_ALIENO'] },
        { materieComunita: 'DIRITTO_CIVILE' },
        { materieComunita: Array(6).fill('DIRITTO_CIVILE') },
        { utenteId: bob.id },
        { nuoveAlGiorno: 5, updatedAt: '2030-01-01' },
      ];
      for (const body of bad) expect((await request(app).put(PREFS).set(a).send(body as object)).status, JSON.stringify(body)).toBe(400);
      expect(await prisma.lingoPreferenzeStudio.count()).toBe(0);
    });
  });

  describe('the list of cards', () => {
    const list = (who: Record<string, string>, query: Record<string, string> = {}) => request(app).get('/api/lingo/cards').query(query).set(who);

    it('gives each card its next review date, null before the first', async () => {
      setClock(MONDAY_MORNING);
      const seen = await card(alice);
      const fresh = await card(alice);
      await grade(a, { cardId: seen.id, rating: 3 });

      const response = await list(a, { ordine: 'materia' });
      const byId = Object.fromEntries(response.body.cards.map((c: { id: string; prossimoRipasso: string | null }) => [c.id, c.prossimoRipasso]));
      expect(byId).toEqual({ [seen.id]: '2026-10-21', [fresh.id]: null });
      expect((await request(app).get(`/api/lingo/cards/${seen.id}`).set(a)).body.prossimoRipasso).toBe('2026-10-21');
      expect((await request(app).get(`/api/lingo/cards/${fresh.id}`).set(a)).body.prossimoRipasso).toBeNull();
    });

    it('with dovuteOggi=true lists only the cards due up to today, and only the caller’s', async () => {
      setClock(MONDAY_MORNING);
      const overdue = await card(alice);
      const today = await card(alice);
      const tomorrow = await card(alice);
      const fresh = await card(alice);
      const someoneElses = await card(bob);
      await stateDueOn(alice, overdue.id, '2026-10-15', new Date('2026-10-10T08:00:00Z'));
      await stateDueOn(alice, today.id, '2026-10-19', new Date('2026-10-10T08:00:00Z'));
      await stateDueOn(alice, tomorrow.id, '2026-10-20', new Date('2026-10-10T08:00:00Z'));
      await stateDueOn(bob, someoneElses.id, '2026-10-15', new Date('2026-10-10T08:00:00Z'));

      const response = await list(a, { dovuteOggi: 'true' });

      expect(response.status).toBe(200);
      expect(response.body.cards.map((c: { id: string }) => c.id).sort()).toEqual([overdue.id, today.id].sort());
      expect(response.body.cards.map((c: { prossimoRipasso: string }) => c.prossimoRipasso).sort()).toEqual(['2026-10-15', '2026-10-19']);
      expect((await list(a)).body.cards).toHaveLength(4);
      expect(response.body.cards.some((c: { id: string }) => c.id === fresh.id)).toBe(false);
      expect((await list(a, { dovuteOggi: 'false' })).status).toBe(400);
    });

    it('leaves out a card that can no longer be reviewed, though its review state stays: no date either', async () => {
      setClock(MONDAY_MORNING);
      const reviewable = await card(alice, 'PROPOSTA_COMMUNITY');
      const archived = await card(alice, 'ARCHIVIATA');
      const toReview = await card(alice, 'DA_RIVEDERE');
      for (const c of [reviewable, archived, toReview]) await stateDueOn(alice, c.id, '2026-10-15', new Date('2026-10-10T08:00:00Z'));

      const due = await list(a, { dovuteOggi: 'true' });
      expect(due.body.cards.map((c: { id: string }) => c.id)).toEqual([reviewable.id]);
      expect(due.body.cards[0].prossimoRipasso).toBe('2026-10-15');
      // The session agrees with the list.
      expect(idsOf(await session(a))).toEqual([reviewable.id]);

      const all = await list(a);
      const dates = Object.fromEntries(all.body.cards.map((c: { id: string; prossimoRipasso: string | null }) => [c.id, c.prossimoRipasso]));
      expect(dates).toEqual({ [reviewable.id]: '2026-10-15', [archived.id]: null, [toReview.id]: null });
      expect((await request(app).get(`/api/lingo/cards/${archived.id}`).set(a)).body.prossimoRipasso).toBeNull();
      // The state filter still works alongside.
      expect((await list(a, { dovuteOggi: 'true', stato: 'ARCHIVIATA' })).body.cards).toEqual([]);
      expect((await list(a, { dovuteOggi: 'true', stato: 'PROPOSTA_COMMUNITY' })).body.cards).toHaveLength(1);
    });
  });

  describe('a grade racing a change to its card', () => {
    /**
     * Holds the card's row locked in another transaction (as the trash and an edit do), fires the grade, shows it
     * waiting, then lets `change` run and commit. Resolves with the grade's answer.
     */
    async function gradeWhileLocked(cardId: string, change: (tx: Prisma.TransactionClient) => Promise<unknown>) {
      let release!: () => void;
      let locked!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      const lockedNow = new Promise<void>((resolve) => (locked = resolve));
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM lingo_cards WHERE id = ${cardId} FOR UPDATE`;
          locked();
          await released;
          await change(tx);
        },
        { timeout: 20_000 },
      );
      await lockedNow;
      let settled = false;
      const pending = Promise.resolve(grade(a, { cardId, rating: 3 })).then((response) => {
        settled = true;
        return response;
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(settled, 'the grade waits for the card’s lock').toBe(false);
      release();
      await holder;
      return pending;
    }

    it('answers 404, and writes nothing, when the card is deleted meanwhile', async () => {
      setClock(MONDAY_MORNING);
      const c = await card(alice);
      const response = await gradeWhileLocked(c.id, (tx) => tx.lingoCard.delete({ where: { id: c.id } }));
      expect(response.status).toBe(404);
      expect(response.body.detail).toBe('Scheda non trovata.');
      expect(await prisma.lingoStatoRipasso.count()).toBe(0);
      expect(await prisma.lingoRevisioneSRS.count()).toBe(0);
    });

    it('sees the state the card has after the lock: archived meanwhile, it is refused', async () => {
      setClock(MONDAY_MORNING);
      const c = await card(alice);
      const response = await gradeWhileLocked(c.id, (tx) => tx.lingoCard.update({ where: { id: c.id }, data: { stato: 'ARCHIVIATA' } }));
      expect(response.status).toBe(404);
      expect(await prisma.lingoStatoRipasso.count()).toBe(0);
      expect(await prisma.lingoRevisioneSRS.count()).toBe(0);
    });
  });

  describe('a card in the trash', () => {
    const trash = (who: Record<string, string>, cardId: string) => request(app).post('/api/lingo/cards/trash').set(who).send({ cardIds: [cardId] });
    const restore = async (who: Record<string, string>) => {
      const [entry] = (await request(app).get('/api/trash').set(who)).body;
      return request(app).post(`/api/trash/${entry.id}/restore`).set(who).send({});
    };
    const reviewsOf = (cardId: string) => ({
      state: prisma.lingoStatoRipasso.findMany({ where: { cardId } }),
      log: prisma.lingoRevisioneSRS.findMany({ where: { cardId }, orderBy: [{ dataRevisione: 'asc' }, { id: 'asc' }] }),
    });
    /** A draft studied on two days (the second a lapse): one state row, two log rows. */
    async function studiedDraft() {
      setClock(MONDAY_MORNING);
      const c = await card(alice);
      await grade(a, { cardId: c.id, rating: 3, durataMs: 4200 });
      setClock('2026-10-22T08:00:00Z');
      await grade(a, { cardId: c.id, rating: 1 });
      return c;
    }

    it('keeps its review state and log, and brings them back identical when restored', async () => {
      const c = await studiedDraft();
      const before = { state: await reviewsOf(c.id).state, log: await reviewsOf(c.id).log };
      expect(before.state).toHaveLength(1);
      expect(before.log).toHaveLength(2);

      expect((await trash(a, c.id)).status).toBe(200);
      expect(await prisma.lingoStatoRipasso.count()).toBe(0);
      expect(await prisma.lingoRevisioneSRS.count()).toBe(0);

      expect((await restore(a)).status).toBe(200);
      expect(await reviewsOf(c.id).state).toEqual(before.state);
      expect(await reviewsOf(c.id).log).toEqual(before.log);
      // The card is not «nuova» again: it is not offered as new, and its date is where it was.
      expect((await request(app).get(`/api/lingo/cards/${c.id}`).set(a)).body.prossimoRipasso).toBe(romeDay(before.state[0].dueAt));
      expect((await session(a)).body.cards.some((x: { id: string; nuova: boolean }) => x.id === c.id && x.nuova)).toBe(false);
    });

    it('leaves the stored study days as they were, through the trash and back (Studia progress spec D13)', async () => {
      const c = await studiedDraft();
      const days = () => prisma.lingoGiornataStudio.findMany({ orderBy: { giorno: 'asc' } });
      const before = await days();
      expect(before).toHaveLength(2);

      await trash(a, c.id);
      expect(await days()).toEqual(before);
      await restore(a);
      expect(await days()).toEqual(before);
    });

    it('takes along only the author’s reviews, not another user’s', async () => {
      const c = await studiedDraft();
      await prisma.lingoRevisioneSRS.create({ data: { utenteId: bob.id, cardId: c.id, rating: 3, scheduledDays: 2, stability: 2.4, difficulty: 4.93 } });
      await stateDueOn(bob, c.id, '2026-10-30', new Date('2026-10-28T08:00:00Z'));

      await trash(a, c.id);
      await restore(a);

      expect(await prisma.lingoStatoRipasso.findMany({ select: { utenteId: true } })).toEqual([{ utenteId: alice.id }]);
      expect((await prisma.lingoRevisioneSRS.findMany({ select: { utenteId: true } })).map((r) => r.utenteId)).toEqual([alice.id, alice.id]);
    });

    it('restores an entry trashed before reviews were kept, a payload with the cards alone', async () => {
      const c = await card(alice);
      await trash(a, c.id);
      const entry = await prisma.trashEntry.findFirstOrThrow();
      const { cards } = entry.payload as { cards: unknown[] };
      await prisma.trashEntry.update({ where: { id: entry.id }, data: { payload: { cards } } });

      expect((await restore(a)).status).toBe(200);
      expect(await prisma.lingoCard.count({ where: { id: c.id } })).toBe(1);
      expect(await prisma.lingoStatoRipasso.count()).toBe(0);
      expect(await prisma.lingoRevisioneSRS.count()).toBe(0);
    });

    it('leaves the reviews gone when the entry is emptied', async () => {
      const c = await studiedDraft();
      await trash(a, c.id);
      const [entry] = (await request(app).get('/api/trash').set(a)).body;
      expect((await request(app).delete(`/api/trash/${entry.id}`).set(a)).status).toBe(204);
      expect(await prisma.lingoCard.count()).toBe(0);
      expect(await prisma.lingoRevisioneSRS.count()).toBe(0);
    });
  });

  describe('who may reach them', () => {
    it('refuses an exchanged token on every path', async () => {
      const token = await delegated(alice, 'lingo:cards:read');
      const c = await card(alice);
      expect((await request(app).get(SESSION).set(token)).status).toBe(403);
      expect((await request(app).post(GRADE).set(token).send({ cardId: c.id, rating: 3 })).status).toBe(403);
      expect((await request(app).get(PREFS).set(token)).status).toBe(403);
      expect((await request(app).put(PREFS).set(token).send({ nuoveAlGiorno: 5 })).status).toBe(403);
      expect((await request(app).put(PREFS).set(token).send({ ripassiAlGiorno: 5 })).status).toBe(403);
      expect((await request(app).get('/api/lingo/srs/progressi').set(token)).status).toBe(403);
      const write = await delegated(alice, 'lingo:cards:write');
      expect((await request(app).post(GRADE).set(write).send({ cardId: c.id, rating: 3 })).status).toBe(403);
      expect(await prisma.lingoRevisioneSRS.count()).toBe(0);
      expect(await prisma.lingoPreferenzeStudio.count()).toBe(0);
    });

    it('keeps the study state out of what a connected application reads of the cards', async () => {
      // The real clock: the exchanged token lives two minutes.
      const c = await card(alice);
      await grade(a, { cardId: c.id, rating: 3 });
      const token = await delegated(alice, 'lingo:cards:read');

      const one = await request(app).get(`/api/lingo/cards/${c.id}`).set(token);
      expect(one.status).toBe(200);
      expect(one.body).not.toHaveProperty('prossimoRipasso');
      const many = await request(app).get('/api/lingo/cards').set(token);
      expect(many.status).toBe(200);
      expect(many.body.cards[0]).not.toHaveProperty('prossimoRipasso');
      expect((await request(app).get('/api/lingo/cards').query({ dovuteOggi: 'true' }).set(token)).status).toBe(403);
    });
  });
});
