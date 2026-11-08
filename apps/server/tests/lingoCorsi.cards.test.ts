import nock from 'nock';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, createTestUser, type TestUser } from './helpers';
import { acceptDeclaration, app, course, delegatedAs, prisma, request, switchCourses, type Headers } from './corsiHelpers';

// Percorsi, S1 (spec 2026-10-23 §10.5): a course's cards created through POST /lingo/cards, by the session and by a
// token holding both scopes, with the sources stubbed as in tests/lingoCardsRoutes.test.ts.

const API = 'http://legal-api.test';
const originalLegalApiUrl = process.env.LEGAL_API_URL;
const CC = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262';
const HASH = 'd'.repeat(64);

function stubPythonApi() {
  nock(API).post('/parse_query').times(50).reply(200, { parsed: { act_type: 'codice civile', article: '2563' }, recognized: true });
  nock(API).post('/fetch_norma_data').times(50).reply(200, {
    norma_data: [{
      tipo_atto: 'codice civile', tipo_atto_reale: 'regio decreto', data: '1942-03-16', numero_atto: '262', numero_articolo: '2563',
      allegato: '2', url: CC, urn: `${CC}:2~art2563`, versione: null, data_versione: null,
    }],
  });
  nock(API).post('/fetch_act_fingerprints').times(50).reply(200, {
    available: true,
    fingerprints: { '2563': { fingerprint: HASH, date: null } },
    parts: [
      { name: 'Disposizioni sulla legge in generale', fingerprints: { '1': { fingerprint: 'f'.repeat(64), date: null } } },
      { name: 'CODICE CIVILE', fingerprints: { '2563': { fingerprint: HASH, date: null } } },
    ],
    count: 1,
  });
  nock(API).post('/fetch_tree').times(50).reply(200, { articles: [{ allegato: '1', numero: '1' }, { allegato: '2', numero: '2563' }] });
}

const CARD = { materia: 'DIRITTO_CIVILE', istituto: 'Ditta', domanda: 'Che cos’è la ditta?', risposta: 'Il nome commerciale.', ancore: [{ riferimento: 'art. 2563 c.c.' }] };

let alice: TestUser;
let token: Headers;

beforeAll(() => nock.activate());
afterAll(() => nock.restore());
beforeEach(async () => {
  process.env.LEGAL_API_URL = API;
  stubPythonApi();
  alice = await createTestUser('alice');
  await switchCourses(true);
  await acceptDeclaration(alice);
  token = await delegatedAs(alice);
});
afterEach(() => {
  nock.cleanAll();
  if (originalLegalApiUrl === undefined) delete process.env.LEGAL_API_URL;
  else process.env.LEGAL_API_URL = originalLegalApiUrl;
});

describe('a course card through POST /lingo/cards', () => {
  it('is tied to its module, marked daPercorso, with its competences: from the session', async () => {
    const { moduleIds } = await course(alice, token, 1);
    const created = await request(app).post('/api/lingo/cards').set(authHeader(alice))
      .send({ moduloId: moduleIds[0], cards: [{ ...CARD, competenze: ['C1', 'C2', 'C1'] }] });
    expect(created.status).toBe(200);
    expect(created.body.results, JSON.stringify(created.body)).toEqual([{ outcome: 'created', id: expect.any(String) }]);
    const card = await prisma.lingoCard.findUniqueOrThrow({
      where: { id: created.body.results[0].id },
      include: { competenze: { include: { competenza: true } } },
    });
    expect(card).toMatchObject({ moduloId: moduleIds[0], daPercorso: true, stato: 'BOZZA_PERSONALE' });
    expect(card.competenze.map((c) => c.competenza.codice).sort()).toEqual(['C1', 'C2']);
  });

  it('from a token with both scopes, with its provenance', async () => {
    const { moduleIds } = await course(alice, token, 1);
    const both = await delegatedAs(alice, 'lingo:cards:write lingo:courses:write');
    const created = await request(app).post('/api/lingo/cards').set(both).send({ moduloId: moduleIds[0], cards: [{ ...CARD, competenze: ['C3'] }] });
    expect(created.status).toBe(200);
    const card = await prisma.lingoCard.findUniqueOrThrow({ where: { id: created.body.results[0].id } });
    expect(card).toMatchObject({ moduloId: moduleIds[0], daPercorso: true });
    expect(card.createdByClientId).not.toBeNull();
  });

  it('without a module is a plain card, as before', async () => {
    const created = await request(app).post('/api/lingo/cards').set(authHeader(alice)).send({ cards: [CARD] });
    expect(created.status).toBe(200);
    expect(await prisma.lingoCard.findUniqueOrThrow({ where: { id: created.body.results[0].id } })).toMatchObject({ moduloId: null, daPercorso: false });
  });
});
