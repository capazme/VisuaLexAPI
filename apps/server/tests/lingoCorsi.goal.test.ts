import { beforeEach, describe, expect, it } from 'vitest';
import { authHeader, createTestUser, type TestUser } from './helpers';
import { CORSI, acceptDeclaration, app, course, delegatedAs, prisma, request, switchCourses, type Headers } from './corsiHelpers';
import { addDays, romeDay } from '../src/lingo/studyDay';
import { examDateLimit } from '../src/lingo/courses';

// A Learn path's goal and exam date, the learner's (G-488; the web plan's item 26): on the enrolment, set with
// `PATCH /:id` from the web only, carried by the list, the page, «Oggi», the exports, and kept by the trash.

let alice: TestUser;
let bob: TestUser;
let token: Headers;
let session: Headers;
const TODAY = romeDay(new Date());
/** The same day five years on, written here rather than taken from the code. */
const FIVE_YEARS = `${Number(TODAY.slice(0, 4)) + 5}-${TODAY.slice(5) === '02-29' ? '02-28' : TODAY.slice(5)}`;

beforeEach(async () => {
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
  await switchCourses(true);
  await acceptDeclaration(alice);
  token = await delegatedAs(alice);
  session = authHeader(alice);
});

const patch = (id: string, body: unknown, as: Headers = session) => request(app).patch(`${CORSI}/${id}`).set(as).send(body as object);

