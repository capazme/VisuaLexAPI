import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestUser, type TestUser } from './helpers';
import { CORSI, acceptDeclaration, app, course, delegatedAs, moduleBody, prisma, request, switchCourses, type Headers } from './corsiHelpers';
import { answer, answerQuiz, courseCredits, finish, moduleUrl, readModule, studyModule } from './corsiStudyHelpers';
import { session, setClock } from './xpHelpers';
import { masteryFor } from '../src/lingo/courseProgress';

// Percorsi, S2 (spec 2026-10-23 §5, §10.4, §10.5, §10.8): studying a module — reading it without keys, answers graded
// on the server once each, the open question, the end and «Completa un modulo», flags, withdrawal, scoping.

const TODAY = '2026-11-02';
let alice: TestUser;
let bob: TestUser;
let token: Headers;
let a: Headers;

beforeEach(async () => {
  alice = await createTestUser('alice_s2');
  bob = await createTestUser('bob_s2');
  await switchCourses(true);
  await acceptDeclaration(alice);
  token = await delegatedAs(alice);
  a = session(alice, 'a');
});
afterEach(() => {
  vi.useRealTimers();
});

/** A course with `n` modules (as planned), studied from TODAY on. */
async function ready(n = 1, over: Record<string, unknown> = {}) {
  const made = await course(alice, token, n, { moduliPrevisti: n, ...over });
  setClock(`${TODAY}T09:00:00Z`);
  return made;
}

const KEYS = ['corretta', 'spiegazione', 'rispostaModello', 'rubrica', 'Perché la', 'Questione, regola, esito.'];
const leaksNoKey = (body: unknown) => {
  const text = JSON.stringify(body);
  for (const key of KEYS) expect(text, key).not.toContain(key);
};

describe('reading a module', () => {
  it('gives the lesson and the items without a key, an explanation, a model answer or a rubric, before any answer', async () => {
    const { id, moduleIds } = await ready();
    const read = await request(app).get(moduleUrl(id, moduleIds[0])).set(a);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ id: moduleIds[0], titolo: 'Modulo 1', stato: null, aperta: null, quiz: { totale: 6, risposte: 0 } });
    expect(read.body.blocchi[0].testo).toContain('La ditta');
    expect(read.body.domande.map((d: { tipo: string }) => d.tipo)).toEqual(['RICHIAMO', 'QUIZ', 'QUIZ', 'QUIZ', 'QUIZ', 'QUIZ', 'QUIZ', 'APERTA']);
    leaksNoKey(read.body.domande);
    leaksNoKey(read.body.aperta);
    // Reading does not open: the module can still be trashed.
    expect(await prisma.lingoCorsoModuloStato.count()).toBe(0);
  });

  it('gives an answered item its key, explanations and the caller’s outcome, the others still without', async () => {
    const { id, moduleIds } = await ready();
    const quiz = (await readModule(a, id, moduleIds[0])).domande.filter((d) => d.tipo === 'QUIZ');
    await answer(a, id, moduleIds[0], quiz[0].id, 'b');
    const read = await readModule(a, id, moduleIds[0]);
    const first = read.domande.find((d) => d.id === quiz[0].id) as unknown as Record<string, unknown>;
    expect(first).toMatchObject({ corretta: 'a', esito: { scelta: 'b', corretto: false, giorno: TODAY, segnalata: false } });
    expect(JSON.stringify(first)).toContain('Perché la seconda.');
    leaksNoKey(read.domande.filter((d) => d.id !== quiz[0].id));
  });
});

