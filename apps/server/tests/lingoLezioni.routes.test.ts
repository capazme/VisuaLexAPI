import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LingoMateria } from '../src/lib/db';
import { delegated } from './delegatedHelper';
import { app, createTestUser, credits, prisma, request, session, setClock, type Headers, type TestUser } from './xpHelpers';
import { LESSONS_PER_DAY, LESSON_MIN_CARDS } from '../src/lingo/lessons';
import { LESSON_MISSION, settleMissions } from '../src/lingo/missions';

// LC63, the short lesson: 5–8 exercises built by the server from the cards of the review scope, graded by the server,
// and 10 XP for a finished lesson, three a Rome day, settled by `settleMissions` and never sent by the browser.

const LESSONS = '/api/lingo/lezioni';
const TODAY = '2026-11-17';

let alice: TestUser;
let a: Headers;
beforeEach(async () => {
  setClock(`${TODAY}T08:00:00Z`);
  alice = await createTestUser('lezione_alice');
  a = session(alice);
});
afterEach(() => {
  vi.useRealTimers();
});

let n = 0;
const ARTICLES = ['1453', '1218', '2043', '1321', '1418', '1176', '2697', '1337', '1490', '832'];
const WORDS = ['inadempimento', 'responsabilità', 'risarcimento', 'contratto', 'obbligazione', 'possesso', 'proprietà', 'buona fede', 'diligenza', 'garanzia'];
/** A card with an anchor and an answer of real words, so every kind of exercise can be built. */
async function richCard(author: TestUser | null, materia: LingoMateria = 'DIRITTO_CIVILE', stato: 'BOZZA_PERSONALE' | 'VALIDATA' = 'BOZZA_PERSONALE') {
  const i = n++ % ARTICLES.length;
  return prisma.lingoCard.create({
    data: {
      autoreId: author?.id ?? null,
      materia,
      istituto: `Istituto ${n}`,
      domanda: `Che cosa dice la norma numero ${n}?`,
      risposta: `La disciplina della ${WORDS[i]} secondo la regola ${n}.`,
      stato,
      ancore: {
        create: [{ normaKey: 'codice_civile', articleId: `art_${ARTICLES[i]}`, urn: `urn:nir:stato:codice.civile:1942;262~art${ARTICLES[i]}`, aknFingerprint: 'a'.repeat(64), isPrimary: true }],
      },
    },
  });
}

/** A lesson draws on validated cards only (L-67): the fixtures' default. */
async function richCards(author: TestUser, count: number, materia: LingoMateria = 'DIRITTO_CIVILE', stato: 'BOZZA_PERSONALE' | 'VALIDATA' = 'VALIDATA') {
  for (let i = 0; i < count; i++) await richCard(author, materia, stato);
}

const create = (h: Headers, materia: LingoMateria = 'DIRITTO_CIVILE') => request(app).post(LESSONS).set(h).send({ materia });
const answer = (h: Headers, id: string, indice: number, risposta: unknown) => request(app).post(`${LESSONS}/${id}/risposte`).set(h).send({ indice, risposta });

type Stored = { tipo: string; giusta: unknown };
async function keys(id: string): Promise<Stored[]> {
  const row = await prisma.lingoLezione.findUniqueOrThrow({ where: { id } });
  return row.esercizi as unknown as Stored[];
}

/** A wrong answer of the right shape for each kind. */
function wrong(ex: Stored): unknown {
  if (ex.tipo === 'vero-falso') return !(ex.giusta as boolean);
  if (ex.tipo === 'abbina') return [...(ex.giusta as number[])].reverse();
  return ((ex.giusta as number) + 1) % 4;
}

/** Answers every exercise right; returns the last answer. */
async function finish(h: Headers, id: string) {
  const stored = await keys(id);
  let last;
  for (let i = 0; i < stored.length; i++) last = await answer(h, id, i, stored[i].giusta);
  return last!;
}

