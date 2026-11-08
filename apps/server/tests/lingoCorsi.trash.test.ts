import { beforeEach, describe, expect, it } from 'vitest';
import { authHeader, createTestUser, type TestUser } from './helpers';
import { CORSI, acceptDeclaration, app, course, courseCards, delegatedAs, examBody, moduleBody, prisma, request, switchCourses, type Headers } from './corsiHelpers';
import { deleteUserAccount } from '../src/lingo/deleteUserAccount';

// Percorsi, S1 (spec 2026-10-23 §10.2, §10.9): a course and a module to the trash and back, a course card in the
// card trash, the dossier's link, the account's deletion leaving nothing, and the export.

let alice: TestUser;
let token: Headers;

beforeEach(async () => {
  alice = await createTestUser('alice');
  await switchCourses(true);
  await acceptDeclaration(alice);
  token = await delegatedAs(alice);
});

/** A course of one module, with cards, a first exam, an opened module, an outcome, an attempt and review rows. */
async function studied() {
  const c = await course(alice, token, 1, { moduliPrevisti: 1 });
  await courseCards(alice, c.id, c.moduleIds[0]);
  const exam = await request(app).post(`${CORSI}/${c.id}/esami`).set(token).send(examBody());
  const enrolment = await prisma.lingoCorsoIscrizione.findFirstOrThrow({ where: { corsoId: c.id } });
  const day = new Date('2026-10-20T00:00:00Z');
  await prisma.lingoCorsoModuloStato.create({ data: { iscrizioneId: enrolment.id, moduloId: c.moduleIds[0], fattoIl: new Date(), fattoGiorno: day, quizPercentuale: 80, giudizio: 4 } });
  const quizItem = await prisma.lingoCorsoDomanda.findFirstOrThrow({ where: { moduloId: c.moduleIds[0], tipo: 'QUIZ' } });
  await prisma.lingoCorsoEsito.create({ data: { iscrizioneId: enrolment.id, domandaId: quizItem.id, scelta: 'a', corretto: true, giorno: day, segnalatoIl: new Date(), segnalazione: 'Opzione ambigua' } });
  const attempt = await prisma.lingoCorsoTentativo.create({ data: { iscrizioneId: enrolment.id, esameId: exam.body.id } });
  const examItem = await prisma.lingoCorsoDomanda.findFirstOrThrow({ where: { esameId: exam.body.id, tipo: 'ESAME' } });
  await prisma.lingoCorsoEsito.create({ data: { iscrizioneId: enrolment.id, domandaId: examItem.id, tentativoId: attempt.id, scelta: 'b', giorno: day } });
  const card = await prisma.lingoCard.findFirstOrThrow({ where: { moduloId: c.moduleIds[0], competenze: { some: { competenza: { codice: 'C1' } } } } });
  await prisma.lingoStatoRipasso.create({ data: { utenteId: alice.id, cardId: card.id, stability: 3, difficulty: 5, dueAt: day, lastReviewAt: day } });
  await prisma.lingoRevisioneSRS.create({ data: { utenteId: alice.id, cardId: card.id, rating: 3, scheduledDays: 3, stability: 3, difficulty: 5 } });
  return { ...c, examId: exam.body.id as string, enrolmentId: enrolment.id, cardId: card.id };
}

/** Every row a course writes, counted: the same before the trash and after the restore. */
async function census() {
  const [corsi, competenze, moduli, blocchi, domande, dc, mc, esami, iscrizioni, stati, esiti, tentativi, carte, cc, stati2, log] = await Promise.all([
    prisma.lingoCorso.count(), prisma.lingoCorsoCompetenza.count(), prisma.lingoCorsoModulo.count(), prisma.lingoCorsoBlocco.count(),
    prisma.lingoCorsoDomanda.count(), prisma.lingoCorsoDomandaCompetenza.count(), prisma.lingoCorsoModuloCompetenza.count(), prisma.lingoCorsoEsame.count(),
    prisma.lingoCorsoIscrizione.count(), prisma.lingoCorsoModuloStato.count(), prisma.lingoCorsoEsito.count(), prisma.lingoCorsoTentativo.count(),
    prisma.lingoCard.count(), prisma.lingoCardCompetenza.count(), prisma.lingoStatoRipasso.count(), prisma.lingoRevisioneSRS.count(),
  ]);
  return { corsi, competenze, moduli, blocchi, domande, dc, mc, esami, iscrizioni, stati, esiti, tentativi, carte, cc, stati2, log };
}

