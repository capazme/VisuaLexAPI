import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestUser, type TestUser } from './helpers';
import { CORSI, acceptDeclaration, app, course, courseCards, delegatedAs, examBody, prisma, request, switchCourses, type Headers } from './corsiHelpers';
import { cardsOf, courseCredits, gradeByHand, studyModule } from './corsiStudyHelpers';
import { session, setClock } from './xpHelpers';
import { addDays, romeDay } from '../src/lingo/studyDay';

// Percorsi, S2 (spec 2026-10-23 §4, §10.4, §10.8): the final exam — locked until every module is done, never a key
// before the hand-in, graded on the server at 70% overall and 60% on each competence, never shown twice, the
// pause before a new one — and «Percorso superato» with «Supera un percorso».

const TODAY = '2026-11-02';
let alice: TestUser;
let token: Headers;
let a: Headers;

beforeEach(async () => {
  alice = await createTestUser('alice_exam');
  await switchCourses(true);
  await acceptDeclaration(alice);
  token = await delegatedAs(alice);
  a = session(alice, 'a');
});
afterEach(() => {
  vi.useRealTimers();
});

/** A course of `n` modules with its cards and its first exam, studied from TODAY. */
async function withExam(n = 3) {
  const made = await course(alice, token, n, { moduliPrevisti: n });
  await courseCards(alice, made.id, made.moduleIds[0]);
  const exam = await request(app).post(`${CORSI}/${made.id}/esami`).set(token).send(examBody());
  if (exam.status !== 201) throw new Error(`exam: ${exam.status} ${JSON.stringify(exam.body)}`);
  setClock(`${TODAY}T09:00:00Z`);
  return { ...made, esameId: exam.body.id as string };
}

const start = (corsoId: string, esameId: string) => request(app).post(`${CORSI}/${corsoId}/esami/${esameId}/inizia`).set(a).send({});
const handIn = (corsoId: string, esameId: string, body: Record<string, unknown>) => request(app).post(`${CORSI}/${corsoId}/esami/${esameId}/consegna`).set(a).send(body);
const page = async (corsoId: string) => (await request(app).get(`${CORSI}/${corsoId}`).set(a)).body;
/** The choices for the exam's graded items: «a» is right in the fixtures, `wrong` lists the indexes answered «b». */
const choices = (domande: { id: string; tipo: string }[], wrong: number[] = []) =>
  domande.filter((d) => d.tipo === 'ESAME').map((d, i) => ({ domandaId: d.id, scelta: wrong.includes(i) ? 'b' : 'a' }));

async function allDone(corsoId: string, moduleIds: string[]) {
  for (const m of moduleIds) await studyModule(a, corsoId, m);
}

describe('opening the exam', () => {
  it('is locked until every module of the programme is done, then opens', async () => {
    const { id, moduleIds, esameId } = await withExam(2);
    expect((await page(id)).esame).toMatchObject({ stato: 'bloccato', esameId });
    expect((await start(id, esameId)).status).toBe(409);
    await studyModule(a, id, moduleIds[0]);
    expect((await start(id, esameId)).status).toBe(409);
    await studyModule(a, id, moduleIds[1]);
    expect((await page(id)).esame.stato).toBe('aperto');
    expect(await prisma.lingoCorsoTentativo.count()).toBe(0);
  });

  it('starts one attempt and gives the items without keys; coming back answers the same attempt', async () => {
    const { id, moduleIds, esameId } = await withExam(1);
    await allDone(id, moduleIds);
    const started = await start(id, esameId);
    expect(started.status).toBe(200);
    expect(started.body.tentativo).toMatchObject({ consegnatoIl: null, percentuale: null });
    expect(started.body.domande).toHaveLength(7);
    const text = JSON.stringify(started.body);
    for (const key of ['corretta', 'spiegazione', 'rispostaModello', 'rubrica', 'Perché la']) expect(text, key).not.toContain(key);
    const again = await start(id, esameId);
    expect(again.body.tentativo.id).toBe(started.body.tentativo.id);
    expect(await prisma.lingoCorsoTentativo.count()).toBe(1);
    expect((await page(id)).esame.stato).toBe('in-corso');
    // Neither the page nor the module reads carry the exam's keys.
    expect(JSON.stringify(await page(id))).not.toContain('corretta');
  });

  it('refuses a hand-in before the start, and an exam of another course', async () => {
    const { id, moduleIds, esameId } = await withExam(1);
    await allDone(id, moduleIds);
    expect((await handIn(id, esameId, { risposte: [] })).status).toBe(409);
    expect((await start(id, 'not-an-exam')).status).toBe(404);
  });
});

