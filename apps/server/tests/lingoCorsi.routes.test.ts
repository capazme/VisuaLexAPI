import { beforeEach, describe, expect, it } from 'vitest';
import { authHeader, createTestUser, type TestUser } from './helpers';
import {
  CORSI, acceptDeclaration, app, course, courseBody, courseCards, declarationId, delegatedAs, examBody, item, moduleBody, prisma, request,
  studyDossier, switchCourses, type Headers,
} from './corsiHelpers';
import { DELEGATED_ROUTES } from '../src/oauth/delegatedRoutes';
import { DELEGATED_COUNTERS } from '../src/middleware/delegated';

// Percorsi, S1 (spec 2026-10-23 §10.5, §10.6, §10.10–§10.12): the switch, the declaration, creating a course, a
// module and an exam with the format's checks and the limits, the reads that need no mastery, and scoping.

let alice: TestUser;
let bob: TestUser;
let token: Headers;

beforeEach(async () => {
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
  await switchCourses(true);
  await acceptDeclaration(alice);
  token = await delegatedAs(alice);
});

describe('the switch lingo_courses', () => {
  it('off: every route 404, the accept route 404, the card route refuses a module, /features says so', async () => {
    const { id } = await course(alice, token, 1);
    await switchCourses(false);
    expect((await request(app).get(CORSI).set(authHeader(alice))).status).toBe(404);
    expect((await request(app).get(CORSI).set(token)).status).toBe(404);
    expect((await request(app).post(`${CORSI}/${id}/moduli`).set(token).send(moduleBody(null))).status).toBe(404);
    expect((await request(app).delete(`${CORSI}/${id}`).set(authHeader(alice))).status).toBe(404);
    const accept = await request(app).post('/api/lingo/testi/MATERIALE_STUDIO/accetta').set(authHeader(bob)).send({ testoId: await declarationId() });
    expect(accept.status).toBe(404);
    const modulo = await prisma.lingoCorsoModulo.findFirstOrThrow();
    const tied = { materia: 'DIRITTO_CIVILE', istituto: 'Ditta', domanda: 'Che cos’è?', risposta: 'Il nome.', ancore: [{ riferimento: 'art. 2563 c.c.' }], competenze: ['C1'] };
    expect((await request(app).post('/api/lingo/cards').set(authHeader(alice)).send({ moduloId: modulo.id, cards: [tied] })).status).toBe(404);
    expect((await request(app).get('/api/features')).body).toMatchObject({ lingoCourses: false });
    // Switching off hides, never deletes.
    expect(await prisma.lingoCorso.count()).toBe(1);
  });

  it('on: /features says so', async () => {
    expect((await request(app).get('/api/features')).body).toMatchObject({ lingoCourses: true });
  });
});

describe('the declaration MATERIALE_STUDIO', () => {
  it('is version 1 with the words of §12, and the course waits for it (409 with the text and the link)', async () => {
    const read = await request(app).get('/api/lingo/testi/MATERIALE_STUDIO').set(authHeader(bob));
    expect(read.body).toMatchObject({ chiave: 'MATERIALE_STUDIO', versione: 1, titolo: 'Il tuo materiale di studio', azione: 'Accetto', accettata: false });
    expect(read.body.corpo).toContain('I file che dai al tuo assistente non arrivano a VisuaLex');

    const bobToken = await delegatedAs(bob);
    const dossier = await studyDossier(bob);
    const refused = await request(app).post(CORSI).set(bobToken).send(courseBody(dossier.id));
    expect(refused.status).toBe(409);
    expect(refused.body.richiedeTesto).toMatchObject({ id: read.body.id, accettata: false });
    expect(refused.body.link).toBe('/studia/percorsi');
    expect(await prisma.lingoCorso.count()).toBe(0);

    const stale = await request(app).post('/api/lingo/testi/MATERIALE_STUDIO/accetta').set(authHeader(bob)).send({ testoId: 'not-the-current-one' });
    expect(stale.status).toBe(409);
    expect(stale.body.richiedeTesto.id).toBe(read.body.id);
    const accepted = await request(app).post('/api/lingo/testi/MATERIALE_STUDIO/accetta').set(authHeader(bob)).send({ testoId: read.body.id });
    expect(accepted.status).toBe(200);
    expect(accepted.body.accettata).toBe(true);
    // Twice is harmless.
    expect((await request(app).post('/api/lingo/testi/MATERIALE_STUDIO/accetta').set(authHeader(bob)).send({ testoId: read.body.id })).status).toBe(200);
    expect((await request(app).post(CORSI).set(bobToken).send(courseBody(dossier.id))).status).toBe(201);
  });

  it('is accepted by the session only', async () => {
    const accept = await request(app).post('/api/lingo/testi/MATERIALE_STUDIO/accetta').set(token).send({ testoId: await declarationId() });
    expect(accept.status).toBe(403);
  });
});

