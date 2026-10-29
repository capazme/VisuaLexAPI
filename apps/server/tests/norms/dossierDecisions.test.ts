import nock from 'nock';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from '../helpers';
import { delegatedToken } from '../oauth/oauthHelpers';
import { delegated } from '../delegatedHelper';
import { decisionLookup } from '../../src/norms/resolveDecisions';

// The Python API, stubbed: /parse_decision as tests/test_decision_citation.py pins it, and
// /fetch_decision in the shapes the resolver answers (design 2026-10-01 §3). Numbers are fictional
// except the golden file's decisions (cass-civ-su-31310-2024, corte-cost-71-2020).
const API = 'http://legal-api.test';
const originalLegalApiUrl = process.env.LEGAL_API_URL;

const READINGS: Record<string, unknown> = {
  'Cass. civ., sez. un., n. 31310/2024': { riferimento: { corte: 'cassazione', archivio: 'civile', sezione: 'U', numero: 31310, anno: 2024 } },
  'Cass. SU 31310/2024': { riferimento: { corte: 'cassazione', sezione: 'U', numero: 31310, anno: 2024 } },
  'Corte cost. n. 71/2020': { riferimento: { corte: 'corte_costituzionale', numero: 71, anno: 2020 } },
  'Cass. 10787/2024': { riferimento: { corte: 'cassazione', numero: 10787, anno: 2024 } },
  'Cass. civ. 99999/2024': { riferimento: { corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 } },
  'Cass. pen. 1399/1999': { riferimento: { corte: 'cassazione', archivio: 'penale', numero: 1399, anno: 1999 } },
  'Cass. civ. 5/1990': { riferimento: { corte: 'cassazione', archivio: 'civile', numero: 5, anno: 1990 } },
  'Cass. civ. 77/2024': { riferimento: { corte: 'cassazione', archivio: 'civile', numero: 77, anno: 2024 } },
  'Cass. civ. 88/2024': { riferimento: { corte: 'cassazione', archivio: 'civile', numero: 88, anno: 2024 } },
  'Corte EDU, n. 1/2020': { corte_non_supportata: "Corte europea dei diritti dell'uomo" },
  'Cons. Stato, sez. VI, n. 2270/2019': { riferimento: { corte: 'consiglio_di_stato', sezione: 'VI', numero: 2270, anno: 2019 } },
  'TAR Lazio, n. 1234/2020': { riferimento: { corte: 'tar', regione: 'Lazio', numero: 1234, anno: 2020, tipo: 'ordinanza' } },
  'Cons. Stato, ord. n. 3000/2019': { riferimento: { corte: 'consiglio_di_stato', numero: 3000, anno: 2019, tipo: 'ordinanza' } },
  'TAR Lombardia, n. 4000/2020': { riferimento: { corte: 'tar', regione: 'Lombardia', numero: 4000, anno: 2020 } },
  'CGUE, C-594/12': { riferimento: { corte: 'corte_giustizia_ue', numero: 594, anno: 2012 } },
  'Cass. civ. 66/2024': { riferimento: { corte: 'cassazione', archivio: 'civile', numero: 66, anno: 2024 } },
  'Cass. civ. 55/2024': { riferimento: { corte: 'cassazione', archivio: 'civile', numero: 55, anno: 2024 } },
};

const SU_31310 = {
  identita: { corte: 'cassazione', archivio: 'civile', numero: 31310, anno: 2024 },
  attributi: { sezione: 'U', tipo: 'sentenza', data_deposito: '2024-12-06', relatore: 'X', materia: 'Y', ecli: 'not kept' },
};
const COST_71 = {
  identita: { corte: 'corte_costituzionale', numero: 71, anno: 2020 },
  attributi: { tipo: 'sentenza', data_decisione: '2020-02-12', data_deposito: '2020-04-24', ecli: 'ECLI:IT:COST:2020:71' },
};

function found(d: { identita: unknown; attributi: unknown }): [number, unknown] {
  return [200, { esito: 'trovata', ...d, testo: { motivazione: 'non conservato' }, fonte: { nome: 'f' }, avvisi: [] }];
}

let calls: Record<string, number> = {};
let fetchBodies: Record<string, unknown>[] = [];
let parseDown = false;

