import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestUser, type TestUser } from './helpers';
import { CORSI, acceptDeclaration, app, course, courseCards, delegatedAs, examBody, moduleBody, prisma, request, switchCourses, type Headers } from './corsiHelpers';
import { cardsOf, courseCredits, gradeByHand, studyModule } from './corsiStudyHelpers';
import { GRADE, SESSION, card, grade, session, setClock } from './xpHelpers';
import { masteryFor } from '../src/lingo/courseProgress';
import { deleteUserAccount } from '../src/lingo/deleteUserAccount';

// Percorsi, S2 (spec 2026-10-23 §10.4, §10.5, §10.7): a course's cards in the review from the Rome day after their
// module is done, the session narrowed to a course with its check cards, a card's grade in mastery and «superato»,
// the course page, «Oggi», and the cards' `modulo`.

const TODAY = '2026-11-02';
const TOMORROW = '2026-11-03';
let alice: TestUser;
let token: Headers;
let a: Headers;

beforeEach(async () => {
  alice = await createTestUser('alice_rev');
  await switchCourses(true);
  await acceptDeclaration(alice);
  token = await delegatedAs(alice);
  a = session(alice, 'a');
});
afterEach(() => {
  vi.useRealTimers();
});

/** A course of `n` modules, five cards per competence on the first, studied from TODAY. */
async function withCards(n = 1) {
  const made = await course(alice, token, n, { moduliPrevisti: n });
  await courseCards(alice, made.id, made.moduleIds[0]);
  setClock(`${TODAY}T09:00:00Z`);
  return made;
}