describe('POST /lingo/corsi', () => {
  it('creates the course, C1…, the author’s enrolment with the dossier, and the provenance', async () => {
    const dossier = await studyDossier(alice);
    const created = await request(app).post(CORSI).set(token).send(courseBody(dossier.id));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      titolo: 'Proprietà intellettuale', materia: 'DIRITTO_CIVILE', moduliPrevisti: 2,
      competenze: [{ codice: 'C1' }, { codice: 'C2' }, { codice: 'C3' }],
      dossier: { id: dossier.id, name: 'Proprietà intellettuale' },
    });
    const row = await prisma.lingoCorso.findUniqueOrThrow({ where: { id: created.body.id }, include: { iscrizioni: true } });
    expect(row.createdByClientId).not.toBeNull();
    expect(row.dichiarazioneTestoId).toBe(await declarationId());
    expect(row.iscrizioni).toEqual([expect.objectContaining({ utenteId: alice.id, dossierId: dossier.id })]);
  });

  it('is for a connected application: the session gets 403', async () => {
    const dossier = await studyDossier(alice);
    expect((await request(app).post(CORSI).set(authHeader(alice)).send(courseBody(dossier.id))).status).toBe(403);
  });

  it('needs the write scope', async () => {
    const reader = await delegatedAs(alice, 'lingo:courses:read');
    const dossier = await studyDossier(alice);
    expect((await request(app).post(CORSI).set(reader).send(courseBody(dossier.id))).status).toBe(403);
  });

  it('refuses a work dossier (400) and someone else’s (404)', async () => {
    const work = await studyDossier(alice, 'lavoro');
    expect((await request(app).post(CORSI).set(token).send(courseBody(work.id))).status).toBe(400);
    const theirs = await studyDossier(bob);
    expect((await request(app).post(CORSI).set(token).send(courseBody(theirs.id))).status).toBe(404);
  });

  it('refuses an unknown key, a NUL, a subject not among the five', async () => {
    const dossier = await studyDossier(alice);
    expect((await request(app).post(CORSI).set(token).send({ ...courseBody(dossier.id), file: 'x' })).status).toBe(400);
    expect((await request(app).post(CORSI).set(token).send(courseBody(dossier.id, { titolo: 'a\u0000b' }))).status).toBe(400);
    expect((await request(app).post(CORSI).set(token).send(courseBody(dossier.id, { materia: 'PROPRIETA_INTELLETTUALE' }))).status).toBe(400);
    expect((await request(app).post(CORSI).set(token).send(courseBody(dossier.id, { moduliPrevisti: 41 }))).status).toBe(400);
    expect((await request(app).post(CORSI).set(token).send(courseBody(dossier.id, { competenze: [] }))).status).toBe(400);
  });

  it('holds 30 courses a user', async () => {
    const dossier = await studyDossier(alice);
    const textId = await declarationId();
    for (let i = 0; i < 30; i++) {
      await prisma.lingoCorso.create({ data: { autoreId: alice.id, titolo: `C${i}`, materia: 'DIRITTO_CIVILE', moduliPrevisti: 1, dichiarazioneTestoId: textId } });
    }
    expect((await request(app).post(CORSI).set(token).send(courseBody(dossier.id))).status).toBe(409);
  });
});