describe('answering', () => {
  it('grades the choice on the server and answers the key and every explanation', async () => {
    const { id, moduleIds } = await ready();
    const [right, wrong] = (await readModule(a, id, moduleIds[0])).domande.filter((d) => d.tipo === 'QUIZ');
    const ok = await answer(a, id, moduleIds[0], right.id, 'a');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ registrata: true, scelta: 'a', corretto: true, corretta: 'a' });
    expect(ok.body.opzioni).toHaveLength(2);
    expect(ok.body.opzioni[1].spiegazione).toBe('Perché la seconda.');
    expect((await answer(a, id, moduleIds[0], wrong.id, 'b')).body).toMatchObject({ corretto: false, corretta: 'a' });
    const row = await prisma.lingoCorsoEsito.findFirstOrThrow({ where: { domandaId: right.id } });
    expect(row.giorno.toISOString().slice(0, 10)).toBe(TODAY);
  });

  it('refuses «right» or «wrong» from the client, a choice not among the options, an item of another module', async () => {
    const { id, moduleIds } = await ready(2);
    const [item] = (await readModule(a, id, moduleIds[0])).domande.filter((d) => d.tipo === 'QUIZ');
    expect((await request(app).post(`${moduleUrl(id, moduleIds[0])}/risposte`).set(a).send({ domandaId: item.id, scelta: 'b', corretto: true })).status).toBe(400);
    expect((await answer(a, id, moduleIds[0], item.id, 'f')).status).toBe(400);
    expect((await answer(a, id, moduleIds[1], item.id, 'a')).status).toBe(404);
    expect(await prisma.lingoCorsoEsito.count()).toBe(0);
  });

  it('keeps one outcome per item: a retry answers the stored one, and two parallel sends make one row', async () => {
    const { id, moduleIds } = await ready();
    const [first, second] = (await readModule(a, id, moduleIds[0])).domande.filter((d) => d.tipo === 'QUIZ');
    await answer(a, id, moduleIds[0], first.id, 'b');
    const retry = await answer(a, id, moduleIds[0], first.id, 'a');
    expect(retry.body).toMatchObject({ registrata: false, scelta: 'b', corretto: false, xp: null });
    const both = await Promise.all([answer(a, id, moduleIds[0], second.id, 'a'), answer(a, id, moduleIds[0], second.id, 'b')]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect(both.filter((r) => r.body.registrata)).toHaveLength(1);
    expect(await prisma.lingoCorsoEsito.count({ where: { domandaId: second.id } })).toBe(1);
  });

  it('opens the module with the first answer: from then it can no longer be trashed', async () => {
    const { id, moduleIds } = await ready();
    await answerQuiz(a, id, moduleIds[0], 6);
    expect(await prisma.lingoCorsoModuloStato.count()).toBe(1);
    expect((await request(app).delete(moduleUrl(id, moduleIds[0])).set(a)).status).toBe(409);
  });

  it('`apri` opens it on its own, idempotently', async () => {
    const { id, moduleIds } = await ready();
    const opened = await request(app).post(`${moduleUrl(id, moduleIds[0])}/apri`).set(a).send({});
    expect(opened.status).toBe(200);
    expect((await request(app).post(`${moduleUrl(id, moduleIds[0])}/apri`).set(a).send({})).body.apertoIl).toBe(opened.body.apertoIl);
    expect(await prisma.lingoCorsoModuloStato.count()).toBe(1);
  });
});

describe('the open question', () => {
  const openOf = async (id: string, moduloId: string) => (await readModule(a, id, moduloId)).domande.find((d) => d.tipo === 'APERTA')!;

  it('waits for the whole quiz; at 70% or more it is written from memory: no choice, the model answer and the ticks', async () => {
    const { id, moduleIds } = await ready();
    expect((await request(app).get(`${moduleUrl(id, moduleIds[0])}/aperta`).set(a)).status).toBe(409);
    await answerQuiz(a, id, moduleIds[0]);
    const open = await openOf(id, moduleIds[0]);
    expect((await answer(a, id, moduleIds[0], open.id, 'b')).status).toBe(409);
    const shown = await request(app).get(`${moduleUrl(id, moduleIds[0])}/aperta`).set(a);
    expect(shown.body).toMatchObject({ rispostaModello: 'Questione, regola, esito.', rubrica: ['Questione', 'Regola', 'Esito'], spuntate: [] });
    const ticked = await request(app).post(`${moduleUrl(id, moduleIds[0])}/aperta`).set(a).send({ spuntate: [2, 0] });
    expect(ticked.body).toEqual({ domandaId: open.id, spuntate: [0, 2] });
    // The last send stands; the row has no choice and no grade: self-assessment never counts (Q6).
    await request(app).post(`${moduleUrl(id, moduleIds[0])}/aperta`).set(a).send({ spuntate: [1] });
    const row = await prisma.lingoCorsoEsito.findFirstOrThrow({ where: { domandaId: open.id } });
    expect(row).toMatchObject({ scelta: null, corretto: null, spuntate: [1] });
    expect((await request(app).post(`${moduleUrl(id, moduleIds[0])}/aperta`).set(a).send({ spuntate: [3] })).status).toBe(400);
    await finish(a, id, moduleIds[0]);
    expect((await request(app).post(`${moduleUrl(id, moduleIds[0])}/aperta`).set(a).send({ spuntate: [0] })).status).toBe(409);
  });

  it('under 70%: the hybrid’s choice is graded first, and only then the model answer is shown', async () => {
    const { id, moduleIds } = await ready();
    await answerQuiz(a, id, moduleIds[0], 3);
    const before = await request(app).get(`${moduleUrl(id, moduleIds[0])}/aperta`).set(a);
    expect(before.status).toBe(409);
    expect(before.body.detail).toContain('Scegli prima');
    expect((await request(app).post(`${moduleUrl(id, moduleIds[0])}/aperta`).set(a).send({ spuntate: [0] })).status).toBe(409);
    const open = await openOf(id, moduleIds[0]);
    expect((await answer(a, id, moduleIds[0], open.id, 'b')).body).toMatchObject({ registrata: true, corretto: true, corretta: 'b' });
    expect((await request(app).get(`${moduleUrl(id, moduleIds[0])}/aperta`).set(a)).status).toBe(200);
    await request(app).post(`${moduleUrl(id, moduleIds[0])}/aperta`).set(a).send({ spuntate: [0, 1, 2] });
    // The ticks never touch the graded choice.
    expect(await prisma.lingoCorsoEsito.findFirstOrThrow({ where: { domandaId: open.id } })).toMatchObject({ scelta: 'b', corretto: true, spuntate: [0, 1, 2] });
  });
});

