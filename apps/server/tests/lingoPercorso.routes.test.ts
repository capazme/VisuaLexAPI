import type { LingoCardStato, LingoMateria } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from './helpers';
import { exchangeCode, startAuthorization, tokenExchange } from './oauth/oauthHelpers';
import { startOfRomeDay } from '../src/lingo/studyDay';

// The read by institute, GET /api/lingo/srs/percorso (Gymnasium restyle spec §6, G5).
// «Today» is the calendar day in Rome, so the clock is moved with fake Dates (timers stay real).

const PERCORSO = '/api/lingo/srs/percorso';
const PREFS = '/api/lingo/srs/preferenze';

function setClock(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

async function card(author: TestUser | null, istituto: string, over: { materia?: LingoMateria; stato?: LingoCardStato } = {}) {
  return prisma.lingoCard.create({
    data: {
      autoreId: author?.id ?? null,
      materia: over.materia ?? 'DIRITTO_CIVILE',
      istituto,
      domanda: `Domanda su ${istituto}?`,
      risposta: `Risposta su ${istituto}.`,
      stato: over.stato ?? 'BOZZA_PERSONALE',
    },
  });
}

/** A review state of `user` on `cardId`: due on `dueDay`, last reviewed at `lastReviewAt`. */
async function state(user: TestUser, cardId: string, dueDay: string, lastReviewAt: string) {
  return prisma.lingoStatoRipasso.create({
    data: { utenteId: user.id, cardId, stability: 8, difficulty: 4, dueAt: startOfRomeDay(dueDay), lastReviewAt: new Date(lastReviewAt), reps: 2 },
  });
}

// The clock jumps days in these tests, past the one-hour life of the helper's token.
function longLived(user: TestUser) {
  const token = jwt.sign({ userId: user.id, email: user.email, type: 'access' }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '90d', jwtid: 'a' });
  return { Authorization: `Bearer ${token}` };
}

