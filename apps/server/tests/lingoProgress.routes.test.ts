import type { LingoCardStato, LingoMateria } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from './helpers';
import { exchangeCode, startAuthorization, tokenExchange } from './oauth/oauthHelpers';
import { addDays, daysBetween, romeDay, startOfRomeDay } from '../src/lingo/studyDay';

// The Studia dashboard's read, GET /api/lingo/srs/progressi (Studia progress spec §4, §5.2).
// «Today» is the calendar day in Rome, so the clock is moved with fake Dates (timers stay real).

const PROGRESS = '/api/lingo/srs/progressi';
const GRADE = '/api/lingo/srs/revisioni';
const PREFS = '/api/lingo/srs/preferenze';

function setClock(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

// The clock jumps days in these tests, past the one-hour life of the helper's token.
function longLived(user: TestUser, jti = 'a') {
  const token = jwt.sign({ userId: user.id, email: user.email, type: 'access' }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '90d', jwtid: jti });
  return { Authorization: `Bearer ${token}` };
}

let sequence = 0;
async function card(author: TestUser | null, materia: LingoMateria = 'DIRITTO_CIVILE', stato: LingoCardStato = 'BOZZA_PERSONALE') {
  sequence += 1;
  return prisma.lingoCard.create({
    data: {
      autoreId: author?.id ?? null,
      materia,
      istituto: `Istituto ${sequence}`,
      domanda: `Domanda ${sequence}?`,
      risposta: `Risposta ${sequence}.`,
      stato,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
    },
  });
}

async function stateDueOn(user: TestUser, cardId: string, dueDay: string, lastReviewAt: Date) {
  return prisma.lingoStatoRipasso.create({
    data: { utenteId: user.id, cardId, stability: 8.2, difficulty: 4.1, dueAt: startOfRomeDay(dueDay), lastReviewAt, reps: 2 },
  });
}

async function storedRow(user: TestUser, day: string, over: { ripassi?: number; valido?: boolean } = {}) {
  return prisma.lingoGiornataStudio.create({ data: { utenteId: user.id, giorno: new Date(`${day}T00:00:00Z`), ripassi: over.ripassi ?? 0, valido: over.valido ?? false } });
}

async function delegated(user: TestUser) {
  const flow = await startAuthorization({ scope: 'lingo:cards:read lingo:cards:write' });
  const auth = authHeader(user);
  await request(app).get(`/api/oauth/requests/${flow.requestId}`).set(auth);
  const decision = await request(app).post(`/api/oauth/requests/${flow.requestId}/decision`).set(auth).send({ approve: true });
  const code = new URL(decision.body.redirectTo).searchParams.get('code')!;
  const access = (await exchangeCode(flow.clientId, code, flow.verifier)).body.access_token as string;
  const exchanged = await tokenExchange(access, { scope: 'lingo:cards:read' });
  return { Authorization: `Bearer ${exchanged.body.access_token}` };
}

const SUBJECTS = ['DIRITTO_CIVILE', 'DIRITTO_PENALE', 'DIRITTO_AMMINISTRATIVO', 'DIRITTO_PROCESSUALE_CIVILE', 'DIRITTO_PROCESSUALE_PENALE'];

