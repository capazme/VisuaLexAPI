import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from './helpers';
import { exchangeCode, startAuthorization, tokenExchange } from './oauth/oauthHelpers';
import { startOfRomeDay } from '../src/lingo/studyDay';

// GET /api/lingo/srs/conteggi (G-356): today's counts for another page, read only. Unlike /sessione and
// /progressi it never marks the day's queue finished, settles a mission or credits points.

const CONTEGGI = '/api/lingo/srs/conteggi';

function setClock(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

function longLived(user: TestUser) {
  const token = jwt.sign({ userId: user.id, email: user.email, type: 'access' }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '90d', jwtid: 'c' });
  return { Authorization: `Bearer ${token}` };
}

async function card(author: TestUser, istituto: string) {
  return prisma.lingoCard.create({
    data: { autoreId: author.id, materia: 'DIRITTO_CIVILE', istituto, domanda: `${istituto}?`, risposta: `${istituto}.`, stato: 'BOZZA_PERSONALE' },
  });
}

async function due(user: TestUser, istituto: string, dueDay: string) {
  const c = await card(user, istituto);
  await prisma.lingoStatoRipasso.create({
    data: { utenteId: user.id, cardId: c.id, stability: 8, difficulty: 4, dueAt: startOfRomeDay(dueDay), lastReviewAt: new Date('2026-10-10T08:00:00Z'), reps: 2 },
  });
}

/** Every row the study day and the missions could write, for this user. */
async function writtenRows(user: TestUser) {
  const [giornate, crediti, preferenze] = await Promise.all([
    prisma.lingoGiornataStudio.count({ where: { utenteId: user.id } }),
    prisma.lingoCreditoXp.count({ where: { utenteId: user.id } }),
    prisma.lingoPreferenzeStudio.count({ where: { utenteId: user.id } }),
  ]);
  return { giornate, crediti, preferenze };
}

describe('today’s counts, read only', () => {
  let alice: TestUser;
  let a: Record<string, string>;

  beforeEach(async () => {
    alice = await createTestUser('conteggi-alice');
    a = longLived(alice);
    setClock('2026-10-21T08:00:00Z');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts the cards due today and the new ones today allows, as the session does', async () => {
    await due(alice, 'Possesso', '2026-10-20');
    await due(alice, 'Usucapione', '2026-10-21');
    await due(alice, 'Servitù', '2026-10-22'); // tomorrow: not today's
    for (const istituto of ['Mutuo', 'Comodato', 'Deposito']) await card(alice, istituto);

    const counts = await request(app).get(CONTEGGI).set(a);
    expect(counts.status).toBe(200);
    expect(counts.body).toEqual({ giorno: '2026-10-21', dovute: 2, nuove: 3 });

    const session = await request(app).get('/api/lingo/srs/sessione').set(a);
    expect(session.body.conteggi).toEqual({ dovute: counts.body.dovute, nuove: counts.body.nuove });
  });

  it('caps the new cards at what today still allows', async () => {
    await request(app).put('/api/lingo/srs/preferenze').set(a).send({ nuoveAlGiorno: 2 });
    for (const istituto of ['Mutuo', 'Comodato', 'Deposito']) await card(alice, istituto);
    expect((await request(app).get(CONTEGGI).set(a)).body.nuove).toBe(2);
  });

  it('writes nothing, where the session marks the finished day', async () => {
    // A finished queue (a card reviewed before, due tomorrow; nothing new): the session would mark today
    // finished and settle its missions.
    await due(alice, 'Servitù', '2026-10-22');
    const before = await writtenRows(alice);
    const counts = await request(app).get(CONTEGGI).set(a);
    expect(counts.body).toEqual({ giorno: '2026-10-21', dovute: 0, nuove: 0 });
    expect(await writtenRows(alice)).toEqual(before);

    await request(app).get('/api/lingo/srs/sessione').set(a);
    const after = await writtenRows(alice);
    expect(after.giornate).toBeGreaterThan(before.giornate); // the difference is the session's
  });

  it('takes no parameters, needs a session, and is not open to a connected application', async () => {
    expect((await request(app).get(CONTEGGI).query({ materia: 'DIRITTO_CIVILE' }).set(a)).status).toBe(400);
    expect((await request(app).get(CONTEGGI)).status).toBe(401);

    vi.useRealTimers();
    const flow = await startAuthorization({ scope: 'lingo:cards:read lingo:cards:write' });
    const auth = authHeader(alice);
    await request(app).get(`/api/oauth/requests/${flow.requestId}`).set(auth);
    const decision = await request(app).post(`/api/oauth/requests/${flow.requestId}/decision`).set(auth).send({ approve: true });
    const code = new URL(decision.body.redirectTo).searchParams.get('code')!;
    const access = (await exchangeCode(flow.clientId, code, flow.verifier)).body.access_token as string;
    const exchanged = await tokenExchange(access, { scope: 'lingo:cards:read' });
    expect((await request(app).get(CONTEGGI).set({ Authorization: `Bearer ${exchanged.body.access_token}` })).status).toBe(403);
  });
});