describe('POST /lingo/corsi/:id/moduli', () => {
  it('stores the module whole, the citations as copies of the dossier’s entries', async () => {
    const { id, dossier } = await course(alice, token);
    const added = await request(app).post(`${CORSI}/${id}/moduli`).set(token).send(moduleBody(dossier.ids));
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ ordine: 1, titolo: 'La ditta', blocchi: 1, citazioni: 2, domande: 8, corso: { moduli: { contati: 1, previsti: 2 } } });
    const block = await prisma.lingoCorsoBlocco.findFirstOrThrow({ where: { moduloId: added.body.id } });
    expect(block.parole).toBeGreaterThan(10);
    const citations = block.citazioni as { marcatore: string; voce: string; tipo: string; citation: string | null; riferimento: Record<string, unknown> }[];
    expect(citations.map((c) => [c.marcatore, c.tipo])).toEqual([['c1', 'norm'], ['c2', 'sentenza']]);
    expect(citations[0].citation).toMatch(/2563/);
    expect(citations[0].riferimento).toMatchObject({ tipo_atto: 'codice civile', numero_articolo: '2563' });
    // The copy survives the entry's removal.
    await prisma.dossierItem.delete({ where: { id: dossier.ids.norm } });
    expect((await prisma.lingoCorsoBlocco.findFirstOrThrow({ where: { id: block.id } })).citazioni).toEqual(block.citazioni);
    const items = await prisma.lingoCorsoDomanda.findMany({ where: { moduloId: added.body.id }, include: { competenze: true } });
    expect(items.map((i) => i.tipo).sort()).toEqual(['APERTA', 'QUIZ', 'QUIZ', 'QUIZ', 'QUIZ', 'QUIZ', 'QUIZ', 'RICHIAMO']);
    expect(items.every((i) => i.competenze.length > 0)).toBe(true);
    expect(items.find((i) => i.tipo === 'RICHIAMO')!.bloccoId).toBe(block.id);
  });

  const refusals: [string, (d: { norm: string; decision: string }) => Record<string, unknown>, RegExp][] = [
    ['an HTML tag', (d) => moduleBody(d, { blocchi: [{ testo: 'Testo <script>x</script> ([a](#c1)) ([b](#c2))', citazioni: [{ marcatore: 'c1', voce: d.norm }, { marcatore: 'c2', voce: d.decision }] }] }), /Blocco 1: contiene tag HTML/],
    ['a URL in a link', () => moduleBody(null, { blocchi: [{ testo: 'Vedi [qui](https://example.org).' }] }), /Blocco 1: un link può solo citare/],
    ['an image', () => moduleBody(null, { blocchi: [{ testo: 'Vedi ![x](#c1).' }] }), /Blocco 1: le immagini/],
    ['a tab', () => moduleBody(null, { blocchi: [{ testo: 'Testo\tcon tab.' }] }), /Carattere non valido/],
    ['a carriage return', () => moduleBody(null, { blocchi: [{ testo: 'Testo\r\naltro.' }] }), /Carattere non valido/],
    ['a heading of another level', () => moduleBody(null, { blocchi: [{ testo: '## Titolo\nTesto.' }] }), /Blocco 1: sono ammessi solo titoli/],
    ['a nested list', () => moduleBody(null, { blocchi: [{ testo: '- uno\n  - due' }] }), /Blocco 1: una riga rientrata/],
    ['code', () => moduleBody(null, { blocchi: [{ testo: 'Usa `codice`.' }] }), /Blocco 1: il codice/],
    ['a link definition in a quote', () => moduleBody(null, { blocchi: [{ testo: 'Vedi [x].\n> [x]: https://example.org' }] }), /Blocco 1: i riferimenti a link/],
    ['a link definition in a list', () => moduleBody(null, { blocchi: [{ testo: '- [x]: javascript:alert(1)\n\n[x]' }] }), /Blocco 1: i riferimenti a link/],
    ['a processing instruction', () => moduleBody(null, { blocchi: [{ testo: 'Testo <?xml?>.' }] }), /Blocco 1: contiene tag HTML/],
    ['a marker with no entry', () => moduleBody(null, { blocchi: [{ testo: 'Vedi [qui](#c1).' }] }), /Blocco 1: il testo cita #c1/],
    ['an entry not used', (d) => moduleBody(null, { blocchi: [{ testo: 'Testo.', citazioni: [{ marcatore: 'c1', voce: d.norm }] }] }), /Blocco 1: la citazione c1 non è usata/],
    ['a quiz under half application', () => moduleBody(null, { quiz: [item(['C1']), item(['C2']), item(['C1'], false), item(['C2'], false), item(['C3'], false), item(['C3'], false)] }), /Quiz: almeno metà/],
    ['an unknown competence', () => moduleBody(null, { competenze: ['C1', 'C9'] }), /Modulo: la competenza C9 non è di questo percorso/],
    ['an item outside the module’s competences', () => moduleBody(null, { competenze: ['C1', 'C2'] }), /Quiz, domanda 3: la competenza C3 non è tra quelle del modulo/],
    ['an unknown key', () => ({ ...moduleBody(null), audio: 'x' }), /.+/],
    ['five quiz items', () => moduleBody(null, { quiz: [item(['C1']), item(['C2']), item(['C3']), item(['C1'], false), item(['C2'], false)] }), /.+/],
    ['a right key not among the options', () => moduleBody(null, { quiz: [...moduleBody(null).quiz.slice(1), { ...item(['C1']), corretta: 'f' }] }), /.+/],
    ['a rubric of two criteria', () => moduleBody(null, { aperta: { ...moduleBody(null).aperta, rubrica: ['a', 'b'] } }), /.+/],
  ];
  for (const [what, body, message] of refusals) {
    it(`refuses ${what} whole, with an Italian 400`, async () => {
      const { id, dossier } = await course(alice, token);
      const refused = await request(app).post(`${CORSI}/${id}/moduli`).set(token).send(body(dossier.ids));
      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.body)).toMatch(message);
      expect(await prisma.lingoCorsoModulo.count()).toBe(0);
    });
  }

  it('refuses a citation outside the dossier, or of a note', async () => {
    const { id, dossier } = await course(alice, token);
    const other = await studyDossier(alice);
    const body = (voce: string) => moduleBody(null, { blocchi: [{ testo: 'Vedi [qui](#c1).', citazioni: [{ marcatore: 'c1', voce }] }] });
    const foreign = await request(app).post(`${CORSI}/${id}/moduli`).set(token).send(body(other.ids.norm));
    expect(foreign.body.detail ?? foreign.body.error).toMatch(/Blocco 1, citazione c1: la voce non è nel dossier del percorso/);
    const note = await request(app).post(`${CORSI}/${id}/moduli`).set(token).send(body(dossier.ids.note));
    expect(note.status).toBe(400);
    expect(JSON.stringify(note.body)).toMatch(/solo norme e sentenze/);
  });

  it('with the dossier gone: 409 with citations, accepted without', async () => {
    const { id, dossier } = await course(alice, token);
    await prisma.dossier.delete({ where: { id: dossier.id } });
    expect((await request(app).post(`${CORSI}/${id}/moduli`).set(token).send(moduleBody(dossier.ids))).status).toBe(409);
    expect((await request(app).post(`${CORSI}/${id}/moduli`).set(token).send(moduleBody(null))).status).toBe(201);
  });

  it('measures the body first: past 300,000 characters an Italian 400', async () => {
    const { id } = await course(alice, token);
    const long = 'parola '.repeat(1_700);
    const huge = { ...item(['C1']), testo: 'x'.repeat(2_000), opzioni: Array.from({ length: 6 }, (_, i) => ({ chiave: 'abcdef'[i], testo: 'y'.repeat(500), spiegazione: 'z'.repeat(1_500) })) };
    const blocks = Array.from({ length: 12 }, () => ({ testo: long.slice(0, 11_900), richiamo: [huge, huge] }));
    const body = moduleBody(null, { blocchi: blocks, quiz: Array.from({ length: 10 }, () => ({ ...item(['C1']), testo: 'x'.repeat(2_000), opzioni: Array.from({ length: 6 }, (_, i) => ({ chiave: 'abcdef'[i], testo: 'y'.repeat(500), spiegazione: 'z'.repeat(1_500) })) })) });
    const refused = await request(app).post(`${CORSI}/${id}/moduli`).set(token).send(body);
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toMatch(/300\.000 caratteri/);
  });

  it('takes a correction that names a module of the course, not one of another course', async () => {
    const { id, moduleIds } = await course(alice, token, 1);
    const other = await course(alice, token, 1);
    const correction = await request(app).post(`${CORSI}/${id}/moduli`).set(token).send(moduleBody(null, { sostituisceId: moduleIds[0] }));
    expect(correction.status).toBe(201);
    // It shares the order and does not count twice.
    expect(correction.body.corso.moduli.contati).toBe(1);
    const foreign = await request(app).post(`${CORSI}/${id}/moduli`).set(token).send(moduleBody(null, { sostituisceId: other.moduleIds[0] }));
    expect(foreign.status).toBe(400);
  });

  it('holds 40 counting modules', async () => {
    const { id } = await course(alice, token, 0, { moduliPrevisti: 40 });
    await prisma.lingoCorsoModulo.createMany({ data: Array.from({ length: 40 }, (_, i) => ({ corsoId: id, ordine: i + 1, titolo: `M${i}`, domandePrima: [] })) });
    const refused = await request(app).post(`${CORSI}/${id}/moduli`).set(token).send(moduleBody(null, { ordine: 41 }));
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toMatch(/al massimo 40 moduli/);
  });

  it('refuses a module past the programme, never a correction', async () => {
    const { id, moduleIds } = await course(alice, token, 2);
    const past = await request(app).post(`${CORSI}/${id}/moduli`).set(token).send(moduleBody(null, { ordine: 3 }));
    expect(past.status).toBe(409);
    expect(past.body.detail).toMatch(/Il programma ha 2 moduli/);
    expect((await request(app).post(`${CORSI}/${id}/moduli`).set(token).send(moduleBody(null, { sostituisceId: moduleIds[1] }))).status).toBe(201);
  });

  it('is 404 on someone else’s course, an unknown one, and a NUL id', async () => {
    const bobToken = await delegatedAs(bob);
    await acceptDeclaration(bob);
    const theirs = await course(bob, bobToken);
    expect((await request(app).post(`${CORSI}/${theirs.id}/moduli`).set(token).send(moduleBody(null))).status).toBe(404);
    expect((await request(app).post(`${CORSI}/nothing/moduli`).set(token).send(moduleBody(null))).status).toBe(404);
    expect((await request(app).post(`${CORSI}/a%00b/moduli`).set(authHeader(alice)).send(moduleBody(null))).status).toBe(404);
  });

  it('is for a connected application only', async () => {
    const { id } = await course(alice, token);
    expect((await request(app).post(`${CORSI}/${id}/moduli`).set(authHeader(alice)).send(moduleBody(null))).status).toBe(403);
  });
});