describe('POST /api/lingo/lezioni', () => {
  it('builds 5 to 8 exercises from the subject\'s cards and never sends their keys', async () => {
    await richCards(alice, 6);
    const response = await create(a);
    expect(response.status).toBe(201);
    const { id, materia, esercizi } = response.body;
    expect(materia).toBe('DIRITTO_CIVILE');
    expect(esercizi.length).toBeGreaterThanOrEqual(5);
    expect(esercizi.length).toBeLessThanOrEqual(8);
    for (const ex of esercizi) expect(['scelta', 'vero-falso', 'abbina', 'completa']).toContain(ex.tipo);
    expect(JSON.stringify(response.body)).not.toMatch(/giusta/);
    // The keys are the server's.
    const stored = await keys(id);
    expect(stored).toHaveLength(esercizi.length);
    for (const ex of stored) expect(ex.giusta).not.toBeUndefined();
  });

  it('builds the kinds from the cards\' words: a choice holds the card\'s answer, a match its article and institute', async () => {
    await richCards(alice, 8);
    for (let tries = 0; tries < 5; tries++) {
      const { body } = await create(a);
      for (const ex of body.esercizi) {
        if (ex.tipo === 'scelta') expect(ex.opzioni).toHaveLength(4);
        if (ex.tipo === 'completa') {
          expect(ex.testo).toContain('_____');
          expect(ex.opzioni).toHaveLength(4);
        }
        if (ex.tipo === 'abbina') {
          expect(ex.norme.length).toBe(ex.istituti.length);
          for (const norma of ex.norme) expect(norma).toMatch(/^art\. \d+ codice civile$/);
        }
      }
    }
  });

  it(`refuses a subject with fewer than ${LESSON_MIN_CARDS} cards in the review scope, saying so`, async () => {
    await richCards(alice, LESSON_MIN_CARDS - 1);
    const response = await create(a);
    expect(response.status).toBe(409);
    expect(response.body.detail ?? response.body.error ?? response.body.message).toMatch(/almeno 4 schede/);
    expect(await prisma.lingoLezione.count()).toBe(0);
  });

  it('never takes another person\'s draft, and takes the community\'s validated cards only in the subjects switched on', async () => {
    const bob = await createTestUser('lezione_bob');
    await richCards(alice, LESSON_MIN_CARDS - 1);
    await richCards(bob, 6, 'DIRITTO_CIVILE', 'BOZZA_PERSONALE');
    expect((await create(a)).status).toBe(409);
    for (let i = 0; i < 3; i++) await richCard(bob, 'DIRITTO_CIVILE', 'VALIDATA');
    expect((await create(a)).status).toBe(409);
    await prisma.lingoPreferenzeStudio.create({ data: { utenteId: alice.id, materieComunita: ['DIRITTO_CIVILE'] } });
    expect((await create(a)).status).toBe(201);
  });

  it('never takes one\'s own cards that are not validated (L-67)', async () => {
    await richCards(alice, 6, 'DIRITTO_CIVILE', 'BOZZA_PERSONALE');
    await richCards(alice, LESSON_MIN_CARDS - 1);
    const refused = await create(a);
    expect(refused.status).toBe(409);
    expect(refused.body.detail).toMatch(/almeno 4 schede validate.*ne hai 3/);
    await richCards(alice, 1);
    expect((await create(a)).status).toBe(201);
  });

  it('reads only a subject: anything else is a 400', async () => {
    await richCards(alice, 6);
    expect((await request(app).post(LESSONS).set(a).send({})).status).toBe(400);
    expect((await request(app).post(LESSONS).set(a).send({ materia: 'DIRITTO_ROMANO' })).status).toBe(400);
    expect((await request(app).post(LESSONS).set(a).send({ materia: 'DIRITTO_CIVILE', punti: 100 })).status).toBe(400);
  });

  it(`stops at ${LESSONS_PER_DAY} lessons a Rome day`, async () => {
    await richCards(alice, 4);
    for (let i = 0; i < LESSONS_PER_DAY; i++) expect((await create(a)).status).toBe(201);
    expect((await create(a)).status).toBe(429);
    setClock('2026-11-18T08:00:00Z');
    expect((await create(a)).status).toBe(201);
  });
});

