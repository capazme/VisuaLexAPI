import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELEGATED_ROUTES } from '../src/oauth/delegatedRoutes';
import { delegated } from './delegatedHelper';
import { GRADE, PROGRESS, SESSION, card, createTestUser, credits, makeValidator, prisma, propose, request, app, session, setClock, type TestUser } from './xpHelpers';

// Forging XP (Gymnasium XP spec §8): the client sends no point, mission or day; no route an exchanged token
// reaches settles missions or reads XP; the server's clock decides the day.

const TODAY = '2026-10-20';
let alice: TestUser;
beforeEach(async () => {
  setClock(`${TODAY}T08:00:00Z`);
  alice = await createTestUser('xp_forge');
});
afterEach(() => {
  vi.useRealTimers();
});

describe('what the client sends', () => {
  it('refuses points, a mission or a day in a grade, a proposal or a vote, and writes nothing', async () => {
    const a = session(alice);
    const own = await card(alice);
    const forged = { punti: 1000, missione: 'consolida', giorno: '2026-10-19' };
    expect((await request(app).post(GRADE).set(a).send({ cardId: own.id, rating: 3, ...forged })).status).toBe(400);
    expect((await request(app).post(`/api/lingo/cards/${own.id}/proponi`).set(a).send(forged)).status).toBe(400);
    const carol = await makeValidator('xp_forge_carol');
    const theirs = await card(alice, 'DIRITTO_CIVILE', 'PROPOSTA_COMMUNITY');
    expect((await request(app).post(`/api/lingo/validazione/${theirs.id}`).set(session(carol, 'c')).send({ giudizio: 'APPROVATA', ...forged })).status).toBe(400);
    expect(await credits(alice)).toEqual([]);
    expect(await credits(carol)).toEqual([]);
    expect(await prisma.lingoRevisioneSRS.count()).toBe(0);
  });

  it('dates a credit by the server’s clock, whatever the client’s', async () => {
    const own = await card(alice);
    const response = await request(app).post(GRADE).set(session(alice)).set('Date', 'Mon, 01 Jan 2024 00:00:00 GMT').send({ cardId: own.id, rating: 3 });
    expect(response.status).toBe(200);
    const rows = await credits(alice);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.giorno.toISOString().slice(0, 10)).toBe(TODAY);
  });
});

describe('an exchanged token', () => {
  it('cannot read XP or earn it', async () => {
    const token = await delegated(alice, 'lingo:cards:write');
    const own = await card(alice);
    expect((await request(app).get(PROGRESS).set(token)).status).toBe(403);
    expect((await request(app).get(SESSION).set(token)).status).toBe(403);
    expect((await request(app).post(GRADE).set(token).send({ cardId: own.id, rating: 3 })).status).toBe(403);
    expect((await request(app).post(`/api/lingo/cards/${own.id}/proponi`).set(token).send({})).status).toBe(403);
    expect((await request(app).post(`/api/lingo/validazione/${own.id}`).set(token).send({ giudizio: 'APPROVATA' })).status).toBe(403);
    expect(await credits(alice)).toEqual([]);
    // The session itself still can.
    expect((await propose(session(alice), own.id)).body.xp.crediti).toHaveLength(1);
  });

  it('reaches no route that settles missions: the delegated table names none', () => {
    const settling = (path: string) => path.startsWith('/lingo/srs') || path.startsWith('/lingo/validazione') || path.endsWith('/proponi');
    expect(DELEGATED_ROUTES.filter((route) => settling(route.path))).toEqual([]);
  });

  it('reaches none of the courses’ study routes: only the assistant’s five rows are delegated (Percorsi §10.6)', () => {
    expect(DELEGATED_ROUTES.filter((route) => route.path.startsWith('/lingo/corsi')).map((route) => `${route.method} ${route.path}`).sort()).toEqual([
      'GET /lingo/corsi', 'GET /lingo/corsi/:id/struttura', 'POST /lingo/corsi', 'POST /lingo/corsi/:id/esami', 'POST /lingo/corsi/:id/moduli',
    ]);
  });
});

describe('who calls settleMissions', () => {
  it('is only the session’s grade, proposal, vote and reads, and the courses’ study routes and course page', () => {
    const root = join(__dirname, '../src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.ts')) files.push(path);
      }
    };
    walk(root);
    const callers = files.filter((f) => !f.endsWith('lingo/missions.ts') && /import\s*{[^}]*\bsettleMissions\b[^}]*}\s*from/.test(readFileSync(f, 'utf8'))).map((f) => relative(root, f)).sort();
    expect(callers).toEqual(['lingo/coursePage.ts', 'lingo/courseStudy.ts', 'lingo/progress.ts', 'routes/lingoCards.ts', 'routes/lingoSrs.ts', 'routes/lingoValidazione.ts']);
  });
});