describe('POST /lingo/corsi/:id/esami', () => {
  it('waits for the programme, the cards, then takes the first exam; one open at a time', async () => {
    const { id, moduleIds } = await course(alice, token, 1);
    // One module of two.
    const early = await request(app).post(`${CORSI}/${id}/esami`).set(token).send(examBody());
    expect(early.status).toBe(409);
    expect(early.body.detail ?? early.body.error).toMatch(/1 di 2 moduli/);
    // «Il programma finisce qui».
    expect((await request(app).patch(`${CORSI}/${id}`).set(authHeader(alice)).send({ moduliPrevisti: 1 })).status).toBe(200);
    const noCards = await request(app).post(`${CORSI}/${id}/esami`).set(token).send(examBody());
    expect(noCards.status).toBe(409);
    expect(noCards.body.detail ?? noCards.body.error).toMatch(/C1 ha 0 schede su 5/);
    await courseCards(alice, id, moduleIds[0]);
    const first = await request(app).post(`${CORSI}/${id}/esami`).set(token).send(examBody());
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ domande: 7, perIscrizione: false });
    const second = await request(app).post(`${CORSI}/${id}/esami`).set(token).send(examBody());
    expect(second.status).toBe(409);
  });

  it('is 404 on someone else’s course', async () => {
    const bobToken = await delegatedAs(bob);
    await acceptDeclaration(bob);
    const theirs = await course(bob, bobToken, 1, { moduliPrevisti: 1 });
    await courseCards(bob, theirs.id, theirs.moduleIds[0]);
    expect((await request(app).post(`${CORSI}/${theirs.id}/esami`).set(token).send(examBody())).status).toBe(404);
    expect(await prisma.lingoCorsoEsame.count()).toBe(0);
  });

  it('needs two application items per competence and one open item', async () => {
    const { id, moduleIds } = await course(alice, token, 1, { moduliPrevisti: 1 });
    await courseCards(alice, id, moduleIds[0]);
    const short = await request(app).post(`${CORSI}/${id}/esami`).set(token).send(examBody({ domande: ['C1', 'C1', 'C2', 'C2', 'C3'].map((c) => item([c])) }));
    expect(short.status).toBe(400);
    expect(JSON.stringify(short.body)).toMatch(/competenza C3/);
    const noOpen = await request(app).post(`${CORSI}/${id}/esami`).set(token).send({ domande: examBody().domande });
    expect(noOpen.status).toBe(400);
  });

  it('after a failed attempt: a new exam from the third Rome day, for the enrolment; none after a pass', async () => {
    const { id, moduleIds } = await course(alice, token, 1, { moduliPrevisti: 1 });
    await courseCards(alice, id, moduleIds[0]);
    const first = await request(app).post(`${CORSI}/${id}/esami`).set(token).send(examBody());
    const enrolment = await prisma.lingoCorsoIscrizione.findFirstOrThrow({ where: { corsoId: id } });
    const today = new Date().toISOString().slice(0, 10);
    // A failed attempt today (S2 writes it; here by hand).
    const attempt = await prisma.lingoCorsoTentativo.create({
      data: { iscrizioneId: enrolment.id, esameId: first.body.id, consegnatoIl: new Date(), giorno: new Date(`${today}T00:00:00Z`), percentuale: 50, superato: false },
    });
    const paused = await request(app).post(`${CORSI}/${id}/esami`).set(token).send(examBody());
    expect(paused.status).toBe(409);
    expect(paused.body.detail ?? paused.body.error).toMatch(/dal \d{4}-\d{2}-\d{2}/);
    await prisma.lingoCorsoTentativo.update({ where: { id: attempt.id }, data: { giorno: new Date(Date.now() - 4 * 86_400_000) } });
    const again = await request(app).post(`${CORSI}/${id}/esami`).set(token).send(examBody());
    expect(again.status).toBe(201);
    expect(again.body.perIscrizione).toBe(true);
    expect((await prisma.lingoCorsoEsame.findUniqueOrThrow({ where: { id: again.body.id } })).iscrizioneId).toBe(enrolment.id);
    await prisma.lingoCorsoTentativo.create({
      data: { iscrizioneId: enrolment.id, esameId: again.body.id, consegnatoIl: new Date(), giorno: new Date(`${today}T00:00:00Z`), percentuale: 90, superato: true },
    });
    expect((await request(app).post(`${CORSI}/${id}/esami`).set(token).send(examBody())).status).toBe(409);
  });
});