const sessionCards = async (query: Record<string, string> = {}) => {
  const res = await request(app).get(SESSION).query(query).set(a);
  if (res.status !== 200) throw new Error(`session: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { conteggi: Record<string, number>; cards: { id: string; nuova: boolean; verifica?: boolean }[] };
};

describe('reviewScope with the day (§10.7)', () => {
  it('keeps a module’s cards out until the Rome day after it is done, then offers them as new', async () => {
    const { id, moduleIds } = await withCards();
    const own = await card(alice);
    expect((await sessionCards()).cards.map((c) => c.id)).toEqual([own.id]);
    await studyModule(a, id, moduleIds[0]);
    // Done today: still out, in the session, the counts and the road.
    expect((await sessionCards()).cards.map((c) => c.id)).toEqual([own.id]);
    expect((await request(app).get('/api/lingo/srs/conteggi').set(a)).body).toMatchObject({ nuove: 1 });
    setClock(`${TOMORROW}T09:00:00Z`);
    const next = await sessionCards();
    expect(next.cards).toHaveLength(16);
    expect(next.cards.every((c) => c.nuova)).toBe(true);
    expect((await request(app).get('/api/lingo/srs/conteggi').set(a)).body).toMatchObject({ nuove: 16 });
    const stops = (await request(app).get('/api/lingo/srs/percorso').set(a)).body as { istituto: string; nuove: number }[];
    expect(stops.filter((s) => s.istituto.startsWith('Ditta')).map((s) => s.nuove)).toEqual([5, 5, 5]);
    expect((await request(app).get('/api/lingo/srs/progressi').set(a)).body.stati).toMatchObject({ nuove: 16 });
  });

  it('a withdrawn module’s cards leave the review, and the grade route refuses them', async () => {
    const { id, moduleIds, dossier } = await course(alice, token, 1, { moduliPrevisti: 1 });
    await courseCards(alice, id, moduleIds[0]);
    vi.useRealTimers();
    const correction = await request(app).post(`${CORSI}/${id}/moduli`).set(token).send(moduleBody(dossier.ids, { sostituisceId: moduleIds[0] }));
    expect(correction.status).toBe(201);
    setClock(`${TODAY}T09:00:00Z`);
    await studyModule(a, id, moduleIds[0]);
    setClock(`${TOMORROW}T09:00:00Z`);
    const [first] = (await sessionCards()).cards;
    expect(first).toBeDefined();
    expect((await request(app).post(`${CORSI}/${id}/moduli/${moduleIds[0]}/ritira`).set(a).send({})).status).toBe(200);
    expect((await sessionCards()).cards).toEqual([]);
    expect((await grade(a, first.id)).status).toBe(404);
  });
});

describe('the session narrowed to a course (`?corso=`)', () => {
  it('holds that course’s cards only, never marks the day finished, and is 404 for a course not the caller’s', async () => {
    const { id, moduleIds } = await withCards();
    await card(alice);
    await studyModule(a, id, moduleIds[0]);
    setClock(`${TOMORROW}T09:00:00Z`);
    const narrowed = await sessionCards({ corso: id });
    expect(narrowed.cards).toHaveLength(15);
    expect(narrowed.conteggi).toEqual({ dovute: 0, nuove: 15, verifica: 0 });
    expect(narrowed.cards.every((c) => c.verifica === false)).toBe(true);
    const bob = await createTestUser('bob_rev');
    expect((await request(app).get(SESSION).query({ corso: id }).set(session(bob, 'b'))).status).toBe(404);
    await switchCourses(false);
    expect((await request(app).get(SESSION).query({ corso: id }).set(a)).status).toBe(404);
    expect(await prisma.lingoGiornataStudio.count({ where: { codaFinita: true } })).toBe(0);
  });

  it('adds check cards on the day a competence’s next session counts, never a new card nor one graded today', async () => {
    const { id, moduleIds } = await withCards();
    await studyModule(a, id, moduleIds[0]);
    // C1: a valid session at 100% from its five cards on 2026-11-03; due far ahead.
    const c1 = await cardsOf(id, 'C1');
    await gradeByHand(alice, c1, '2026-11-03T10:00:00Z', [true, true, true, true, true]);
    setClock('2026-11-09T09:00:00Z');
    expect((await sessionCards({ corso: id })).conteggi.verifica).toBe(0);
    setClock('2026-11-10T09:00:00Z');
    const day = await sessionCards({ corso: id });
    const checks = day.cards.filter((c) => c.verifica);
    expect(checks.map((c) => c.id).sort()).toEqual(c1.map((c) => c.id).sort());
    expect(day.conteggi.verifica).toBe(5);
    // A check card is graded though not due; once four are graded today one more is offered, then none.
    for (const c of checks.slice(0, 4)) expect((await grade(a, c.id, 3)).body.registrata).toBe(true);
    expect((await sessionCards({ corso: id })).cards.filter((c) => c.verifica).map((c) => c.id)).toEqual([checks[4].id]);
    await grade(a, checks[4].id, 3);
    expect((await sessionCards({ corso: id })).conteggi.verifica).toBe(0);
    const enrolment = await prisma.lingoCorsoIscrizione.findFirstOrThrow();
    const competence = await prisma.lingoCorsoCompetenza.findFirstOrThrow({ where: { corsoId: id, codice: 'C1' } });
    expect((await masteryFor(prisma, alice.id, [enrolment], '2026-11-10')).get(id)!.padronanza.get(competence.id)!.stato).toBe('acquisita');
    setClock('2026-11-11T09:00:00Z');
    expect((await sessionCards({ corso: id })).conteggi.verifica).toBe(0);
  });

  it('offers none for a competence whose reviewed cards cannot make five answers today: never drilled daily', async () => {
    const { id, moduleIds } = await course(alice, token, 3, { moduliPrevisti: 3 });
    await courseCards(alice, id, moduleIds[0]);
    setClock(`${TODAY}T09:00:00Z`);
    // Three modules today: a valid session at 100% on every competence; C1's next counts from 11-09.
    for (const m of moduleIds) await studyModule(a, id, m);
    const c1 = await cardsOf(id, 'C1');
    await gradeByHand(alice, c1.slice(0, 3), '2026-11-03T10:00:00Z', [true, true, true]);
    setClock('2026-11-09T09:00:00Z');
    expect((await sessionCards({ corso: id })).conteggi.verifica).toBe(0);
    await gradeByHand(alice, c1.slice(3), '2026-11-04T10:00:00Z', [true, true]);
    const checks = (await sessionCards({ corso: id })).cards.filter((c) => c.verifica).map((c) => c.id);
    expect(new Set(checks)).toEqual(new Set(c1.map((c) => c.id)));
  });

  it('offers «da riprendere» first', async () => {
    const { id, moduleIds } = await withCards();
    await studyModule(a, id, moduleIds[0]);
    const [c1, c2] = [await cardsOf(id, 'C1'), await cardsOf(id, 'C2')];
    // C2 acquired then fallen on 11-12; C1 valid at 100% on 11-12 (next counts from 11-19).
    await gradeByHand(alice, c2, '2026-11-03T10:00:00Z', [true, true, true, true, true]);
    await gradeByHand(alice, c2, '2026-11-10T10:00:00Z', [true, true, true, true, true]);
    await gradeByHand(alice, c2, '2026-11-12T10:00:00Z', [false, false, false, false, true]);
    await gradeByHand(alice, c1, '2026-11-12T10:00:00Z', [true, true, true, true, true]);
    setClock('2026-11-19T09:00:00Z');
    const checks = (await sessionCards({ corso: id })).cards.filter((c) => c.verifica).map((c) => c.id);
    expect(checks).toHaveLength(10);
    expect(new Set(checks.slice(0, 5))).toEqual(new Set(c2.map((c) => c.id)));
    expect((await request(app).get(`${CORSI}/${id}`).set(a)).body.competenze.map((c: { stato: string }) => c.stato)).toEqual(['in-corso', 'da-riprendere', 'da-iniziare']);
  });
});

describe('a course card’s grade', () => {
  it('counts on its Rome day around the change of hour', async () => {
    const { id } = await withCards();
    const c1 = await cardsOf(id, 'C1');
    // 22:30 UTC on 24 October is 00:30 of the 25th in Rome (summer time); 23:30 UTC on the 25th is 00:30 of the 26th.
    await gradeByHand(alice, c1, '2026-10-24T22:30:00Z', [true, true, true, true, true]);
    const enrolment = await prisma.lingoCorsoIscrizione.findFirstOrThrow();
    const competence = await prisma.lingoCorsoCompetenza.findFirstOrThrow({ where: { corsoId: id, codice: 'C1' } });
    const read = async (today: string) => (await masteryFor(prisma, alice.id, [enrolment], today)).get(id)!.padronanza.get(competence.id)!;
    expect((await read('2026-10-25')).oggi.risposte).toBe(5);
    await gradeByHand(alice, c1, '2026-10-25T23:30:00Z', [true, true, true, true, true]);
    expect((await read('2026-10-26')).oggi.risposte).toBe(5);
    expect((await read('2026-10-26')).ultima).toEqual({ giorno: '2026-10-26', percentuale: 100 });
  });

  it('brings «superato» in the grade’s transaction, crediting «Supera un percorso» with the review as its event', async () => {
    const { id, moduleIds } = await course(alice, token, 3, { moduliPrevisti: 3 });
    await courseCards(alice, id, moduleIds[0]);
    const exam = await request(app).post(`${CORSI}/${id}/esami`).set(token).send(examBody());
    setClock('2026-10-20T09:00:00Z');
    for (const m of moduleIds) await studyModule(a, id, m);
    const enrolment = await prisma.lingoCorsoIscrizione.findFirstOrThrow();
    await prisma.lingoCorsoTentativo.create({
      data: { iscrizioneId: enrolment.id, esameId: exam.body.id, consegnatoIl: new Date(), giorno: new Date('2026-10-20T00:00:00Z'), percentuale: 100, superato: true, perCompetenza: {} },
    });
    for (const code of ['C1', 'C2', 'C3']) await gradeByHand(alice, await cardsOf(id, code), '2026-10-21T10:00:00Z', [true, true, true, true, true], 7);
    for (const code of ['C1', 'C2']) await gradeByHand(alice, await cardsOf(id, code), '2026-10-28T10:00:00Z', [true, true, true, true, true]);
    const c3 = await cardsOf(id, 'C3');
    await gradeByHand(alice, c3.slice(0, 4), '2026-10-28T10:00:00Z', [true, true, true, true]);
    setClock('2026-10-28T12:00:00Z');
    const graded = await request(app).post(GRADE).set(a).send({ cardId: c3[4].id, rating: 4 });
    expect(graded.status).toBe(200);
    expect(graded.body.xp.crediti).toEqual(expect.arrayContaining([{ missione: 'percorso', punti: 100 }]));
    expect((await prisma.lingoCorsoIscrizione.findFirstOrThrow()).superatoIl).toEqual(new Date('2026-10-28T00:00:00Z'));
    expect((await courseCredits(alice)).find((c) => c.missione === 'PERCORSO')).toMatchObject({ fonte: 'REVISIONE', fonteId: enrolment.id });
  });
});

describe('the course page (`GET /:id`)', () => {
  it('shows the competences with their numbers, the modules, what «in preparazione» lacks, the exam and the cards', async () => {
    const { id, moduleIds, dossier } = await course(alice, token, 1, { moduliPrevisti: 2 });
    setClock(`${TODAY}T09:00:00Z`);
    await studyModule(a, id, moduleIds[0]);
    const read = await request(app).get(`${CORSI}/${id}`).set(a);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({
      id, stato: 'in-preparazione', superatoIl: null, moduliPrevisti: 2,
      dossier: { id: dossier.id, name: 'Proprietà intellettuale' },
      inPreparazione: {
        moduli: { contati: 1, previsti: 2 },
        manca: { esame: true },
        competenzeSenzaModulo: [],
        schede: [{ codice: 'C1', schede: 0, servono: 5 }, { codice: 'C2', schede: 0, servono: 5 }, { codice: 'C3', schede: 0, servono: 5 }],
      },
      esame: { stato: 'assente', esameId: null },
      schede: { dovute: 0, nuove: 0, inAttesa: 0, verifica: 0 },
      xp: { crediti: [] },
    });
    // Two answers on C1 today: no valid session yet.
    expect(read.body.competenze[0]).toEqual({
      codice: 'C1', ordine: 1, testo: 'Qualificare un segno distintivo e i suoi impedimenti', stato: 'da-iniziare',
      sessioni: { contate: 0, servono: 2 }, prossimaDal: null, ultima: null,
    });
    expect(read.body.moduli[0]).toMatchObject({ id: moduleIds[0], stato: 'fatto', fattoGiorno: TODAY, quizPercentuale: 100, conta: true, eliminabile: false, ritirabile: false });
    expect(read.body.moduli[0].creatoDa).toEqual({ clientName: expect.any(String) });
  });

  it('gives a competence its numbers: «1 di 2», the day the next counts, the last score', async () => {
    const { id, moduleIds } = await course(alice, token, 3, { moduliPrevisti: 3 });
    setClock(`${TODAY}T09:00:00Z`);
    for (const [i, m] of moduleIds.entries()) await studyModule(a, id, m, i === 0 ? 1 : 0);
    // Three modules: six answers on each competence today, C1 with one wrong (5 of 6, 83%).
    const read = await request(app).get(`${CORSI}/${id}`).set(a);
    expect(read.body.competenze[0]).toMatchObject({ stato: 'in-corso', sessioni: { contate: 1, servono: 2 }, prossimaDal: '2026-11-09', ultima: { giorno: TODAY, percentuale: 83 } });
  });

  it('counts the course’s cards waiting for their module, then new from the next day', async () => {
    const { id, moduleIds } = await withCards();
    expect((await request(app).get(`${CORSI}/${id}`).set(a)).body.schede).toEqual({ dovute: 0, nuove: 0, inAttesa: 15, verifica: 0 });
    await studyModule(a, id, moduleIds[0]);
    setClock(`${TOMORROW}T09:00:00Z`);
    expect((await request(app).get(`${CORSI}/${id}`).set(a)).body.schede).toEqual({ dovute: 0, nuove: 15, inAttesa: 0, verifica: 0 });
  });
});

describe('«Oggi» (`GET /oggi`)', () => {
  it('suggests the first module not done, none on a day one was done, the next from the following day', async () => {
    const { id, moduleIds } = await course(alice, token, 2, { moduliPrevisti: 2 });
    setClock(`${TODAY}T09:00:00Z`);
    const today = async () => (await request(app).get(`${CORSI}/oggi`).set(a)).body;
    expect(await today()).toEqual([{ corso: { id, titolo: 'Proprietà intellettuale', materia: 'DIRITTO_CIVILE' }, modulo: { id: moduleIds[0], ordine: 1, titolo: 'Modulo 1' }, schede: { dovute: 0, verifica: 0 } }]);
    await studyModule(a, id, moduleIds[0]);
    expect(await today()).toEqual([]);
    setClock(`${TOMORROW}T09:00:00Z`);
    expect((await today())[0].modulo).toEqual({ id: moduleIds[1], ordine: 2, titolo: 'Modulo 2' });
  });

  it('carries the course’s due cards, and writes nothing', async () => {
    const { id, moduleIds } = await withCards();
    await studyModule(a, id, moduleIds[0]);
    const c1 = await cardsOf(id, 'C1');
    await gradeByHand(alice, c1, '2026-11-01T10:00:00Z', [true, true, true, true, true], 2);
    setClock(`${TOMORROW}T09:00:00Z`);
    const before = await prisma.lingoCreditoXp.count();
    const [row] = (await request(app).get(`${CORSI}/oggi`).set(a)).body;
    expect(row).toMatchObject({ corso: { id }, modulo: null, schede: { dovute: 5 } });
    expect(await prisma.lingoCreditoXp.count()).toBe(before);
  });
});

describe('a card’s module in «Le mie schede»', () => {
  it('is `{ id, corsoId, titolo, fatto }` for the session; a token needs lingo:courses:read; off, null', async () => {
    const { id, moduleIds } = await withCards();
    const list = async (h: Headers) => (await request(app).get('/api/lingo/cards').set(h)).body.cards as { modulo: unknown }[];
    expect((await list(a))[0].modulo).toEqual({ id: moduleIds[0], corsoId: id, titolo: 'Modulo 1', fatto: false });
    await studyModule(a, id, moduleIds[0]);
    const [one] = await prisma.lingoCard.findMany({ where: { moduloId: moduleIds[0] }, take: 1 });
    expect((await request(app).get(`/api/lingo/cards/${one.id}`).set(a)).body.modulo).toMatchObject({ fatto: true });
    vi.useRealTimers();
    expect((await list(await delegatedAs(alice, 'lingo:cards:read')))[0].modulo).toBeNull();
    expect((await list(await delegatedAs(alice, 'lingo:cards:read lingo:courses:read')))[0].modulo).toMatchObject({ id: moduleIds[0], fatto: true });
    await switchCourses(false);
    expect((await list(a))[0].modulo).toBeNull();
  });
});

describe('an account’s deletion', () => {
  it('leaves no row of a course studied: states, outcomes, attempts, cards, credits', async () => {
    const { id, moduleIds } = await withCards(1);
    vi.useRealTimers();
    const exam = await request(app).post(`${CORSI}/${id}/esami`).set(token).send(examBody());
    expect(exam.status).toBe(201);
    setClock(`${TODAY}T09:00:00Z`);
    await studyModule(a, id, moduleIds[0]);
    const started = await request(app).post(`${CORSI}/${id}/esami/${exam.body.id}/inizia`).set(a).send({});
    await request(app).post(`${CORSI}/${id}/esami/${exam.body.id}/consegna`).set(a).send({ risposte: [{ domandaId: started.body.domande[0].id, scelta: 'a' }] });
    await gradeByHand(alice, await cardsOf(id, 'C1'), `${TODAY}T10:00:00Z`, [true]);
    expect(await prisma.lingoCorsoEsito.count()).toBeGreaterThan(0);
    await deleteUserAccount(alice.id);
    const counts = await Promise.all([
      prisma.lingoCorso.count(), prisma.lingoCorsoIscrizione.count(), prisma.lingoCorsoModuloStato.count(), prisma.lingoCorsoEsito.count(),
      prisma.lingoCorsoTentativo.count(), prisma.lingoCorsoDomanda.count(), prisma.lingoCard.count(), prisma.lingoCardCompetenza.count(),
      prisma.lingoRevisioneSRS.count(), prisma.lingoCreditoXp.count(),
    ]);
    expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