describe('the end of a module', () => {
  it('needs the whole quiz, then writes the day, the share and the judgement and credits «Completa un modulo» once', async () => {
    const { id, moduleIds } = await ready();
    await answerQuiz(a, id, moduleIds[0]);
    const quiz = (await readModule(a, id, moduleIds[0])).domande.filter((d) => d.tipo === 'QUIZ');
    await prisma.lingoCorsoEsito.deleteMany({ where: { domandaId: quiz[5].id } });
    const early = await finish(a, id, moduleIds[0]);
    expect(early.status).toBe(409);
    expect(early.body.detail).toContain('5 di 6');
    await answer(a, id, moduleIds[0], quiz[5].id, 'a');

    const done = await finish(a, id, moduleIds[0], { giudizio: 4, nota: 'Chiaro.' });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ moduloId: moduleIds[0], fattoGiorno: TODAY, quiz: { giuste: 6, totale: 6, percentuale: 100 }, missione: true, giudizio: 4, nota: 'Chiaro.' });
    expect(done.body.xp.crediti).toEqual([{ missione: 'modulo', punti: 30 }]);
    const again = await finish(a, id, moduleIds[0], { giudizio: 1 });
    expect(again.body).toMatchObject({ fattoGiorno: TODAY, giudizio: 4, xp: null });
    const credits = await courseCredits(alice);
    expect(credits).toHaveLength(1);
    const state = await prisma.lingoCorsoModuloStato.findFirstOrThrow();
    expect(credits[0]).toMatchObject({ missione: 'MODULO', periodo: `M:${moduleIds[0]}`, fonte: 'MODULO', fonteId: state.id, punti: 30, materia: 'DIRITTO_CIVILE' });
  });

  it('under 70% the module is done and earns nothing', async () => {
    const { id, moduleIds } = await ready();
    const done = await studyModule(a, id, moduleIds[0], 2); // 4 of 6: 66%
    expect(done).toMatchObject({ quiz: { percentuale: 66 }, missione: false });
    expect(done.xp.crediti).toEqual([]);
    expect(await courseCredits(alice)).toEqual([]);
  });

  it('credits at most two modules a Rome day; the third is credited by the course page the next day (Q5)', async () => {
    const { id, moduleIds } = await ready(3);
    expect((await studyModule(a, id, moduleIds[0])).xp.crediti).toHaveLength(1);
    expect((await studyModule(a, id, moduleIds[1])).xp.crediti).toHaveLength(1);
    expect((await studyModule(a, id, moduleIds[2])).xp.crediti).toEqual([]);
    // The same day the page settles nothing more.
    expect((await request(app).get(`${CORSI}/${id}`).set(a)).body.xp.crediti).toEqual([]);
    setClock('2026-11-03T09:00:00Z');
    const page = await request(app).get(`${CORSI}/${id}`).set(a);
    expect(page.body.xp.crediti).toEqual([{ missione: 'modulo', punti: 30 }]);
    const third = await prisma.lingoCorsoModuloStato.findFirstOrThrow({ where: { moduloId: moduleIds[2] } });
    expect(await courseCredits(alice)).toEqual(expect.arrayContaining([expect.objectContaining({ fonte: 'MODULO', fonteId: third.id, giorno: new Date('2026-11-03T00:00:00Z') })]));
    expect((await request(app).get(`${CORSI}/${id}`).set(a)).body.xp.crediti).toEqual([]);
  });
});