describe('a course to the trash and back', () => {
  it('takes every row, names the dossier that stays, and restores them all with their ids', async () => {
    const c = await studied();
    const before = await census();
    const trashed = await request(app).delete(`${CORSI}/${c.id}`).set(authHeader(alice));
    expect(trashed.status).toBe(200);
    expect(trashed.body.dossier).toEqual({ id: c.dossier.id, name: 'Proprietà intellettuale' });
    expect(Object.values(await census()).every((n) => n === 0)).toBe(true);
    // The dossier is not in the payload: it stays.
    expect(await prisma.dossier.count({ where: { id: c.dossier.id } })).toBe(1);
    const list = await request(app).get('/api/trash').set(authHeader(alice));
    expect(list.body[0]).toMatchObject({ kind: 'LINGO_CORSO', label: 'Proprietà intellettuale', itemCount: 1, cardCount: 15 });

    const restored = await request(app).post(`/api/trash/${trashed.body.trashId}/restore`).set(authHeader(alice)).send({});
    expect(restored.status).toBe(200);
    expect(await census()).toEqual(before);
    const enrolment = await prisma.lingoCorsoIscrizione.findUniqueOrThrow({ where: { id: c.enrolmentId } });
    expect(enrolment.dossierId).toBe(c.dossier.id);
    expect((await prisma.lingoCard.findUniqueOrThrow({ where: { id: c.cardId } })).moduloId).toBe(c.moduleIds[0]);
    // A second restore is a 404.
    expect((await request(app).post(`/api/trash/${trashed.body.trashId}/restore`).set(authHeader(alice)).send({})).status).toBe(404);
  });

  it('comes back only under the 30 courses a user', async () => {
    const c = await course(alice, token);
    const trashed = await request(app).delete(`${CORSI}/${c.id}`).set(authHeader(alice));
    const textId = (await prisma.lingoTestoVersione.findFirstOrThrow({ where: { chiave: 'MATERIALE_STUDIO' } })).id;
    await prisma.lingoCorso.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ autoreId: alice.id, titolo: `C${i}`, materia: 'DIRITTO_CIVILE' as const, moduliPrevisti: 1, dichiarazioneTestoId: textId })) });
    expect((await request(app).post(`/api/trash/${trashed.body.trashId}/restore`).set(authHeader(alice)).send({})).status).toBe(409);
  });

  it('restores without the dossier when it went meanwhile', async () => {
    const c = await course(alice, token, 1);
    const trashed = await request(app).delete(`${CORSI}/${c.id}`).set(authHeader(alice));
    await prisma.dossier.delete({ where: { id: c.dossier.id } });
    expect((await request(app).post(`/api/trash/${trashed.body.trashId}/restore`).set(authHeader(alice)).send({})).status).toBe(200);
    expect((await prisma.lingoCorsoIscrizione.findFirstOrThrow({ where: { corsoId: c.id } })).dossierId).toBeNull();
  });

  it('is 404 for someone else', async () => {
    const c = await course(alice, token);
    const bob = await createTestUser('bob');
    expect((await request(app).delete(`${CORSI}/${c.id}`).set(authHeader(bob))).status).toBe(404);
  });
});

describe('the trash with the switch off', () => {
  it('neither lists, restores nor empties a course or a module, and keeps their rows; the rest of the trash works', async () => {
    const c = await course(alice, token, 2);
    const moduleTrashed = await request(app).delete(`${CORSI}/${c.id}/moduli/${c.moduleIds[1]}`).set(authHeader(alice));
    const other = await course(alice, token, 1);
    const courseTrashed = await request(app).delete(`${CORSI}/${other.id}`).set(authHeader(alice));
    const card = await prisma.lingoCard.create({ data: { autoreId: alice.id, materia: 'DIRITTO_CIVILE', istituto: 'Contratto', domanda: 'Che cos’è?', risposta: 'Un accordo.' } });
    const cardTrashed = await request(app).post('/api/lingo/cards/trash').set(authHeader(alice)).send({ cardIds: [card.id] });
    expect([moduleTrashed.status, courseTrashed.status, cardTrashed.status]).toEqual([200, 200, 200]);
    const ids = [moduleTrashed.body.trashId, courseTrashed.body.trashId];

    await switchCourses(false);
    const list = await request(app).get('/api/trash').set(authHeader(alice));
    expect(list.body.map((entry: { kind: string }) => entry.kind)).toEqual(['LINGO_CARDS']);
    for (const id of ids) {
      expect((await request(app).post(`/api/trash/${id}/restore`).set(authHeader(alice)).send({})).status).toBe(404);
      expect((await request(app).delete(`/api/trash/${id}`).set(authHeader(alice))).status).toBe(404);
    }
    expect(await prisma.trashEntry.count({ where: { id: { in: ids } } })).toBe(2);
    expect((await request(app).post(`/api/trash/${cardTrashed.body.trashId}/restore`).set(authHeader(alice)).send({})).status).toBe(200);

    // Switched on again, both are there and come back.
    await switchCourses(true);
    expect((await request(app).get('/api/trash').set(authHeader(alice))).body.map((entry: { kind: string }) => entry.kind).sort()).toEqual(['LINGO_CORSO', 'LINGO_CORSO_MODULO']);
    for (const id of ids) expect((await request(app).post(`/api/trash/${id}/restore`).set(authHeader(alice)).send({})).status).toBe(200);
    expect(await prisma.lingoCorso.count()).toBe(2);
    expect(await prisma.lingoCorsoModulo.count({ where: { corsoId: c.id } })).toBe(2);
  });
});