describe('handing in (§4: 70% overall, 60% on every competence)', () => {
  it('grades on the server, answers keys and explanations only now, and passes at 6 of 6', async () => {
    const { id, moduleIds, esameId } = await withExam(1);
    await allDone(id, moduleIds);
    const { domande } = (await start(id, esameId)).body;
    const done = await handIn(id, esameId, { risposte: choices(domande), aperta: { spuntate: [0, 1, 2] } });
    expect(done.status).toBe(200);
    expect(done.body.tentativo).toMatchObject({ percentuale: 100, superato: true, giorno: TODAY });
    expect(done.body.perCompetenza).toEqual([
      { codice: 'C1', percentuale: 100, superata: true },
      { codice: 'C2', percentuale: 100, superata: true },
      { codice: 'C3', percentuale: 100, superata: true },
    ]);
    expect(done.body.domande[0]).toMatchObject({ corretta: 'a', esito: { scelta: 'a', corretto: true } });
    expect(JSON.stringify(done.body)).toContain('Perché la prima.');
    // The ticks are stored on the opinion's row and never scored (Q6).
    const open = domande.find((d: { tipo: string }) => d.tipo === 'ESAME_APERTA');
    expect(await prisma.lingoCorsoEsito.findFirstOrThrow({ where: { domandaId: open.id } })).toMatchObject({ scelta: null, corretto: null, spuntate: [0, 1, 2] });
    expect(done.body.nuovoEsameDal).toBeNull();
  });

  it('takes the opinion’s ticks after the hand-in, once the rubric is shown, without changing the result', async () => {
    const { id, moduleIds, esameId } = await withExam(1);
    await allDone(id, moduleIds);
    const { domande } = (await start(id, esameId)).body;
    const tick = (spuntate: number[]) => request(app).post(`${CORSI}/${id}/esami/${esameId}/aperta`).set(a).send({ spuntate });
    expect((await tick([0])).status).toBe(409);
    const done = await handIn(id, esameId, { risposte: choices(domande, [5]) });
    const open = domande.find((d: { tipo: string }) => d.tipo === 'ESAME_APERTA');
    expect((await tick([2, 0])).body).toEqual({ domandaId: open.id, spuntate: [0, 2] });
    expect((await tick([3])).status).toBe(400);
    expect(await prisma.lingoCorsoTentativo.findFirstOrThrow()).toMatchObject({ percentuale: done.body.tentativo.percentuale, superato: false });
    expect((await start(id, esameId)).body.aperta).toEqual({ domandaId: open.id, spuntate: [0, 2] });
  });

  it('no compensation: 5 of 6 overall (83%) fails with one competence at 50%', async () => {
    const { id, moduleIds, esameId } = await withExam(1);
    await allDone(id, moduleIds);
    const { domande } = (await start(id, esameId)).body;
    const done = await handIn(id, esameId, { risposte: choices(domande, [5]) });
    expect(done.body.tentativo).toMatchObject({ percentuale: 83, superato: false });
    expect(done.body.perCompetenza.find((c: { codice: string }) => c.codice === 'C3')).toEqual({ codice: 'C3', percentuale: 50, superata: false });
  });

  it('fails under 70% overall with no competence under 50%; an item left without a choice is wrong', async () => {
    const { id, moduleIds, esameId } = await withExam(1);
    await allDone(id, moduleIds);
    const { domande } = (await start(id, esameId)).body;
    // C1 right twice, C2 and C3 once each (one left unanswered): 4 of 6, 66%.
    const sent = choices(domande, [2]).filter((_, i) => i !== 4);
    const done = await handIn(id, esameId, { risposte: sent });
    expect(done.body.tentativo).toMatchObject({ percentuale: 66, superato: false });
    const skipped = domande.filter((d: { tipo: string }) => d.tipo === 'ESAME')[4];
    expect(await prisma.lingoCorsoEsito.findFirstOrThrow({ where: { domandaId: skipped.id } })).toMatchObject({ scelta: null, corretto: false });
  });

  it('refuses an item of another exam, a choice not among the options, a criterion past the rubric', async () => {
    const { id, moduleIds, esameId } = await withExam(1);
    await allDone(id, moduleIds);
    const { domande } = (await start(id, esameId)).body;
    const recall = await prisma.lingoCorsoDomanda.findFirstOrThrow({ where: { tipo: 'RICHIAMO' } });
    expect((await handIn(id, esameId, { risposte: [{ domandaId: recall.id, scelta: 'a' }] })).status).toBe(400);
    expect((await handIn(id, esameId, { risposte: [{ domandaId: domande[0].id, scelta: 'e' }] })).status).toBe(400);
    expect((await handIn(id, esameId, { risposte: choices(domande), aperta: { spuntate: [4] } })).status).toBe(400);
    expect((await handIn(id, esameId, { risposte: choices(domande), punteggio: 100 })).status).toBe(400);
    expect(await prisma.lingoCorsoEsito.count({ where: { tentativoId: { not: null } } })).toBe(0);
  });

  it('a second hand-in answers the stored result; parallel hand-ins grade once', async () => {
    const { id, moduleIds, esameId } = await withExam(1);
    await allDone(id, moduleIds);
    const { domande } = (await start(id, esameId)).body;
    const [one, two] = await Promise.all([handIn(id, esameId, { risposte: choices(domande, [5]) }), handIn(id, esameId, { risposte: choices(domande) })]);
    expect([one.status, two.status]).toEqual([200, 200]);
    expect(one.body.tentativo).toEqual(two.body.tentativo);
    expect([one.body.xp, two.body.xp].filter((x) => x === null)).toHaveLength(1);
    expect(await prisma.lingoCorsoEsito.count({ where: { tentativoId: { not: null } } })).toBe(7);
    // Never shown twice: starting it again answers the result, with the keys.
    const again = await start(id, esameId);
    expect(again.body.tentativo.consegnatoIl).not.toBeNull();
    expect(again.body.domande[0].corretta).toBe('a');
  });

  it('a flag on an exam item changes not the attempt’s result (Q7)', async () => {
    const { id, moduleIds, esameId } = await withExam(1);
    await allDone(id, moduleIds);
    const { domande } = (await start(id, esameId)).body;
    const done = await handIn(id, esameId, { risposte: choices(domande, [0, 1]) });
    for (const d of domande.slice(0, 2)) {
      expect((await request(app).post(`${CORSI}/${id}/domande/${d.id}/segnala`).set(a).send({ motivo: 'Chiave sbagliata' })).status).toBe(200);
    }
    const attempt = await prisma.lingoCorsoTentativo.findFirstOrThrow();
    expect(attempt).toMatchObject({ percentuale: done.body.tentativo.percentuale, superato: false });
    expect((await handIn(id, esameId, { risposte: choices(domande) })).body.tentativo.percentuale).toBe(66);
  });
});

