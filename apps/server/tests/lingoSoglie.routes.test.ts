import type { LingoCardStato, LingoGiudizio } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from './helpers';
import { stateAfterVotes } from '../src/lingo/validationRule';

// The administrator's validation thresholds (Studia spec 2026-10-18): the values,
// the preview, the change of the proposed cards, the log, and the vote reading
// the stored values.

const URN = 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453';

async function makeAdmin(name: string) {
  const user = await createTestUser(name);
  await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
  return user;
}

const makeValidator = async (name: string) => {
  const user = await createTestUser(name);
  await prisma.user.update({ where: { id: user.id }, data: { lingoValidatore: true } });
  return user;
};

let seq = 0;

/** A card in `stato`, with one vote per judgement, cast by a fresh validator. */
async function makeCard(authorId: string | null, stato: LingoCardStato, giudizi: LingoGiudizio[] = []) {
  const card = await prisma.lingoCard.create({
    data: {
      autoreId: authorId, materia: 'DIRITTO_CIVILE', istituto: 'Risoluzione', domanda: 'Quando?', risposta: 'Se grave.', stato,
      ancore: { create: [{ normaKey: 'codice_civile', articleId: 'art_1453', urn: URN, aknFingerprint: 'a'.repeat(64), isPrimary: true }] },
    },
  });
  for (const giudizio of giudizi) {
    seq += 1;
    const voter = await createTestUser(`soglia-voter-${seq}`);
    await prisma.lingoValidazioneCard.create({
      data: { cardId: card.id, utenteId: voter.id, giudizio, motivazione: giudizio === 'APPROVATA' ? null : 'Motivo.' },
    });
  }
  return card;
}

const leggi = (who: TestUser) => request(app).get('/api/admin/studia/soglie').set(authHeader(who));
const anteprima = (who: TestUser, body: unknown) => request(app).post('/api/admin/studia/soglie/anteprima').set(authHeader(who)).send(body as object);
const salva = (who: TestUser, body: unknown) => request(app).put('/api/admin/studia/soglie').set(authHeader(who)).send(body as object);
const vote = (who: TestUser, id: string, giudizio: LingoGiudizio) =>
  request(app).post(`/api/lingo/validazione/${id}`).set(authHeader(who)).send({ giudizio, motivazione: giudizio === 'APPROVATA' ? undefined : 'Motivo.' });
const stato = async (id: string) => (await prisma.lingoCard.findUniqueOrThrow({ where: { id } })).stato;
const esiste = async (id: string) => (await prisma.lingoCard.findUnique({ where: { id } })) !== null;

describe('reading and previewing the thresholds', () => {
  let admin: TestUser;
  beforeEach(async () => {
    admin = await makeAdmin('soglia-admin');
  });

  it('answers the values in force, their ranges and the defaults to an administrator', async () => {
    const response = await leggi(admin);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      soglie: { approvazioni: 2, errate: 1 },
      limiti: { approvazioni: { min: 1, max: 5 }, errate: { min: 1, max: 3 } },
      predefinite: { approvazioni: 2, errate: 1 },
    });
  });

  it('refuses an anonymous request (401) and a user who is not an administrator (403)', async () => {
    const plain = await createTestUser('soglia-plain');
    expect((await request(app).get('/api/admin/studia/soglie')).status).toBe(401);
    expect((await leggi(plain)).status).toBe(403);
    expect((await anteprima(plain, { approvazioni: 1, errate: 1 })).status).toBe(403);
    expect((await salva(plain, { approvazioni: 1, errate: 1 })).status).toBe(403);
  });

  it('previews how many proposed cards would be validated and archived, and changes nothing', async () => {
    const autore = await createTestUser('soglia-autore');
    const uno = await makeCard(autore.id, 'PROPOSTA_COMMUNITY', ['APPROVATA']);
    const altra = await makeCard(autore.id, 'PROPOSTA_COMMUNITY', ['MIGLIORABILE']);
    const errata = await makeCard(autore.id, 'PROPOSTA_COMMUNITY', []);
    const response = await anteprima(admin, { approvazioni: 1, errate: 1 });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ validate: 1, archiviate: 0 });
    expect(await stato(uno.id)).toBe('PROPOSTA_COMMUNITY');
    expect(await stato(altra.id)).toBe('PROPOSTA_COMMUNITY');
    expect(await stato(errata.id)).toBe('PROPOSTA_COMMUNITY');
    expect((await leggi(admin)).body.soglie).toEqual({ approvazioni: 2, errate: 1 });
  });

  it('counts an archived «errata» in the preview, and never a card that is already validated or archived', async () => {
    const autore = await createTestUser('soglia-autore');
    await makeCard(autore.id, 'PROPOSTA_COMMUNITY', ['ERRATA']);
    await makeCard(autore.id, 'VALIDATA', ['APPROVATA']);
    await makeCard(autore.id, 'ARCHIVIATA', ['ERRATA']);
    const response = await anteprima(admin, { approvazioni: 1, errate: 1 });
    expect(response.body).toEqual({ validate: 0, archiviate: 1 });
  });

  it.each([
    ['approvazioni 0', { approvazioni: 0, errate: 1 }],
    ['approvazioni 6', { approvazioni: 6, errate: 1 }],
    ['errate 0', { approvazioni: 2, errate: 0 }],
    ['errate 4', { approvazioni: 2, errate: 4 }],
    ['a fraction', { approvazioni: 2.5, errate: 1 }],
    ['a string', { approvazioni: '2', errate: 1 }],
    ['a missing value', { approvazioni: 2 }],
    ['an unknown key', { approvazioni: 2, errate: 1, soglia: 3 }],
  ])('refuses %s with 400 in the preview and in the save', async (_name, body) => {
    expect((await anteprima(admin, body)).status).toBe(400);
    const response = await salva(admin, body);
    expect(response.status).toBe(400);
    expect((await leggi(admin)).body.soglie).toEqual({ approvazioni: 2, errate: 1 });
    expect(await prisma.lingoImpostazioneLog.count()).toBe(0);
  });
});