describe('a module to the trash', () => {
  it('only when never opened; back with its cards and its correction’s link', async () => {
    const c = await course(alice, token, 1);
    await courseCards(alice, c.id, c.moduleIds[0], 1);
    const correction = await prisma.lingoCorsoModulo.create({ data: { corsoId: c.id, ordine: 1, titolo: 'Corretto', domandePrima: [], sostituisceId: c.moduleIds[0] } });
    const trashed = await request(app).delete(`${CORSI}/${c.id}/moduli/${c.moduleIds[0]}`).set(authHeader(alice));
    expect(trashed.status).toBe(200);
    expect(await prisma.lingoCard.count()).toBe(0);
    expect((await prisma.lingoCorsoModulo.findUniqueOrThrow({ where: { id: correction.id } })).sostituisceId).toBeNull();
    // The programme stays as planned.
    expect((await prisma.lingoCorso.findUniqueOrThrow({ where: { id: c.id } })).moduliPrevisti).toBe(2);
    expect((await request(app).post(`/api/trash/${trashed.body.trashId}/restore`).set(authHeader(alice)).send({})).status).toBe(200);
    expect(await prisma.lingoCard.count()).toBe(3);
    expect(await prisma.lingoCardCompetenza.count()).toBe(3);
    expect((await prisma.lingoCorsoModulo.findUniqueOrThrow({ where: { id: correction.id } })).sostituisceId).toBe(c.moduleIds[0]);
    expect(await prisma.lingoCorsoDomanda.count({ where: { moduloId: c.moduleIds[0] } })).toBe(8);
  });

  it('is 404 for someone else’s course or module', async () => {
    const c = await course(alice, token, 1);
    const bob = await createTestUser('bob');
    expect((await request(app).delete(`${CORSI}/${c.id}/moduli/${c.moduleIds[0]}`).set(authHeader(bob))).status).toBe(404);
    const other = await course(alice, token, 1);
    expect((await request(app).delete(`${CORSI}/${c.id}/moduli/${other.moduleIds[0]}`).set(authHeader(alice))).status).toBe(404);
    expect(await prisma.lingoCorsoModulo.count()).toBe(2);
  });

  it('comes back only within the limits: not past a programme filled meanwhile', async () => {
    const c = await course(alice, token, 2);
    const trashed = await request(app).delete(`${CORSI}/${c.id}/moduli/${c.moduleIds[1]}`).set(authHeader(alice));
    // The assistant fills the programme again meanwhile.
    expect((await request(app).post(`${CORSI}/${c.id}/moduli`).set(token).send(moduleBody(null, { ordine: 2 }))).status).toBe(201);
    expect((await request(app).post(`/api/trash/${trashed.body.trashId}/restore`).set(authHeader(alice)).send({})).status).toBe(409);
    expect(await prisma.lingoCorsoModulo.count({ where: { corsoId: c.id } })).toBe(2);
  });

  it('is refused once opened (409), and its restore into a course gone is a 404', async () => {
    const c = await course(alice, token, 2);
    const enrolment = await prisma.lingoCorsoIscrizione.findFirstOrThrow({ where: { corsoId: c.id } });
    await prisma.lingoCorsoModuloStato.create({ data: { iscrizioneId: enrolment.id, moduloId: c.moduleIds[0] } });
    expect((await request(app).delete(`${CORSI}/${c.id}/moduli/${c.moduleIds[0]}`).set(authHeader(alice))).status).toBe(409);
    const trashed = await request(app).delete(`${CORSI}/${c.id}/moduli/${c.moduleIds[1]}`).set(authHeader(alice));
    await prisma.lingoCorso.delete({ where: { id: c.id } });
    expect((await request(app).post(`/api/trash/${trashed.body.trashId}/restore`).set(authHeader(alice)).send({})).status).toBe(404);
  });
});