describe('the read by institute', () => {
  let alice: TestUser;
  let bob: TestUser;
  let a: Record<string, string>;
  const percorso = (materia?: string) => request(app).get(PERCORSO).query(materia ? { materia } : {}).set(a);

  beforeEach(async () => {
    alice = await createTestUser('percorso-alice');
    bob = await createTestUser('percorso-bob');
    a = longLived(alice);
    setClock('2026-10-19T08:00:00Z');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers an empty list to someone with no cards', async () => {
    const response = await percorso();
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('is for the user’s session only: an exchanged token answers 403', async () => {
    const flow = await startAuthorization({ scope: 'lingo:cards:read lingo:cards:write' });
    const auth = authHeader(alice);
    await request(app).get(`/api/oauth/requests/${flow.requestId}`).set(auth);
    const decision = await request(app).post(`/api/oauth/requests/${flow.requestId}/decision`).set(auth).send({ approve: true });
    const code = new URL(decision.body.redirectTo).searchParams.get('code')!;
    const access = (await exchangeCode(flow.clientId, code, flow.verifier)).body.access_token as string;
    const exchanged = await tokenExchange(access, { scope: 'lingo:cards:read' });
    const response = await request(app).get(PERCORSO).set({ Authorization: `Bearer ${exchanged.body.access_token}` });
    expect(response.status).toBe(403);
  });

  it('needs a session and refuses an unknown subject', async () => {
    expect((await request(app).get(PERCORSO)).status).toBe(401);
    const unknown = await percorso('DIRITTO_INVENTATO');
    expect(unknown.status).toBe(400);
    expect(JSON.stringify(unknown.body)).toContain('Materia non valida.');
  });

  it('opens a session whose counts agree with the stop it was taken from', async () => {
    const odd = 'Risoluzione per inadempimento (art. 1453) — è “così”';
    const [due, later] = [await card(alice, odd), await card(alice, odd)];
    await card(alice, odd);
    await card(alice, 'Altro istituto');
    await state(alice, due.id, '2026-10-15', '2026-10-10T07:00:00Z');
    await state(alice, later.id, '2026-10-25', '2026-10-19T07:00:00Z');

    const stop = (await percorso()).body.find((s: { istituto: string }) => s.istituto === odd);
    const response = await request(app).get('/api/lingo/srs/sessione').query({ materia: stop.materia, istituto: stop.istituto }).set(a);

    expect(response.status).toBe(200);
    expect(response.body.conteggi).toEqual({ dovute: stop.dovute, nuove: stop.nuove });
    expect(response.body.cards).toHaveLength(stop.dovute + stop.nuove);
    expect(response.body.cards.every((c: { istituto: string }) => c.istituto === odd)).toBe(true);
  });

  it('splits an institute into new, learning, consolidated and due', async () => {
    const [fresh, learning, overdue, solid] = [
      await card(alice, 'Risoluzione'),
      await card(alice, 'Risoluzione'),
      await card(alice, 'Risoluzione'),
      await card(alice, 'Risoluzione'),
    ];
    expect(fresh.id).toBeTruthy();
    await state(alice, learning.id, '2026-10-25', '2026-10-19T07:00:00Z'); // 6 days: learning, not due
    await state(alice, overdue.id, '2026-10-15', '2026-10-10T07:00:00Z'); // 5 days: learning, overdue
    await state(alice, solid.id, '2026-11-20', '2026-10-19T07:00:00Z'); // 32 days: consolidated, not due

    const response = await percorso();
    expect(response.body).toEqual([
      { materia: 'DIRITTO_CIVILE', istituto: 'Risoluzione', nuove: 1, apprendimento: 2, consolidate: 1, dovute: 1 },
    ]);
  });

  it('counts a consolidated card that is due, and the 21-day edge', async () => {
    const [due, edge, below] = [await card(alice, 'Usucapione'), await card(alice, 'Usucapione'), await card(alice, 'Usucapione')];
    await state(alice, due.id, '2026-10-19', '2026-09-01T07:00:00Z'); // 48 days, due today
    await state(alice, edge.id, '2026-11-09', '2026-10-19T07:00:00Z'); // exactly 21 days
    await state(alice, below.id, '2026-11-08', '2026-10-19T07:00:00Z'); // 20 days

    const [row] = (await percorso()).body;
    expect(row).toEqual({ materia: 'DIRITTO_CIVILE', istituto: 'Usucapione', nuove: 0, apprendimento: 1, consolidate: 2, dovute: 1 });
  });

  it('counts the user’s own cards in review states, not archived or «da rivedere» ones', async () => {
    await card(alice, 'Proprie', { stato: 'BOZZA_PERSONALE' });
    await card(alice, 'Proprie', { stato: 'PROPOSTA_COMMUNITY' });
    await card(alice, 'Proprie', { stato: 'VALIDATA' });
    await card(alice, 'Proprie', { stato: 'ARCHIVIATA' });
    await card(alice, 'Proprie', { stato: 'DA_RIVEDERE' });
    await card(bob, 'Altrui', { stato: 'BOZZA_PERSONALE' }); // someone else's draft

    const response = await percorso();
    expect(response.body).toEqual([
      { materia: 'DIRITTO_CIVILE', istituto: 'Proprie', nuove: 3, apprendimento: 0, consolidate: 0, dovute: 0 },
    ]);
  });

  it('counts validated community cards only in the subjects switched on, and with no author', async () => {
    await card(bob, 'Civile comunitaria', { stato: 'VALIDATA', materia: 'DIRITTO_CIVILE' });
    await card(null, 'Penale comunitaria', { stato: 'VALIDATA', materia: 'DIRITTO_PENALE' });
    await card(bob, 'Proposta comunitaria', { stato: 'PROPOSTA_COMMUNITY', materia: 'DIRITTO_CIVILE' });

    expect((await percorso()).body).toEqual([]);

    await request(app).put(PREFS).set(a).send({ materieComunita: ['DIRITTO_PENALE'] });
    expect((await percorso()).body.map((r: { istituto: string }) => r.istituto)).toEqual(['Penale comunitaria']);

    await request(app).put(PREFS).set(a).send({ materieComunita: ['DIRITTO_PENALE', 'DIRITTO_CIVILE'] });
    expect((await percorso()).body.map((r: { istituto: string }) => r.istituto)).toEqual(['Civile comunitaria', 'Penale comunitaria']);
  });

  it('narrows to a subject, and groups the same institute name in two subjects apart', async () => {
    await card(alice, 'Prova', { materia: 'DIRITTO_CIVILE' });
    await card(alice, 'Prova', { materia: 'DIRITTO_PENALE' });

    expect((await percorso()).body).toHaveLength(2);
    const narrowed = await percorso('DIRITTO_PENALE');
    expect(narrowed.body).toEqual([{ materia: 'DIRITTO_PENALE', istituto: 'Prova', nuove: 1, apprendimento: 0, consolidate: 0, dovute: 0 }]);
  });

  it('keeps another user’s progress out: a community card is new for me when only they reviewed it', async () => {
    const shared = await card(bob, 'Condivisa', { stato: 'VALIDATA' });
    await state(bob, shared.id, '2026-10-19', '2026-10-18T07:00:00Z');
    await request(app).put(PREFS).set(a).send({ materieComunita: ['DIRITTO_CIVILE'] });

    expect((await percorso()).body).toEqual([
      { materia: 'DIRITTO_CIVILE', istituto: 'Condivisa', nuove: 1, apprendimento: 0, consolidate: 0, dovute: 0 },
    ]);
  });

  it('drops a card out of scope even when its review state exists (archived after being studied)', async () => {
    const gone = await card(alice, 'Archiviata', { stato: 'ARCHIVIATA' });
    await state(alice, gone.id, '2026-10-10', '2026-10-09T07:00:00Z');

    expect((await percorso()).body).toEqual([]);
  });

  it('turns over at midnight in Rome: a card due tomorrow is due at 00:00 there, 22:00 UTC the evening before', async () => {
    const c = await card(alice, 'Mezzanotte');
    await state(alice, c.id, '2026-10-20', '2026-10-19T07:00:00Z');

    setClock('2026-10-19T21:59:00Z'); // 23:59 on the 19th in Rome (CEST, UTC+2)
    expect((await percorso()).body[0].dovute).toBe(0);

    setClock('2026-10-19T22:00:00Z'); // 00:00 on the 20th
    expect((await percorso()).body[0].dovute).toBe(1);
  });

  it('turns over at 23:00 UTC in winter (CET) and follows the clock change', async () => {
    const c = await card(alice, 'Inverno');
    await state(alice, c.id, '2026-11-02', '2026-10-30T07:00:00Z');

    setClock('2026-11-01T22:59:00Z'); // 23:59 on the 1st in Rome (CET, UTC+1)
    expect((await percorso()).body[0].dovute).toBe(0);

    setClock('2026-11-01T23:00:00Z');
    expect((await percorso()).body[0].dovute).toBe(1);
  });

  it('orders by subject, then institute', async () => {
    await card(alice, 'Zeta', { materia: 'DIRITTO_CIVILE' });
    await card(alice, 'Alfa', { materia: 'DIRITTO_PENALE' });
    await card(alice, 'Beta', { materia: 'DIRITTO_CIVILE' });

    expect((await percorso()).body.map((r: { istituto: string }) => r.istituto)).toEqual(['Beta', 'Zeta', 'Alfa']);
  });
});