function stubPythonApi(fetchDelayMs = 0) {
  calls = {};
  fetchBodies = [];
  const count = (path: string) => (calls[path] = (calls[path] ?? 0) + 1);
  nock(API).post('/parse_decision').times(100).reply((_uri: string, body: { citazioni: string[] }) => {
    count('/parse_decision');
    if (parseDown) return [503, { error: 'down' }];
    return [200, { risultati: body.citazioni.map((c) => READINGS[c] ?? { non_riconosciuta: true }) }];
  });
  nock(API).post('/fetch_decision').times(100).delay(fetchDelayMs).reply((_uri: string, body: Record<string, unknown>) => {
    count('/fetch_decision');
    fetchBodies.push(body);
    const { corte, numero, archivio } = body;
    if (corte === 'corte_costituzionale' && numero === 71) return found(COST_71);
    // a joined case: the judgment is filed under the first case
    if (corte === 'corte_giustizia_ue' && numero === 594) {
      return found({
        identita: { corte: 'corte_giustizia_ue', numero: 293, anno: 2012 },
        attributi: { tipo: 'sentenza', sezione: 'grande', data_decisione: '2014-04-08', ecli: 'ECLI:EU:C:2014:238',
          parti: 'non conservate', cause_riunite: ['C-293/12', 'C-594/12'], lingua_processuale: "l'inglese" },
      });
    }
    if (numero === 31310) return found(SU_31310);
    // The administrative courts (golden file, cds-sent-2270-2019 and tar-roma-ocau-1234-2020).
    if (corte === 'consiglio_di_stato' && numero === 2270) {
      return found({ identita: { corte, provvedimento: 'sent', numero, anno: 2019 },
        attributi: { tipo: 'sentenza', sezione: 'VI', data_deposito: '2019-04-08', ecli: 'ECLI:IT:CDS:2019:2270SENT' } });
    }
    if (corte === 'tar' && numero === 1234) {
      const [status, answer] = found({ identita: { corte, sede: 'roma', provvedimento: 'ocau', numero, anno: 2020 },
        attributi: { tipo: 'ordinanza', sezione: 'I' } });
      return [status, { ...(answer as object), avvisi: [{ tipo: 'sede_dedotta', sede: '<b>altrove</b>' }] }];
    }
    if (corte === 'consiglio_di_stato' && numero === 3000) {
      return [200, { esito: 'ambigua', candidati: ['ocau', 'ocol'].map((provvedimento) => (
        { identita: { corte, provvedimento, numero, anno: 2019 }, attributi: { tipo: 'ordinanza', sezione: 'IV' } })) }];
    }
    if (corte === 'tar' && numero === 4000) {
      return [200, { esito: 'ambigua', candidati: ['milano', 'brescia'].map((sede) => (
        { identita: { corte, sede, provvedimento: 'sent', numero, anno: 2020 }, attributi: { tipo: 'sentenza' } })) }];
    }
    if (numero === 10787 && !archivio) {
      return [200, { esito: 'ambigua', candidati: [
        { identita: { corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 }, attributi: { sezione: '3', tipo: 'ordinanza', data_deposito: '2024-04-22' } },
        { identita: { corte: 'cassazione', archivio: 'penale', numero: 10787, anno: 2024 }, attributi: { sezione: '7', tipo: 'ordinanza', data_deposito: '2024-03-14' } },
      ] }];
    }
    if (numero === 99999) return [404, { esito: 'non_trovata', motivo: 'inesistente' }];
    if (numero === 1399) {
      return [404, { esito: 'non_trovata', motivo: 'inesistente', suggerimento: { corte: 'cassazione', archivio: 'penale', numero: 1399, anno: 2000 } }];
    }
    if (numero === 5) return [404, { esito: 'non_trovata', motivo: 'fuori_archivio', archivio_dal: '1999-01-04' }];
    if (numero === 77) return [503, { esito: 'fonte_non_raggiungibile', fonte: 'italgiure' }];
    if (numero === 88) return [500, { esito: 'errore_interno' }];
    if (numero === 66) return [404, { esito: 'non_trovata', motivo: 'motivo_nuovo' }];
    // An identity the item schema refuses (a year before 1900): never stored, and never a 400 for the call.
    if (numero === 55) return found({ identita: { corte: 'cassazione', archivio: 'civile', numero: 55, anno: 1800 }, attributi: {} });
    return [404, { esito: 'non_trovata', motivo: 'inesistente' }];
  });
}

async function addDecisions(user: TestUser, dossierId: string, references: string[]) {
  return request(app).post(`/api/dossiers/${dossierId}/decisions`).set(authHeader(user)).send({ references });
}
const outcomes = (response: { body: { results: { outcome: string }[] } }) => response.body.results.map((r) => r.outcome);

beforeAll(() => nock.activate());
afterAll(() => nock.restore());