describe('after a failed attempt', () => {
  it('the page says «non superato», a new exam from the third Rome day, the competences under 60%', async () => {
    const { id, moduleIds, esameId } = await withExam(1);
    await allDone(id, moduleIds);
    const { domande } = (await start(id, esameId)).body;
    await handIn(id, esameId, { risposte: choices(domande, [4, 5]) });
    expect((await page(id)).esame).toMatchObject({ stato: 'non-superato', nuovoEsameDal: '2026-11-05', chiediNuovoEsame: false, competenzeSotto: ['C3'] });
    setClock('2026-11-05T09:00:00Z');
    expect((await page(id)).esame.chiediNuovoEsame).toBe(true);
    // The assistant's token lives on the real clock: the failed attempt is moved back in time instead.
    vi.useRealTimers();
    const now = romeDay(new Date());
    await prisma.lingoCorsoTentativo.updateMany({ data: { giorno: new Date(`${addDays(now, -2)}T00:00:00Z`) } });
    const early = await request(app).post(`${CORSI}/${id}/esami`).set(token).send(examBody());
    expect(early.status).toBe(409);
    expect(early.body.detail).toContain(`dal ${addDays(now, 1)}`);
    await prisma.lingoCorsoTentativo.updateMany({ data: { giorno: new Date(`${addDays(now, -3)}T00:00:00Z`) } });
    const fresh = await request(app).post(`${CORSI}/${id}/esami`).set(token).send(examBody());
    expect(fresh.status).toBe(201);
    expect(fresh.body.perIscrizione).toBe(true);
    expect((await page(id)).esame).toMatchObject({ stato: 'aperto', esameId: fresh.body.id });
  });
});