describe('saving the thresholds', () => {
  let admin: TestUser;
  let autore: TestUser;
  beforeEach(async () => {
    admin = await makeAdmin('soglia-admin');
    autore = await createTestUser('soglia-autore');
  });

  it('stores the values, logs each change with who, when, the old and the new value, and answers the counts applied', async () => {
    const card = await makeCard(autore.id, 'PROPOSTA_COMMUNITY', ['APPROVATA']);
    const response = await salva(admin, { approvazioni: 1, errate: 1 });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ soglie: { approvazioni: 1, errate: 1 }, validate: 1, archiviate: 0 });
    expect(await stato(card.id)).toBe('VALIDATA');
    expect((await leggi(admin)).body.soglie).toEqual({ approvazioni: 1, errate: 1 });
    const log = await prisma.lingoImpostazioneLog.findMany();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ chiave: 'SOGLIA_APPROVAZIONI', valorePrecedente: 2, valoreNuovo: 1, utenteId: admin.id });
    expect(log[0].createdAt).toBeInstanceOf(Date);
  });

  it('logs one row per value that changed, and none for a save that changes nothing', async () => {
    await salva(admin, { approvazioni: 3, errate: 2 });
    expect(await prisma.lingoImpostazioneLog.count()).toBe(2);
    await salva(admin, { approvazioni: 3, errate: 2 });
    expect(await prisma.lingoImpostazioneLog.count()).toBe(2);
    await salva(admin, { approvazioni: 3, errate: 1 });
    const log = await prisma.lingoImpostazioneLog.findMany({ orderBy: { createdAt: 'asc' } });
    expect(log.map((l) => [l.chiave, l.valorePrecedente, l.valoreNuovo])).toEqual([
      ['SOGLIA_APPROVAZIONI', 2, 3],
      ['SOGLIA_ERRATE', 1, 2],
      ['SOGLIA_ERRATE', 2, 1],
    ]);
  });

  it('moves a proposed card to the state the new values give, in both directions', async () => {
    // Under the thresholds 3 and 3 neither card reaches a state; then the values go back.
    await salva(admin, { approvazioni: 3, errate: 3 });
    const approvata = await makeCard(autore.id, 'PROPOSTA_COMMUNITY', ['APPROVATA']);
    const archiviata = await makeCard(autore.id, 'PROPOSTA_COMMUNITY', ['ERRATA']);
    expect(await stato(approvata.id)).toBe('PROPOSTA_COMMUNITY');
    expect(await stato(archiviata.id)).toBe('PROPOSTA_COMMUNITY');
    await salva(admin, { approvazioni: 1, errate: 1 });
    expect(await stato(approvata.id)).toBe('VALIDATA');
    expect(await stato(archiviata.id)).toBe('ARCHIVIATA');
  });

  it('never changes a card that is already validated or archived, whatever the new values', async () => {
    const validata = await makeCard(autore.id, 'VALIDATA', ['APPROVATA']);
    const archiviata = await makeCard(autore.id, 'ARCHIVIATA', ['APPROVATA', 'APPROVATA']);
    const response = await salva(admin, { approvazioni: 5, errate: 1 });
    expect(response.body).toEqual({ soglie: { approvazioni: 5, errate: 1 }, validate: 0, archiviate: 0 });
    expect(await stato(validata.id)).toBe('VALIDATA');
    expect(await stato(archiviata.id)).toBe('ARCHIVIATA');
    await salva(admin, { approvazioni: 1, errate: 3 });
    expect(await stato(validata.id)).toBe('VALIDATA');
    expect(await stato(archiviata.id)).toBe('ARCHIVIATA');
  });

  it('deletes an author-less proposed card that the new «errata» threshold archives, with its votes', async () => {
    await salva(admin, { approvazioni: 2, errate: 3 });
    const orfana = await makeCard(null, 'PROPOSTA_COMMUNITY', ['ERRATA']);
    expect(await stato(orfana.id)).toBe('PROPOSTA_COMMUNITY');
    const response = await salva(admin, { approvazioni: 2, errate: 1 });
    expect(response.body).toEqual({ soglie: { approvazioni: 2, errate: 1 }, validate: 0, archiviate: 1 });
    expect(await esiste(orfana.id)).toBe(false);
    expect(await prisma.lingoValidazioneCard.count({ where: { cardId: orfana.id } })).toBe(0);
  });

  it('keeps an author-less proposed card whose state does not change', async () => {
    const orfana = await makeCard(null, 'PROPOSTA_COMMUNITY', ['APPROVATA']);
    await salva(admin, { approvazioni: 1, errate: 1 });
    expect(await stato(orfana.id)).toBe('VALIDATA');
    expect(await esiste(orfana.id)).toBe(true);
  });

  it('makes the vote route count under the stored values', async () => {
    await salva(admin, { approvazioni: 3, errate: 1 });
    const card = await makeCard(autore.id, 'PROPOSTA_COMMUNITY', ['APPROVATA']);
    const [a, b] = [await makeValidator('soglia-val-a'), await makeValidator('soglia-val-b')];
    expect((await vote(a, card.id, 'APPROVATA')).body).toMatchObject({ stato: 'PROPOSTA_COMMUNITY' });
    expect((await vote(b, card.id, 'APPROVATA')).body).toMatchObject({ stato: 'VALIDATA' });
    expect(await stato(card.id)).toBe('VALIDATA');
  });
});