describe('flags (§5.1, G-377 Q7)', () => {
  it('only on an answered item; they change neither the quiz’s share nor mastery', async () => {
    const { id, moduleIds } = await ready();
    const quiz = (await readModule(a, id, moduleIds[0])).domande.filter((d) => d.tipo === 'QUIZ');
    const flag = (domandaId: string, motivo?: string) => request(app).post(`${CORSI}/${id}/domande/${domandaId}/segnala`).set(a).send(motivo ? { motivo } : {});
    expect((await flag(quiz[0].id)).status).toBe(409);
    await answerQuiz(a, id, moduleIds[0], 3);
    const enrolment = await prisma.lingoCorsoIscrizione.findFirstOrThrow();
    const before = (await masteryFor(prisma, alice.id, [enrolment], TODAY)).get(id)!;
    for (const item of quiz.slice(0, 3)) expect((await flag(item.id, 'La risposta giusta è la b.')).body).toMatchObject({ domandaId: item.id, motivo: 'La risposta giusta è la b.' });
    const after = (await masteryFor(prisma, alice.id, [enrolment], TODAY)).get(id)!;
    expect([...after.padronanza.values()].map((m) => m.oggi)).toEqual([...before.padronanza.values()].map((m) => m.oggi));
    const done = await finish(a, id, moduleIds[0]);
    expect(done.body).toMatchObject({ quiz: { giuste: 3, totale: 6, percentuale: 50 } });
    expect(done.body.segnalate).toEqual(quiz.slice(0, 3).map((q) => q.id));
    // The assistant reads them with their reasons (its token was signed on the real clock).
    vi.useRealTimers();
    const structure = await request(app).get(`${CORSI}/${id}/struttura`).set(token);
    expect(structure.body.segnalazioni).toHaveLength(3);
    expect(structure.body.padronanza).toEqual([
      { codice: 'C1', stato: 'da-iniziare', sessioni: 0, prossimaDal: null, ultima: null },
      { codice: 'C2', stato: 'da-iniziare', sessioni: 0, prossimaDal: null, ultima: null },
      { codice: 'C3', stato: 'da-iniziare', sessioni: 0, prossimaDal: null, ultima: null },
    ]);
  });
});

describe('withdrawing a module (§5.1, Q7)', () => {
  it('only once a live correction supersedes it; then its items leave mastery and its answers stop', async () => {
    const { id, moduleIds, dossier } = await course(alice, token, 1, { moduliPrevisti: 1 });
    setClock(`${TODAY}T09:00:00Z`);
    const ritira = () => request(app).post(`${moduleUrl(id, moduleIds[0])}/ritira`).set(a).send({});
    expect((await ritira()).status).toBe(409); // not opened
    await answerQuiz(a, id, moduleIds[0], 6);
    expect((await ritira()).status).toBe(409); // no correction
    vi.useRealTimers();
    const correction = await request(app).post(`${CORSI}/${id}/moduli`).set(token).send(moduleBody(dossier.ids, { titolo: 'Modulo 1 corretto', sostituisceId: moduleIds[0] }));
    expect(correction.status).toBe(201);
    setClock(`${TODAY}T10:00:00Z`);
    const enrolment = await prisma.lingoCorsoIscrizione.findFirstOrThrow();
    const c1 = await prisma.lingoCorsoCompetenza.findFirstOrThrow({ where: { corsoId: id, codice: 'C1' } });
    expect((await masteryFor(prisma, alice.id, [enrolment], TODAY)).get(id)!.padronanza.get(c1.id)!.oggi.risposte).toBe(2);
    const withdrawn = await ritira();
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.ritiratoIl).toBeTruthy();
    expect((await ritira()).body.ritiratoIl).toBe(withdrawn.body.ritiratoIl);
    expect((await masteryFor(prisma, alice.id, [enrolment], TODAY)).get(id)!.padronanza.get(c1.id)!.oggi.risposte).toBe(0);
    const recall = (await readModule(a, id, moduleIds[0])).domande.find((d) => d.tipo === 'RICHIAMO')!;
    expect((await answer(a, id, moduleIds[0], recall.id, 'a')).status).toBe(409);
    // The page counts the correction, not the withdrawn module.
    const page = await request(app).get(`${CORSI}/${id}`).set(a);
    expect(page.body.moduli.map((m: { stato: string; conta: boolean }) => [m.stato, m.conta])).toEqual([['ritirato', false], ['da-iniziare', true]]);
  });
});