describe('a course card in the card trash', () => {
  it('comes back tied to its module, or detached (still private) when the module is gone', async () => {
    const c = await course(alice, token, 1);
    await courseCards(alice, c.id, c.moduleIds[0], 1);
    const card = await prisma.lingoCard.findFirstOrThrow({ where: { moduloId: c.moduleIds[0] } });
    const first = await request(app).post('/api/lingo/cards/trash').set(authHeader(alice)).send({ cardIds: [card.id] });
    await request(app).post(`/api/trash/${first.body.trashId}/restore`).set(authHeader(alice)).send({});
    const back = await prisma.lingoCard.findUniqueOrThrow({ where: { id: card.id }, include: { competenze: true } });
    expect(back.moduloId).toBe(c.moduleIds[0]);
    expect(back.competenze).toHaveLength(1);

    const second = await request(app).post('/api/lingo/cards/trash').set(authHeader(alice)).send({ cardIds: [card.id] });
    await prisma.lingoCorsoModulo.delete({ where: { id: c.moduleIds[0] } });
    expect((await request(app).post(`/api/trash/${second.body.trashId}/restore`).set(authHeader(alice)).send({})).status).toBe(200);
    const detached = await prisma.lingoCard.findUniqueOrThrow({ where: { id: card.id }, include: { competenze: true } });
    expect(detached).toMatchObject({ moduloId: null, daPercorso: true });
    expect(detached.competenze).toEqual([]);
    expect((await request(app).post(`/api/lingo/cards/${card.id}/proponi`).set(authHeader(alice)).send({})).status).toBe(409);
  });
});

describe('the study dossier', () => {
  it('trashed: the enrolment loses its link; restored: links again', async () => {
    const c = await course(alice, token);
    const trashed = await request(app).delete(`/api/dossiers/${c.dossier.id}`).set(authHeader(alice));
    expect(trashed.status).toBe(200);
    expect((await prisma.lingoCorsoIscrizione.findFirstOrThrow({ where: { corsoId: c.id } })).dossierId).toBeNull();
    await request(app).post(`/api/trash/${trashed.body.trashId}/restore`).set(authHeader(alice)).send({});
    expect((await prisma.lingoCorsoIscrizione.findFirstOrThrow({ where: { corsoId: c.id } })).dossierId).toBe(c.dossier.id);
  });
});

describe('the account’s deletion', () => {
  it('leaves no row of a course, an opened module, outcomes, an attempt and course cards', async () => {
    await studied();
    await deleteUserAccount(alice.id);
    expect(Object.values(await census()).every((n) => n === 0)).toBe(true);
  });
});

describe('the export', () => {
  it('carries the courses whole but for the keys of an exam not handed in, and the cards’ module and codes', async () => {
    const c = await studied();
    const exported = await request(app).get('/api/auth/export').set(authHeader(alice));
    expect(exported.status).toBe(200);
    const [corso] = exported.body.data.lingoCorsi;
    expect(corso).toMatchObject({ id: c.id, competenze: [{ codice: 'C1' }, { codice: 'C2' }, { codice: 'C3' }] });
    expect(corso.moduli[0].domande[0]).toHaveProperty('corretta');
    const examText = JSON.stringify(corso.esami[0]);
    for (const key of ['corretta', 'spiegazione', 'rispostaModello', 'rubrica']) expect(examText).not.toContain(key);
    expect(corso.iscrizione).toMatchObject({ id: c.enrolmentId, dossierId: c.dossier.id });
    expect(corso.iscrizione.stati[0]).toMatchObject({ fattoGiorno: '2026-10-20', giudizio: 4 });
    expect(corso.iscrizione.esiti).toHaveLength(2);
    expect(corso.iscrizione.tentativi).toHaveLength(1);
    const card = exported.body.data.lingoCards.find((k: { id: string }) => k.id === c.cardId);
    expect(card).toMatchObject({ moduloId: c.moduleIds[0], daPercorso: true, competenze: ['C1'] });

    const one = await request(app).get(`${CORSI}/${c.id}/export`).set(authHeader(alice));
    expect(one.status).toBe(200);
    expect(one.body.corso).toEqual(corso);
    const bob = await createTestUser('bob');
    expect((await request(app).get(`${CORSI}/${c.id}/export`).set(authHeader(bob))).status).toBe(404);
  });
});