describe('«Percorso superato» and «Supera un percorso»', () => {
  /** Every competence «acquisita» from its cards: five «Bene» on `first` and seven days later. */
  async function acquireAll(corsoId: string, first: string, second: string) {
    for (const code of ['C1', 'C2', 'C3']) {
      const cards = await cardsOf(corsoId, code);
      await gradeByHand(alice, cards, `${first}T10:00:00Z`, [true, true, true, true, true]);
      await gradeByHand(alice, cards, `${second}T10:00:00Z`, [true, true, true, true, true]);
    }
  }

  it('needs the exam passed and every competence «acquisita»: then the day is written once and 100 XP credited', async () => {
    const { id, moduleIds, esameId } = await withExam(3);
    await allDone(id, moduleIds);
    const { domande } = (await start(id, esameId)).body;
    // Passed, but the competences are not yet acquired: not «superato».
    const passed = await handIn(id, esameId, { risposte: choices(domande) });
    expect(passed.body.tentativo.superato).toBe(true);
    expect(passed.body.xp.crediti).toEqual([]);
    expect((await page(id))).toMatchObject({ stato: 'in-corso', superatoIl: null, esame: { stato: 'superato' } });

    await acquireAll(id, '2026-10-20', '2026-10-27');
    const read = await page(id);
    expect(read).toMatchObject({ stato: 'superato', superatoIl: TODAY });
    expect(read.competenze.map((c: { stato: string }) => c.stato)).toEqual(['acquisita', 'acquisita', 'acquisita']);
    expect(read.xp.crediti).toEqual([{ missione: 'percorso', punti: 100 }]);
    const enrolment = await prisma.lingoCorsoIscrizione.findFirstOrThrow();
    expect((await courseCredits(alice)).filter((c) => c.missione === 'PERCORSO')).toEqual([
      expect.objectContaining({ periodo: `C:${id}`, fonteId: enrolment.id, fonte: 'ESAME', punti: 100 }),
    ]);
    // Once: the list says so too, and a later read credits nothing.
    expect((await page(id)).xp.crediti).toEqual([]);
    const list = (await request(app).get(CORSI).set(a)).body;
    expect(list[0]).toMatchObject({ stato: 'superato', competenze: { acquisite: 3, totale: 3 } });
  });

  it('is written in the hand-in’s transaction when the competences were already acquired, with the event’s XP', async () => {
    const { id, moduleIds, esameId } = await withExam(3);
    await acquireAll(id, '2026-10-20', '2026-10-27');
    await allDone(id, moduleIds);
    const { domande } = (await start(id, esameId)).body;
    const passed = await handIn(id, esameId, { risposte: choices(domande) });
    expect(passed.body.xp.crediti).toEqual([{ missione: 'percorso', punti: 100 }]);
    expect((await prisma.lingoCorsoIscrizione.findFirstOrThrow()).superatoIl).toEqual(new Date(`${TODAY}T00:00:00Z`));
  });

  it('earns no XP for a course under three modules', async () => {
    const { id, moduleIds, esameId } = await withExam(1);
    await acquireAll(id, '2026-10-20', '2026-10-27');
    await allDone(id, moduleIds);
    const { domande } = (await start(id, esameId)).body;
    const passed = await handIn(id, esameId, { risposte: choices(domande) });
    expect(passed.body.xp.crediti).toEqual([]);
    expect((await page(id)).stato).toBe('superato');
    expect((await courseCredits(alice)).filter((c) => c.missione === 'PERCORSO')).toEqual([]);
  });
});