describe('the goal and the exam date', () => {
  it('are set on the enrolment and every answer carries them', async () => {
    const { id } = await course(alice, token, 1);
    const examDay = addDays(TODAY, 40);
    const set = await patch(id, { obiettivo: { tipo: 'ESAME_AVVOCATO', nota: 'Sessione di dicembre, mezz’ora al giorno' }, dataEsame: examDay });
    expect(set.status).toBe(200);
    const goal = { obiettivo: { tipo: 'ESAME_AVVOCATO', nota: 'Sessione di dicembre, mezz’ora al giorno' }, dataEsame: examDay };
    expect(set.body).toMatchObject({ id, ...goal });

    const enrolment = await prisma.lingoCorsoIscrizione.findFirstOrThrow({ where: { corsoId: id } });
    expect(enrolment).toMatchObject({ obiettivo: 'ESAME_AVVOCATO', obiettivoNota: 'Sessione di dicembre, mezz’ora al giorno' });
    expect(enrolment.dataEsame?.toISOString().slice(0, 10)).toBe(examDay);

    expect((await request(app).get(CORSI).set(session)).body[0]).toMatchObject(goal);
    // The assistant reads the list too (`lingo:courses:read`): the goal is the user's, for planning.
    expect((await request(app).get(CORSI).set(token)).body[0]).toMatchObject(goal);
    expect((await request(app).get(`${CORSI}/${id}`).set(session)).body).toMatchObject(goal);
    const [today] = (await request(app).get(`${CORSI}/oggi`).set(session)).body;
    expect(today.corso).toMatchObject(goal);
    const exported = await request(app).get(`${CORSI}/${id}/export`).set(session);
    expect(exported.body.corso.iscrizione).toMatchObject({ obiettivo: 'ESAME_AVVOCATO', obiettivoNota: 'Sessione di dicembre, mezz’ora al giorno', dataEsame: examDay });
    const account = await request(app).get('/api/auth/export').set(session);
    expect(account.body.data.lingoCorsi[0].iscrizione).toMatchObject({ obiettivo: 'ESAME_AVVOCATO', dataEsame: examDay });
  });

  it('start empty, and null clears each one alone', async () => {
    const { id } = await course(alice, token, 1);
    expect((await request(app).get(`${CORSI}/${id}`).set(session)).body).toMatchObject({ obiettivo: null, dataEsame: null });
    await patch(id, { obiettivo: { tipo: 'ALTRO', nota: 'Il concorso in magistratura' }, dataEsame: TODAY });
    // A goal replaces kind and sentence together: without a sentence, none is kept.
    expect((await patch(id, { obiettivo: { tipo: 'ESAME_MATERIA' } })).body).toMatchObject({ obiettivo: { tipo: 'ESAME_MATERIA', nota: null }, dataEsame: TODAY });
    expect((await patch(id, { obiettivo: { tipo: 'ESAME_MATERIA', nota: '   ' } })).body.obiettivo).toEqual({ tipo: 'ESAME_MATERIA', nota: null });
    expect((await patch(id, { dataEsame: null })).body).toMatchObject({ obiettivo: { tipo: 'ESAME_MATERIA' }, dataEsame: null });
    expect((await patch(id, { obiettivo: null })).body).toMatchObject({ obiettivo: null, dataEsame: null });
    expect(await prisma.lingoCorsoIscrizione.findFirstOrThrow({ where: { corsoId: id } })).toMatchObject({ obiettivo: null, obiettivoNota: null, dataEsame: null });
  });

  it('a goal alone leaves the course as it was, and the title and the programme still change', async () => {
    const { id } = await course(alice, token, 1, { moduliPrevisti: 3 });
    const before = await prisma.lingoCorso.findUniqueOrThrow({ where: { id } });
    await patch(id, { obiettivo: { tipo: 'AGGIORNAMENTO_NORMATIVO' } });
    expect((await prisma.lingoCorso.findUniqueOrThrow({ where: { id } })).updatedAt).toEqual(before.updatedAt);
    const both = await patch(id, { titolo: 'Marchi', moduliPrevisti: 2, dataEsame: addDays(TODAY, 1) });
    expect(both.body).toMatchObject({ titolo: 'Marchi', moduliPrevisti: 2, obiettivo: { tipo: 'AGGIORNAMENTO_NORMATIVO' }, dataEsame: addDays(TODAY, 1) });
  });

  it('refuses a past date, one past five years, a day that does not exist, and a bad kind or sentence', async () => {
    const { id } = await course(alice, token, 1);
    const refused = await patch(id, { dataEsame: addDays(TODAY, -1) });
    expect(refused.status).toBe(400);
    expect(refused.body.detail).toBe('La data dell’esame è già passata.');
    expect((await patch(id, { dataEsame: TODAY })).status).toBe(200);
    expect((await patch(id, { dataEsame: FIVE_YEARS })).status).toBe(200);
    const far = await patch(id, { dataEsame: addDays(FIVE_YEARS, 1) });
    expect(far.status).toBe(400);
    expect(far.body.detail).toBe('La data dell’esame è troppo lontana: al massimo fra cinque anni.');
    for (const dataEsame of ['2027-02-30', '2027-13-01', '17/12/2027', '2027-12-17T00:00:00Z', 20271217]) {
      expect((await patch(id, { dataEsame })).status, String(dataEsame)).toBe(400);
    }
    for (const obiettivo of [{ tipo: 'CONCORSO' }, { tipo: 'esame_avvocato' }, { nota: 'Solo la frase' }, { tipo: 'ALTRO', altro: 1 }, 'ESAME_AVVOCATO']) {
      expect((await patch(id, { obiettivo })).status, JSON.stringify(obiettivo)).toBe(400);
    }
    // 200 characters, counted as characters: an emoji is one.
    expect((await patch(id, { obiettivo: { tipo: 'ALTRO', nota: '😀'.repeat(200) } })).status).toBe(200);
    expect((await patch(id, { obiettivo: { tipo: 'ALTRO', nota: 'a'.repeat(201) } })).status).toBe(400);
    expect((await patch(id, { obiettivo: { tipo: 'ALTRO', nota: 'riga\u0007' } })).status).toBe(400);
    // What was refused left nothing.
    expect((await request(app).get(`${CORSI}/${id}`).set(session)).body.dataEsame).toBe(FIVE_YEARS);
  });

  it('the limit is the same day five years on, and 29 February becomes the 28th', () => {
    expect(examDateLimit('2026-11-17')).toBe('2031-11-17');
    expect(examDateLimit('2028-02-29')).toBe('2033-02-28');
    expect(examDateLimit('2027-12-31')).toBe('2032-12-31');
  });

  it('are the session’s and the author’s: a token gets 403, someone else 404', async () => {
    const { id } = await course(alice, token, 1);
    expect((await patch(id, { dataEsame: TODAY }, token)).status).toBe(403);
    expect((await patch(id, { dataEsame: TODAY }, authHeader(bob))).status).toBe(404);
    expect(await prisma.lingoCorsoIscrizione.count({ where: { dataEsame: { not: null } } })).toBe(0);
  });

  it('a sentence needs a kind, in the database too', async () => {
    const { id } = await course(alice, token, 1);
    await expect(prisma.lingoCorsoIscrizione.updateMany({ where: { corsoId: id }, data: { obiettivoNota: 'Senza tipo' } })).rejects.toThrow();
    await expect(prisma.lingoCorsoIscrizione.updateMany({ where: { corsoId: id }, data: { obiettivo: 'ALTRO', obiettivoNota: '' } })).rejects.toThrow();
  });

  it('come back with the course from the trash', async () => {
    const { id } = await course(alice, token, 1);
    await patch(id, { obiettivo: { tipo: 'ESAME_AVVOCATO', nota: 'Dicembre' }, dataEsame: addDays(TODAY, 30) });
    const trashed = await request(app).delete(`${CORSI}/${id}`).set(session);
    expect(trashed.status).toBe(200);
    expect((await request(app).post(`/api/trash/${trashed.body.trashId}/restore`).set(session).send({})).status).toBe(200);
    expect((await request(app).get(`${CORSI}/${id}`).set(session)).body).toMatchObject({
      obiettivo: { tipo: 'ESAME_AVVOCATO', nota: 'Dicembre' }, dataEsame: addDays(TODAY, 30),
    });
  });
});