describe('POST /api/dossiers/:id/decisions', () => {
  let alice: TestUser;
  let dossierId: string;
  beforeEach(async () => {
    process.env.LEGAL_API_URL = API;
    parseDown = false;
    stubPythonApi();
    alice = await createTestUser('decisions-alice');
    dossierId = (await request(app).post('/api/dossiers').set(authHeader(alice)).send({ name: 'Prova' })).body.id;
  });
  afterEach(() => {
    nock.cleanAll();
    decisionLookup.budgetMs = 100_000;
    if (originalLegalApiUrl === undefined) delete process.env.LEGAL_API_URL;
    else process.env.LEGAL_API_URL = originalLegalApiUrl;
  });

  it('adds a Cassazione and a Corte costituzionale decision as the web app stores them, cited by the server', async () => {
    const response = await addDecisions(alice, dossierId, ['Cass. civ., sez. un., n. 31310/2024', 'Corte cost. n. 71/2020']);
    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([
      expect.objectContaining({ reference: 'Cass. civ., sez. un., n. 31310/2024', outcome: 'added',
        citation: 'Cass. civ., sez. un., sent. 6 dicembre 2024, n. 31310' }),
      expect.objectContaining({ reference: 'Corte cost. n. 71/2020', outcome: 'added', citation: 'Corte cost., sent. 24 aprile 2020, n. 71' }),
    ]);
    const items = await prisma.dossierItem.findMany({ where: { dossierId }, orderBy: { position: 'asc' } });
    expect(items.map((i) => i.itemType)).toEqual(['sentenza', 'sentenza']);
    // Only what the item schema admits: no text, no relatore, no ECLI.
    expect(items[0].content).toEqual({
      corte: 'cassazione', archivio: 'civile', numero: 31310, anno: 2024, sezione: 'U', tipo: 'sentenza',
      data_deposito: '2024-12-06', etichetta: 'Cass. civ., sez. un., sent. 6 dicembre 2024, n. 31310',
    });
    expect(items[0].title).toBe('Cass. civ., sez. un., sent. 6 dicembre 2024, n. 31310');
    expect(items[1].content).toEqual({
      corte: 'corte_costituzionale', numero: 71, anno: 2020, tipo: 'sentenza', data_deposito: '2020-04-24',
      etichetta: 'Corte cost., sent. 24 aprile 2020, n. 71',
    });
    expect(response.body.results.map((r: { itemId: string }) => r.itemId)).toEqual(items.map((i) => i.id));
    expect(calls['/parse_decision']).toBe(1);
    expect(fetchBodies[0]).toEqual({ corte: 'cassazione', archivio: 'civile', sezione: 'U', numero: 31310, anno: 2024 });
    const read = await request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(alice));
    expect(read.body.items.map((i: { citation: string }) => i.citation)).toEqual([
      'Cass. civ., sez. un., sent. 6 dicembre 2024, n. 31310', 'Corte cost., sent. 24 aprile 2020, n. 71']);
  });

  it('adds a judgment of the Court of Justice cited by a joined case, under the first case', async () => {
    const response = await addDecisions(alice, dossierId, ['CGUE, C-594/12']);
    expect(response.body.results).toEqual([expect.objectContaining({
      outcome: 'added', citation: 'Corte giust. UE, grande sez., sent. 8 aprile 2014, cause riunite C-293/12 e C-594/12' })]);
    const [item] = await prisma.dossierItem.findMany({ where: { dossierId } });
    expect(item.content).toEqual({
      corte: 'corte_giustizia_ue', numero: 293, anno: 2012, sezione: 'grande', tipo: 'sentenza',
      data_decisione: '2014-04-08', cause_riunite: ['C-293/12', 'C-594/12'],
      etichetta: 'Corte giust. UE, grande sez., sent. 8 aprile 2014, cause riunite C-293/12 e C-594/12',
    });
  });

  it('adds a decision of the Consiglio di Stato and of a TAR, and names a seat it deduced (D3)', async () => {
    const response = await addDecisions(alice, dossierId, ['Cons. Stato, sez. VI, n. 2270/2019', 'TAR Lazio, n. 1234/2020']);
    expect(response.body.results).toEqual([
      expect.objectContaining({ outcome: 'added', citation: 'Cons. Stato, sez. VI, sent. 8 aprile 2019, n. 2270' }),
      // the seat named from the identity, not from the notice's words
      expect.objectContaining({ outcome: 'added', citation: 'TAR Lazio, Roma, sez. I, ord., n. 1234/2020',
        detail: 'Sede dedotta dalla regione: Roma.' }),
    ]);
    expect(response.body.results[0].detail).toBeUndefined();
    const items = await prisma.dossierItem.findMany({ where: { dossierId }, orderBy: { position: 'asc' } });
    expect(items.map((i) => i.content)).toEqual([
      { corte: 'consiglio_di_stato', provvedimento: 'sent', numero: 2270, anno: 2019, sezione: 'VI', tipo: 'sentenza',
        data_deposito: '2019-04-08', etichetta: 'Cons. Stato, sez. VI, sent. 8 aprile 2019, n. 2270' },
      { corte: 'tar', sede: 'roma', provvedimento: 'ocau', numero: 1234, anno: 2020, sezione: 'I', tipo: 'ordinanza',
        etichetta: 'TAR Lazio, Roma, sez. I, ord., n. 1234/2020' },
    ]);
    expect(fetchBodies[1]).toEqual({ corte: 'tar', regione: 'Lazio', numero: 1234, anno: 2020, tipo: 'ordinanza' });
    const again = await addDecisions(alice, dossierId, ['TAR Lazio, n. 1234/2020']);
    expect(outcomes(again)).toEqual(['already_present']);
  });

  it('asks for the kind or the seat when an administrative reference names several decisions', async () => {
    const response = await addDecisions(alice, dossierId, ['Cons. Stato, ord. n. 3000/2019', 'TAR Lombardia, n. 4000/2020']);
    expect(outcomes(response)).toEqual(['ambiguous', 'ambiguous']);
    const [kinds, seats] = response.body.results;
    // an ordinanza cautelare and a collegiale: «ord.» cannot tell them apart, so the words are not asked again
    expect(kinds.detail).toContain('Sono provvedimenti dello stesso tipo');
    expect(seats.detail).toContain('TAR Lombardia, Milano, sent., n. 4000/2020');
    expect(seats.detail).toContain('TAR Lombardia, Brescia');
    expect(seats.detail).toContain('Indica la sede del TAR.');
    // The same citations as a list, for a client that names the candidates (D8 S1).
    expect(seats.candidates).toEqual(expect.arrayContaining(['TAR Lombardia, Milano, sent., n. 4000/2020']));
    for (const result of [kinds, seats]) {
      expect(result.candidates.length).toBeGreaterThan(1);
      expect(result.candidates.every((c: string) => result.detail.includes(c))).toBe(true);
    }
    expect(await prisma.dossierItem.count()).toBe(0);
  });

  it('adds a decision once, by its key: in the dossier already, or twice in the call', async () => {
    await request(app).post(`/api/dossiers/${dossierId}/items`).set(authHeader(alice)).send({
      itemType: 'sentenza', title: 'x', content: { corte: 'corte_costituzionale', numero: 71, anno: 2020, etichetta: 'x' },
    });
    const response = await addDecisions(alice, dossierId, ['Corte cost. n. 71/2020', 'Cass. civ., sez. un., n. 31310/2024', 'Cass. SU 31310/2024']);
    expect(outcomes(response)).toEqual(['already_present', 'added', 'already_present']);
    expect(response.body.results[0].citation).toBe('Corte cost., sent. 24 aprile 2020, n. 71');
    expect(await prisma.dossierItem.count({ where: { dossierId } })).toBe(2);
  });

  it('reports each reference it does not store, and the others go on', async () => {
    const response = await addDecisions(alice, dossierId, [
      'Corte EDU, n. 1/2020', 'una sentenza qualunque', 'Cass. 10787/2024', 'Cass. civ. 99999/2024',
      'Cass. pen. 1399/1999', 'Cass. civ. 5/1990', 'Cass. civ. 77/2024', 'Cass. civ. 88/2024', 'Corte cost. n. 71/2020',
    ]);
    expect(response.status).toBe(200);
    expect(outcomes(response)).toEqual([
      'court_not_supported', 'not_recognised', 'ambiguous', 'does_not_exist', 'does_not_exist', 'unavailable', 'unavailable', 'unavailable', 'added',
    ]);
    const [court, words, ambiguous, missing, penal, outside] = response.body.results;
    expect(court.court).toBe("Corte europea dei diritti dell'uomo");
    expect(court.detail).toContain('Corte europea');
    expect(words.detail).toMatch(/corte, il numero e l'anno/);
    expect(ambiguous.detail).toContain('Cass. civ., sez. III, ord. 22 aprile 2024, n. 10787');
    expect(ambiguous.detail).toContain('Cass. pen., sez. VII, ord. dep. 14 marzo 2024, n. 10787');
    expect(ambiguous.candidates).toEqual(expect.arrayContaining([
      'Cass. civ., sez. III, ord. 22 aprile 2024, n. 10787', 'Cass. pen., sez. VII, ord. dep. 14 marzo 2024, n. 10787',
    ]));
    expect(court.candidates).toBeUndefined();
    expect(missing.detail).toBe('La fonte non conosce questa decisione.');
    expect(penal.detail).toContain('Cass. pen., n. 1399/2000');
    // Before the archive's start the source cannot say: never "does not exist".
    expect(outside.detail).toMatch(/anteriore all'archivio pubblico della fonte \(dal 1999\)/);
    expect(await prisma.dossierItem.count({ where: { dossierId } })).toBe(1);
    // The court without a reader and the words not read never reach /fetch_decision.
    expect(calls['/fetch_decision']).toBe(7);
  });

  it('keeps "does not exist" for the reason inesistente, and refuses an identity the item schema refuses', async () => {
    const response = await addDecisions(alice, dossierId, ['Cass. civ. 66/2024', 'Cass. civ. 55/2024', 'Corte cost. n. 71/2020']);
    expect(response.status).toBe(200);
    expect(outcomes(response)).toEqual(['unavailable', 'unavailable', 'added']);
    expect(await prisma.dossierItem.count({ where: { dossierId } })).toBe(1);
  });

  it('stores nothing and says so when the words cannot be read', async () => {
    parseDown = true;
    const response = await addDecisions(alice, dossierId, ['Corte cost. n. 71/2020']);
    expect(outcomes(response)).toEqual(['unavailable']);
    expect(calls['/fetch_decision']).toBeUndefined();
    expect(await prisma.dossierItem.count()).toBe(0);
  });

  it('gives up a lookup past the call budget, as unavailable, and adds nothing for it', async () => {
    decisionLookup.budgetMs = 300;
    nock.cleanAll();
    stubPythonApi(2_000);
    const response = await addDecisions(alice, dossierId, ['Corte cost. n. 71/2020']);
    expect(outcomes(response)).toEqual(['unavailable']);
    expect(response.body.results[0].detail).toMatch(/non ha risposto in tempo/);
    expect(await prisma.dossierItem.count()).toBe(0);
  });

  it('takes 1 to 10 references, each at most 300 characters', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `Cass. civ. ${i + 1}/2024`);
    expect((await addDecisions(alice, dossierId, eleven)).status).toBe(400);
    expect((await addDecisions(alice, dossierId, [])).status).toBe(400);
    expect((await addDecisions(alice, dossierId, ['x'.repeat(301)])).status).toBe(400);
    expect(calls['/parse_decision']).toBeUndefined();
  });

  it("answers 404 for another user's dossier, and 401 without a session", async () => {
    const bob = await createTestUser('decisions-bob');
    expect((await addDecisions(bob, dossierId, ['Corte cost. n. 71/2020'])).status).toBe(404);
    const anonymous = await request(app).post(`/api/dossiers/${dossierId}/decisions`).send({ references: ['Corte cost. n. 71/2020'] });
    expect(anonymous.status).toBe(401);
    expect(await prisma.dossierItem.count()).toBe(0);
  });

  it('marks the decisions an exchanged token adds with the connection', async () => {
    const { apiToken } = await delegatedToken(alice);
    const response = await request(app)
      .post(`/api/dossiers/${dossierId}/decisions`)
      .set({ Authorization: `Bearer ${apiToken}` })
      .send({ references: ['Corte cost. n. 71/2020'] });
    expect(outcomes(response)).toEqual(['added']);
    const read = await request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(alice));
    expect(read.body.items.map((i: { created_by: unknown }) => i.created_by)).toEqual([{ clientName: 'Claude Code' }]);
  });

  it('charges an exchanged token two points per reference and gives back the unverified ones', async () => {
    const { apiToken } = await delegatedToken(alice);
    const bearer = { Authorization: `Bearer ${apiToken}` };
    const before = (await request(app).get('/api/oauth/quota').set(bearer)).body.points.remaining;
    await request(app).post(`/api/dossiers/${dossierId}/decisions`).set(bearer)
      .send({ references: ['Corte cost. n. 71/2020', 'Cass. civ. 77/2024', 'Corte EDU, n. 1/2020'] });
    const after = (await request(app).get('/api/oauth/quota').set(bearer)).body.points.remaining;
    expect(before - after).toBe(4);
  });

  it('refuses an exchanged token with any scope but dossier:write', async () => {
    for (const scope of ['dossier:read', 'lingo:cards:read', 'lingo:cards:write', 'content:delete']) {
      const auth = await delegated(alice, scope);
      const response = await request(app).post(`/api/dossiers/${dossierId}/decisions`).set(auth)
        .send({ references: ['Corte cost. n. 71/2020'] });
      expect([scope, response.status]).toEqual([scope, 403]);
    }
    expect(calls['/parse_decision']).toBeUndefined();
    expect(await prisma.dossierItem.count()).toBe(0);
  });
});