describe('POST /api/lingo/lezioni/:id/risposte', () => {
  it('grades an answer on the server, answers the key, and keeps the first answer', async () => {
    await richCards(alice, 6);
    const { id } = (await create(a)).body;
    const [first] = await keys(id);
    const wrongOne = await answer(a, id, 0, wrong(first));
    expect(wrongOne.status).toBe(200);
    expect(wrongOne.body).toMatchObject({ registrata: true, indice: 0, giusta: false, soluzione: first.giusta });
    const again = await answer(a, id, 0, first.giusta);
    expect(again.body).toMatchObject({ registrata: false, indice: 0, giusta: false, soluzione: first.giusta });
  });

  it('closes the lesson with its last answer and credits 10 XP, settled by the server', async () => {
    await richCards(alice, 6);
    const { id, esercizi } = (await create(a)).body;
    const last = await finish(a, id);
    expect(last.body.fine).toMatchObject({ giuste: esercizi.length, totale: esercizi.length });
    expect(last.body.fine.xp.crediti).toEqual([{ missione: 'lezione', punti: LESSON_MISSION.punti }]);
    expect(last.body.fine.xp.livello.totale).toBe(LESSON_MISSION.punti);
    const rows = await credits(alice);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ missione: 'LEZIONE', periodo: `L:${id}`, punti: 10, fonte: 'LEZIONE', fonteId: id, materia: 'DIRITTO_CIVILE' });
    const row = await prisma.lingoLezione.findUniqueOrThrow({ where: { id } });
    expect(row.finitaIl).not.toBeNull();
    // An answer after the end changes nothing and credits nothing; it says the end again, with what was credited.
    const after = await answer(a, id, 0, (await keys(id))[0].giusta);
    expect(after.body.registrata).toBe(false);
    expect(after.body.fine).toMatchObject({ giuste: esercizi.length, totale: esercizi.length });
    expect(after.body.fine.xp.crediti).toEqual([{ missione: 'lezione', punti: 10 }]);
    expect(after.body.fine.xp.nuovoLivello).toBe(false);
    expect(await credits(alice)).toHaveLength(1);
  });

  it('credits a lesson with wrong answers too, once it is finished', async () => {
    await richCards(alice, 6);
    const { id } = (await create(a)).body;
    const stored = await keys(id);
    let last;
    for (let i = 0; i < stored.length; i++) last = await answer(a, id, i, wrong(stored[i]));
    expect(last!.body.fine.giuste).toBe(0);
    expect(last!.body.fine.xp.crediti).toEqual([{ missione: 'lezione', punti: 10 }]);
  });

  it(`credits at most ${LESSON_MISSION.alGiorno} lessons a Rome day`, async () => {
    await richCards(alice, 6);
    for (let i = 0; i < LESSON_MISSION.alGiorno; i++) {
      const { id } = (await create(a)).body;
      expect((await finish(a, id)).body.fine.xp.crediti).toHaveLength(1);
    }
    const { id } = (await create(a)).body;
    expect((await finish(a, id)).body.fine.xp.crediti).toEqual([]);
    expect(await credits(alice)).toHaveLength(LESSON_MISSION.alGiorno);
  });

  it(`credits at most ${LESSON_MISSION.alGiorno} lessons a Rome day when two lessons end at the same moment`, async () => {
    await richCards(alice, 6);
    for (let i = 0; i < LESSON_MISSION.alGiorno - 1; i++) await finish(a, (await create(a)).body.id);
    const [first, second] = [(await create(a)).body.id as string, (await create(a)).body.id as string];
    await prisma.lingoLezione.updateMany({ where: { id: { in: [first, second] } }, data: { finitaIl: new Date() } });
    const end = (lezioneId: string) => ({ tipo: 'lezione' as const, lezioneId, materia: 'DIRITTO_CIVILE' as const });
    // The first lesson's transaction settles and stays open; the second settles meanwhile. Only once the second has
    // finished or is waiting on the XP lock does the first commit: without the lock both would count two and credit.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let settledFirst!: () => void;
    const firstSettled = new Promise<void>((resolve) => (settledFirst = resolve));
    const one = prisma.$transaction(async (tx) => {
      const esito = await settleMissions(tx, alice.id, TODAY, end(first));
      settledFirst();
      await held;
      return esito;
    });
    await firstSettled;
    let secondDone = false;
    const two = prisma.$transaction((tx) => settleMissions(tx, alice.id, TODAY, end(second))).finally(() => (secondDone = true));
    for (let waiting = 0; !secondDone && waiting === 0; ) {
      [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`SELECT count(*)::int AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
    }
    release();
    const [a1, a2] = await Promise.all([one, two]);
    expect(a1.crediti).toEqual([{ missione: 'lezione', punti: LESSON_MISSION.punti }]);
    expect(a2.crediti).toEqual([]);
    expect(await credits(alice)).toHaveLength(LESSON_MISSION.alGiorno);
  });

  it('refuses an answer of the wrong shape or out of range, and stores nothing', async () => {
    await richCards(alice, 6);
    const { id } = (await create(a)).body;
    const stored = await keys(id);
    expect((await answer(a, id, stored.length, 0)).status).toBe(400);
    expect((await answer(a, id, -1, 0)).status).toBe(400);
    expect((await answer(a, id, 0, 'tutto giusto')).status).toBe(400);
    expect((await request(app).post(`${LESSONS}/${id}/risposte`).set(a).send({ indice: 0, risposta: 0, giusta: true })).status).toBe(400);
    const row = await prisma.lingoLezione.findUniqueOrThrow({ where: { id } });
    expect(row.esiti).toEqual([]);
  });

  it('answers 404 for another person\'s lesson', async () => {
    await richCards(alice, 6);
    const { id } = (await create(a)).body;
    const bob = await createTestUser('lezione_bob2');
    expect((await answer(session(bob), id, 0, 0)).status).toBe(404);
    expect((await answer(a, '00000000-0000-4000-8000-000000000000', 0, 0)).status).toBe(404);
  });
});

describe('who reaches the lessons', () => {
  it('an exchanged token cannot build a lesson nor answer one', async () => {
    await richCards(alice, 6);
    const { id } = (await create(a)).body;
    const token = await delegated(alice, 'lingo:cards:write');
    expect((await create(token)).status).toBe(403);
    expect((await answer(token, id, 0, 0)).status).toBe(403);
  });

  it('the export carries the person\'s lessons', async () => {
    await richCards(alice, 6);
    const { id } = (await create(a)).body;
    const exported = await request(app).get('/api/auth/export').set(a);
    expect(exported.status).toBe(200);
    expect(exported.body.data.lingoLezioni.map((l: { id: string }) => l.id)).toEqual([id]);
  });
});

describe('the ledger\'s period for a lesson', () => {
  it('takes L:<lesson id> for LEZIONE and refuses a day', async () => {
    const base = { utenteId: alice.id, missione: 'LEZIONE' as const, giorno: new Date(`${TODAY}T00:00:00Z`), punti: 10, fonte: 'LEZIONE' as const };
    await expect(prisma.lingoCreditoXp.create({ data: { ...base, periodo: `G:${TODAY}`, fonteId: 'x' } })).rejects.toThrow();
    await expect(prisma.lingoCreditoXp.create({ data: { ...base, periodo: 'L:00000000-0000-4000-8000-000000000001', fonteId: '00000000-0000-4000-8000-000000000001' } })).resolves.toBeTruthy();
  });
});