describe('reads', () => {
  it('GET / lists the caller’s courses with their state and next step, for the session and a token', async () => {
    const { id, moduleIds } = await course(alice, token, 1, { moduliPrevisti: 1 });
    const list = await request(app).get(CORSI).set(authHeader(alice));
    expect(list.status).toBe(200);
    expect(list.body).toEqual([
      expect.objectContaining({
        id, stato: 'in-preparazione', competenze: { acquisite: 0, totale: 3 }, moduli: { contati: 1, previsti: 1 },
        prossimo: { tipo: 'modulo', id: moduleIds[0], ordine: 1, titolo: 'Modulo 1' },
      }),
    ]);
    await courseCards(alice, id, moduleIds[0]);
    await request(app).post(`${CORSI}/${id}/esami`).set(token).send(examBody());
    expect((await request(app).get(CORSI).set(token)).body[0].stato).toBe('in-corso');
    expect((await request(app).get(CORSI).set(authHeader(bob))).body).toEqual([]);
  });

  it('GET /:id/struttura gives the assistant the keys, except an exam’s not yet handed in', async () => {
    const { id, moduleIds } = await course(alice, token, 1, { moduliPrevisti: 1 });
    await courseCards(alice, id, moduleIds[0]);
    await request(app).post(`${CORSI}/${id}/esami`).set(token).send(examBody());
    const read = await request(app).get(`${CORSI}/${id}/struttura`).set(token);
    expect(read.status).toBe(200);
    expect(read.body.moduli[0].domande[0]).toHaveProperty('corretta');
    expect(read.body.moduli[0].domande[0].opzioni[0]).toHaveProperty('spiegazione');
    const exam = read.body.esami[0];
    expect(exam.consegnato).toBe(false);
    const examText = JSON.stringify(exam);
    for (const key of ['corretta', 'spiegazione', 'rispostaModello', 'rubrica']) expect(examText).not.toContain(key);
    expect(read.body).toMatchObject({ segnalazioni: [], giudizi: [], stato: 'in-corso' });
    // The session reads the course page (S2), not this.
    expect((await request(app).get(`${CORSI}/${id}/struttura`).set(authHeader(alice))).status).toBe(403);
    const bobToken = await delegatedAs(bob);
    expect((await request(app).get(`${CORSI}/${id}/struttura`).set(bobToken)).status).toBe(404);
  });
});