describe('the progress read', () => {
  let alice: TestUser;
  let bob: TestUser;
  let a: Record<string, string>;
  const progress = (who: Record<string, string>, materia?: string) => request(app).get(PROGRESS).query(materia ? { materia } : {}).set(who);
  const gradeOn = async (day: string, cardId: string, rating = 3) => {
    setClock(`${day}T08:00:00Z`);
    const response = await request(app).post(GRADE).set(a).send({ cardId, rating });
    expect(response.status, day).toBe(200);
  };

  beforeEach(async () => {
    sequence = 0;
    alice = await createTestUser('progress-alice');
    bob = await createTestUser('progress-bob');
    a = longLived(alice);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers an empty dashboard to someone who never studied, and writes nothing', async () => {
    setClock('2026-10-19T08:00:00Z');
    const response = await progress(a);

    expect(response.status).toBe(200);
    expect(response.body.oggi).toEqual({ giorno: '2026-10-19', ripassi: 0, obiettivo: 10, raggiunto: false, dovute: 0, nuove: 0 });
    expect(response.body.serie.attuale).toBe(0);
    expect(response.body.serie.record).toBe(0);
    expect(response.body.serie.ultimiGiorni).toHaveLength(7);
    expect(response.body.stati).toEqual({ nuove: 0, apprendimento: 0, consolidate: 0 });
    expect(response.body.materie.map((m: { materia: string }) => m.materia)).toEqual(SUBJECTS);
    expect(response.body.calendario).toEqual([]);
    expect(response.body.prossimi).toHaveLength(14);
    expect(response.body.prossimi[0]).toEqual({ giorno: '2026-10-19', schede: 0 });
    expect(response.body.prossimi[13]).toEqual({ giorno: '2026-11-01', schede: 0 });
    expect(await prisma.lingoGiornataStudio.count()).toBe(0);
  });

  it('tells a history: today, the streak with a rest and a break, the calendar, the states and the coming days', async () => {
    const [c1, c2] = [await card(alice), await card(alice)];
    const c3 = await card(alice, 'DIRITTO_PENALE');
    await card(alice); // never reviewed: new
    setClock('2026-10-12T07:00:00Z');
    await request(app).put(PREFS).set(a).send({ ripassiAlGiorno: 2 });

    await gradeOn('2026-10-12', c1.id);
    await gradeOn('2026-10-12', c2.id);
    await gradeOn('2026-10-13', c1.id);
    await gradeOn('2026-10-13', c3.id, 1);
    // the 14th missed: a rest
    await gradeOn('2026-10-15', c1.id);
    await gradeOn('2026-10-15', c2.id);
    // the 16th to the 18th missed: broken
    await gradeOn('2026-10-19', c1.id);

    const response = await progress(a);
    const body = response.body;

    const states = await prisma.lingoStatoRipasso.findMany({ where: { utenteId: alice.id }, include: { card: true } });
    const dueToday = states.filter((s) => s.dueAt < startOfRomeDay('2026-10-19', 1)).length;
    expect(body.oggi).toEqual({ giorno: '2026-10-19', ripassi: 1, obiettivo: 2, raggiunto: false, dovute: dueToday, nuove: 1 });
    expect(body.serie.attuale).toBe(0);
    expect(body.serie.record).toBe(3);
    expect(body.serie.ultimiGiorni.map((d: { stato: string }) => d.stato)).toEqual(['fatto', 'riposo', 'fatto', 'saltato', 'saltato', 'saltato', 'oggi']);

    expect(body.calendario).toEqual([
      { giorno: '2026-10-12', ripassi: 2, nuove: 2, sbagliate: 0, valido: true, riposo: false },
      { giorno: '2026-10-13', ripassi: 2, nuove: 1, sbagliate: 1, valido: true, riposo: false },
      { giorno: '2026-10-14', ripassi: 0, nuove: 0, sbagliate: 0, valido: false, riposo: true },
      { giorno: '2026-10-15', ripassi: 2, nuove: 0, sbagliate: 0, valido: true, riposo: false },
      { giorno: '2026-10-19', ripassi: 1, nuove: 0, sbagliate: 0, valido: false, riposo: false },
    ]);
    expect(body.stati).toEqual({ nuove: 1, apprendimento: 3, consolidate: 0 });
    const civile = body.materie.find((m: { materia: string }) => m.materia === 'DIRITTO_CIVILE');
    const penale = body.materie.find((m: { materia: string }) => m.materia === 'DIRITTO_PENALE');
    expect(civile).toEqual({ materia: 'DIRITTO_CIVILE', nuove: 1, apprendimento: 2, consolidate: 0, ripassi30: 6 });
    expect(penale).toEqual({ materia: 'DIRITTO_PENALE', nuove: 0, apprendimento: 1, consolidate: 0, ripassi30: 1 });

    const expectedForecast = new Array(14).fill(0);
    for (const s of states) {
      const ahead = Math.max(0, daysBetween('2026-10-19', romeDay(s.dueAt)));
      if (ahead < 14) expectedForecast[ahead] += 1;
    }
    expect(body.prossimi.map((d: { schede: number }) => d.schede)).toEqual(expectedForecast);
    expect(body.prossimi.map((d: { giorno: string }) => d.giorno)).toEqual(Array.from({ length: 14 }, (_, i) => addDays('2026-10-19', i)));

    // Narrowed to the penal subject: its counts, the whole day's flags.
    const penal = (await progress(a, 'DIRITTO_PENALE')).body;
    expect(penal.calendario).toEqual([
      { giorno: '2026-10-12', ripassi: 0, nuove: 0, sbagliate: 0, valido: true, riposo: false },
      { giorno: '2026-10-13', ripassi: 1, nuove: 1, sbagliate: 1, valido: true, riposo: false },
      { giorno: '2026-10-14', ripassi: 0, nuove: 0, sbagliate: 0, valido: false, riposo: true },
      { giorno: '2026-10-15', ripassi: 0, nuove: 0, sbagliate: 0, valido: true, riposo: false },
      { giorno: '2026-10-19', ripassi: 0, nuove: 0, sbagliate: 0, valido: false, riposo: false },
    ]);
    expect(penal.stati).toEqual({ nuove: 0, apprendimento: 1, consolidate: 0 });
    expect(penal.prossimi.reduce((n: number, d: { schede: number }) => n + d.schede, 0)).toBe(1);
    expect(penal.oggi).toMatchObject({ ripassi: 1, obiettivo: 2, raggiunto: false, nuove: 0 });
    expect(penal.serie).toEqual(body.serie);
    expect(penal.materie).toEqual(body.materie);
  });

  it('splits learning and consolidated at 21 days, counts overdue cards today, and leaves out the community subjects switched off', async () => {
    setClock('2026-10-19T08:00:00Z');
    const reviewed = new Date('2026-10-19T07:00:00Z');
    const [twenty, twentyOne, overdue] = [await card(alice), await card(alice), await card(alice)];
    await stateDueOn(alice, twenty.id, '2026-11-08', reviewed);
    await stateDueOn(alice, twentyOne.id, '2026-11-09', reviewed);
    await stateDueOn(alice, overdue.id, '2026-10-10', new Date('2026-10-01T08:00:00Z'));
    const community = await card(bob, 'DIRITTO_PENALE', 'VALIDATA');
    await stateDueOn(alice, community.id, '2026-10-20', reviewed);

    const body = (await progress(a)).body;

    expect(body.stati).toEqual({ nuove: 0, apprendimento: 2, consolidate: 1 });
    expect(body.prossimi[0].schede).toBe(1);
    expect(body.prossimi[1].schede).toBe(0);

    await request(app).put(PREFS).set(a).send({ materieComunita: ['DIRITTO_PENALE'] });
    const withCommunity = (await progress(a)).body;
    expect(withCommunity.stati).toEqual({ nuove: 0, apprendimento: 3, consolidate: 1 });
    expect(withCommunity.prossimi[1].schede).toBe(1);
  });

  it('counts today as done when the queue is empty, and stores it', async () => {
    setClock('2026-10-19T08:00:00Z');
    const c = await card(alice);
    await stateDueOn(alice, c.id, '2026-10-25', new Date('2026-10-18T08:00:00Z'));

    const body = (await progress(a)).body;

    expect(body.oggi).toMatchObject({ ripassi: 0, raggiunto: true });
    expect(body.serie.attuale).toBe(1);
    expect(await prisma.lingoGiornataStudio.count({ where: { utenteId: alice.id, valido: true } })).toBe(1);
  });

  it('starts the calendar on the Monday 25 weeks before this week, and shows no one else’s days', async () => {
    setClock('2026-10-21T08:00:00Z'); // a Wednesday: this week's Monday is the 19th, the calendar starts on 27 April
    // Not counted days, so that no rest day follows them.
    await storedRow(alice, '2026-04-26', { ripassi: 5 });
    await storedRow(alice, '2026-04-27', { ripassi: 4 });
    await storedRow(bob, '2026-10-20', { ripassi: 9, valido: true });

    const body = (await progress(a)).body;

    expect(new Date('2026-04-27T00:00:00Z').getUTCDay()).toBe(1);
    expect(body.calendario.map((d: { giorno: string }) => d.giorno)).toEqual(['2026-04-27']);
  });

  it('reads a review’s Rome day in SQL as romeDay does, across both clock changes', async () => {
    const c = await card(alice, 'DIRITTO_PENALE');
    const instants = [
      '2026-10-24T21:30:00Z', '2026-10-24T22:30:00Z', '2026-10-24T23:30:00Z',
      '2026-10-25T21:30:00Z', '2026-10-25T22:30:00Z', '2026-10-25T23:30:00Z',
      '2026-10-26T21:30:00Z', '2026-10-26T23:30:00Z',
    ];
    for (const at of instants) {
      await prisma.lingoRevisioneSRS.create({ data: { utenteId: alice.id, cardId: c.id, dataRevisione: new Date(at), rating: 3, scheduledDays: 1, stability: 1, difficulty: 5 } });
    }
    const days = [...new Set(instants.map((at) => romeDay(new Date(at))))];
    const utcDays = [...new Set(instants.map((at) => at.slice(0, 10)))];
    for (const day of new Set([...days, ...utcDays])) await storedRow(alice, day);
    setClock('2026-10-28T08:00:00Z');

    const body = (await progress(a, 'DIRITTO_PENALE')).body;

    const counted = Object.fromEntries(body.calendario.map((d: { giorno: string; ripassi: number }) => [d.giorno, d.ripassi]));
    const expected: Record<string, number> = {};
    for (const at of instants) expected[romeDay(new Date(at))] = (expected[romeDay(new Date(at))] ?? 0) + 1;
    for (const [day, n] of Object.entries(counted)) expect(n, day).toBe(expected[day] ?? 0);
    expect(body.materie.find((m: { materia: string }) => m.materia === 'DIRITTO_PENALE').ripassi30).toBe(instants.length);
  });

  it('reads the start of summer time in SQL as romeDay does', async () => {
    const c = await card(alice, 'DIRITTO_PENALE');
    const instants = ['2027-03-27T22:30:00Z', '2027-03-27T23:30:00Z', '2027-03-28T21:30:00Z', '2027-03-28T22:30:00Z'];
    for (const at of instants) {
      await prisma.lingoRevisioneSRS.create({ data: { utenteId: alice.id, cardId: c.id, dataRevisione: new Date(at), rating: 3, scheduledDays: 1, stability: 1, difficulty: 5 } });
    }
    for (const day of ['2027-03-27', '2027-03-28', '2027-03-29']) await storedRow(alice, day);
    setClock('2027-03-30T08:00:00Z');
    a = longLived(alice); // signed under the moved clock: the first one has expired by then

    const body = (await progress(a, 'DIRITTO_PENALE')).body;

    const counted = Object.fromEntries(body.calendario.map((d: { giorno: string; ripassi: number }) => [d.giorno, d.ripassi]));
    expect(counted).toEqual({ '2027-03-27': 1, '2027-03-28': 2, '2027-03-29': 1 });
  });

  it('recounts today with the goal in force, whatever the stored row says', async () => {
    setClock('2026-10-19T08:00:00Z');
    for (let i = 0; i < 3; i++) await card(alice);
    await storedRow(alice, '2026-10-19', { ripassi: 3, valido: true });
    // The goal raised behind the routes' back: the stored row still says the day counts.
    await prisma.lingoPreferenzeStudio.create({ data: { utenteId: alice.id, ripassiAlGiorno: 5 } });

    const body = (await progress(a)).body;

    expect(body.oggi).toMatchObject({ ripassi: 3, obiettivo: 5, raggiunto: false });
    expect(body.serie.attuale).toBe(0);
    expect(body.serie.ultimiGiorni.at(-1).stato).toBe('oggi');
    expect(body.calendario.at(-1)).toMatchObject({ giorno: '2026-10-19', valido: false });
  });

  it('counts the last 30 Rome days from midnight in Rome, as an instant', async () => {
    const c = await card(alice, 'DIRITTO_PENALE');
    // On 28 October the window starts on 29 September, 00:00 in Rome: 22:00 UTC on the 28th (summer time).
    for (const at of ['2026-09-28T21:59:00Z', '2026-09-28T22:01:00Z']) {
      await prisma.lingoRevisioneSRS.create({ data: { utenteId: alice.id, cardId: c.id, dataRevisione: new Date(at), rating: 3, scheduledDays: 1, stability: 1, difficulty: 5 } });
    }
    setClock('2026-10-28T08:00:00Z');

    const body = (await progress(a)).body;

    expect(body.materie.find((m: { materia: string }) => m.materia === 'DIRITTO_PENALE').ripassi30).toBe(1);
  });

  it('is not open to a connected application', async () => {
    const response = await request(app).get(PROGRESS).set(await delegated(alice));
    expect(response.status).toBe(403);
  });

  it('refuses an unknown subject', async () => {
    expect((await progress(a, 'DIRITTO_ALIENO')).status).toBe(400);
  });
});