describe('who may study', () => {
  it('another user: 404 on every study route of the course, never 403', async () => {
    const { id, moduleIds } = await ready();
    const quiz = (await readModule(a, id, moduleIds[0])).domande.filter((d) => d.tipo === 'QUIZ');
    const b = session(bob, 'b');
    const m = moduleUrl(id, moduleIds[0]);
    const calls = [
      request(app).get(`${CORSI}/${id}`).set(b),
      request(app).get(m).set(b),
      request(app).post(`${m}/apri`).set(b).send({}),
      request(app).post(`${m}/risposte`).set(b).send({ domandaId: quiz[0].id, scelta: 'a' }),
      request(app).get(`${m}/aperta`).set(b),
      request(app).post(`${m}/aperta`).set(b).send({ spuntate: [0] }),
      request(app).post(`${m}/fine`).set(b).send({}),
      request(app).post(`${m}/ritira`).set(b).send({}),
      request(app).post(`${CORSI}/${id}/domande/${quiz[0].id}/segnala`).set(b).send({}),
      request(app).post(`${CORSI}/${id}/esami/x/inizia`).set(b).send({}),
      request(app).post(`${CORSI}/${id}/esami/x/consegna`).set(b).send({ risposte: [] }),
    ];
    for (const res of await Promise.all(calls)) expect(res.status, res.req.path).toBe(404);
    expect(await prisma.lingoCorsoEsito.count()).toBe(0);
    expect(await prisma.lingoCorsoModuloStato.count()).toBe(0);
  });

  it('a connected application: 403 on every study route and on the course page and «Oggi» (studying earns XP)', async () => {
    const { id, moduleIds } = await course(alice, token, 1);
    const quiz = (await readModule(a, id, moduleIds[0])).domande.filter((d) => d.tipo === 'QUIZ');
    const m = moduleUrl(id, moduleIds[0]);
    const calls = [
      request(app).get(`${CORSI}/oggi`).set(token),
      request(app).get(`${CORSI}/${id}`).set(token),
      request(app).get(m).set(token),
      request(app).post(`${m}/apri`).set(token).send({}),
      request(app).post(`${m}/risposte`).set(token).send({ domandaId: quiz[0].id, scelta: 'a' }),
      request(app).post(`${m}/fine`).set(token).send({}),
      request(app).post(`${CORSI}/${id}/domande/${quiz[0].id}/segnala`).set(token).send({}),
      request(app).post(`${CORSI}/${id}/esami/x/inizia`).set(token).send({}),
    ];
    for (const res of await Promise.all(calls)) expect(res.status, res.req.path).toBe(403);
    expect(await prisma.lingoCorsoEsito.count()).toBe(0);
  });

  it('with the switch off: 404, and the rows stay', async () => {
    const { id, moduleIds } = await ready();
    await answerQuiz(a, id, moduleIds[0]);
    await switchCourses(false);
    expect((await request(app).get(`${CORSI}/${id}`).set(a)).status).toBe(404);
    expect((await request(app).get(moduleUrl(id, moduleIds[0])).set(a)).status).toBe(404);
    expect((await request(app).get(`${CORSI}/oggi`).set(a)).status).toBe(404);
    expect(await prisma.lingoCorsoEsito.count()).toBe(6);
  });

  it('a course trashed: its study routes answer 404', async () => {
    const { id, moduleIds } = await ready();
    const quiz = (await readModule(a, id, moduleIds[0])).domande.filter((d) => d.tipo === 'QUIZ');
    expect((await request(app).delete(`${CORSI}/${id}`).set(a)).status).toBe(200);
    expect((await answer(a, id, moduleIds[0], quiz[0].id, 'a')).status).toBe(404);
  });
});