describe('PATCH /lingo/corsi/:id', () => {
  it('renames and lowers the programme, never raises it nor goes under the counting modules', async () => {
    const { id } = await course(alice, token, 1, { moduliPrevisti: 3 });
    const session = authHeader(alice);
    expect((await request(app).patch(`${CORSI}/${id}`).set(session).send({ titolo: 'Marchi' })).body).toMatchObject({ titolo: 'Marchi', moduliPrevisti: 3 });
    expect((await request(app).patch(`${CORSI}/${id}`).set(session).send({ moduliPrevisti: 4 })).status).toBe(400);
    expect((await request(app).patch(`${CORSI}/${id}`).set(session).send({ moduliPrevisti: 0 })).status).toBe(400);
    expect((await request(app).patch(`${CORSI}/${id}`).set(session).send({ moduliPrevisti: 1 })).body.moduliPrevisti).toBe(1);
    expect((await request(app).patch(`${CORSI}/${id}`).set(session).send({})).status).toBe(400);
    expect((await request(app).patch(`${CORSI}/${id}`).set(authHeader(bob)).send({ titolo: 'X' })).status).toBe(404);
    // Not delegated.
    expect((await request(app).patch(`${CORSI}/${id}`).set(token).send({ titolo: 'X' })).status).toBe(403);
  });
});