describe('a vote and a change sent together', () => {
  it('leave every proposed card in the state its stored votes and values give', async () => {
    const admin = await makeAdmin('soglia-admin');
    const autore = await createTestUser('soglia-autore');
    const validatori = [await makeValidator('soglia-cv-a'), await makeValidator('soglia-cv-b'), await makeValidator('soglia-cv-c')];
    for (const [approvazioni, errate] of [[1, 1], [3, 2], [2, 1]] as const) {
      const cards = [
        await makeCard(autore.id, 'PROPOSTA_COMMUNITY', ['APPROVATA']),
        await makeCard(autore.id, 'PROPOSTA_COMMUNITY', ['APPROVATA', 'MIGLIORABILE']),
        await makeCard(autore.id, 'PROPOSTA_COMMUNITY', ['MIGLIORABILE']),
      ];
      await Promise.all([
        ...cards.map((card, i) => vote(validatori[i], card.id, 'APPROVATA')),
        salva(admin, { approvazioni, errate }),
      ]);
      const soglie = { approvazioni, errate };
      const proposte = await prisma.lingoCard.findMany({
        where: { stato: 'PROPOSTA_COMMUNITY' },
        select: { id: true, stato: true, validazioni: { select: { giudizio: true } } },
      });
      for (const card of proposte) {
        expect(card.stato).toBe(stateAfterVotes(card.validazioni.map((v) => v.giudizio), soglie));
      }
      // The change of the values went through: the stored row is what was sent.
      expect((await leggi(admin)).body.soglie).toEqual(soglie);
    }
  });
});