describe('course cards through POST /lingo/cards', () => {
  it('needs the courses’ write scope, the module’s competences, and keeps them out of the community and the review', async () => {
    const { id, moduleIds } = await course(alice, token, 1);
    const cardsOnly = await delegatedAs(alice, 'lingo:cards:write');
    const card = { materia: 'DIRITTO_CIVILE', istituto: 'Ditta', domanda: 'Che cos’è?', risposta: 'Il nome.', ancore: [{ riferimento: 'art. 2563 c.c.' }], competenze: ['C1'] };
    const noScope = await request(app).post('/api/lingo/cards').set(cardsOnly).send({ moduloId: moduleIds[0], cards: [card] });
    expect(noScope.status).toBe(403);
    const unknown = await request(app).post('/api/lingo/cards').set(authHeader(alice)).send({ moduloId: moduleIds[0], cards: [{ ...card, competenze: ['C7'] }] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.detail ?? unknown.body.error).toMatch(/C7/);
    const without = await request(app).post('/api/lingo/cards').set(authHeader(alice)).send({ cards: [card] });
    expect(without.status).toBe(400);
    const theirs = await request(app).post('/api/lingo/cards').set(authHeader(bob)).send({ moduloId: moduleIds[0], cards: [card] });
    expect(theirs.status).toBe(404);

    // A course card made as the route would: never proposed, never in the review before S2.
    await courseCards(alice, id, moduleIds[0], 1);
    const tied = await prisma.lingoCard.findFirstOrThrow({ where: { moduloId: moduleIds[0] } });
    const proposed = await request(app).post(`/api/lingo/cards/${tied.id}/proponi`).set(authHeader(alice)).send({});
    expect(proposed.status).toBe(409);
    expect(proposed.body.detail ?? proposed.body.error).toMatch(/restano private/);
    const counts = await request(app).get('/api/lingo/srs/conteggi').set(authHeader(alice));
    expect(counts.body.nuove).toBe(0);
  });

  it('holds 20 cards a module', async () => {
    const { id, moduleIds } = await course(alice, token, 1);
    await courseCards(alice, id, moduleIds[0], 7); // 21 across three competences
    const card = { materia: 'DIRITTO_CIVILE', istituto: 'Ditta', domanda: 'Che cos’è?', risposta: 'Il nome.', ancore: [{ riferimento: 'art. 2563 c.c.' }], competenze: ['C1'] };
    // Checked before the sources are asked (and again in the transaction).
    const refused = await request(app).post('/api/lingo/cards').set(authHeader(alice)).send({ moduloId: moduleIds[0], cards: [card] });
    expect(refused.status).toBe(409);
  });
});

describe('the delegated table (§10.6)', () => {
  it('names the five routes with their scopes and counters, and no study route', () => {
    const rows = DELEGATED_ROUTES.filter((r) => r.path.startsWith('/lingo/corsi'));
    expect(rows.map((r) => [r.method, r.path, r.scope, r.weight, r.counter ?? null])).toEqual([
      ['GET', '/lingo/corsi', 'lingo:courses:read', 1, null],
      ['GET', '/lingo/corsi/:id/struttura', 'lingo:courses:read', 1, null],
      ['POST', '/lingo/corsi', 'lingo:courses:write', 2, 'corso'],
      ['POST', '/lingo/corsi/:id/moduli', 'lingo:courses:write', 3, 'modulo'],
      ['POST', '/lingo/corsi/:id/esami', 'lingo:courses:write', 3, 'modulo'],
    ]);
    expect(DELEGATED_COUNTERS).toMatchObject({ corso: 3, modulo: 40 });
  });

  it('refuses a token the trash and the export', async () => {
    const { id, moduleIds } = await course(alice, token, 1);
    expect((await request(app).delete(`${CORSI}/${id}`).set(token)).status).toBe(403);
    expect((await request(app).delete(`${CORSI}/${id}/moduli/${moduleIds[0]}`).set(token)).status).toBe(403);
    expect((await request(app).get(`${CORSI}/${id}/export`).set(token)).status).toBe(403);
  });

  it('counts three courses a day per connection', async () => {
    for (let i = 0; i < 3; i++) await course(alice, token);
    const dossier = await studyDossier(alice);
    const fourth = await request(app).post(CORSI).set(token).send(courseBody(dossier.id));
    expect(fourth.status).toBe(429);
  });

  it('words both scopes in the one consent', async () => {
    const connection = await request(app).get('/api/oauth/connection').set(authHeader(alice));
    const labels = Object.fromEntries((connection.body.scopes as { scope: string; label: string }[]).map((s) => [s.scope, s.label]));
    expect(labels['lingo:courses:read']).toBe('Leggere i tuoi percorsi di studio, i tuoi esiti e le tue segnalazioni');
    expect(labels['lingo:courses:write']).toBe('Creare percorsi di studio e aggiungervi moduli ed esami (non può modificare né cancellare nulla)');
  });
});
