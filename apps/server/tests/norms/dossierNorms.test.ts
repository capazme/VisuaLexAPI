import nock from 'nock';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from '../helpers';
import { delegatedToken } from '../oauth/oauthHelpers';

// The Python API, stubbed: what it answered on 4 October 2026 for these
// references (probed on the development stack).
const API = 'http://legal-api.test';
const originalLegalApiUrl = process.env.LEGAL_API_URL;
const CC_ACT = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262';

/** What the web app stores as a dossier item's content for art. 2043 c.c. (`norma_data`). */
const ART_2043 = {
  allegato: '2',
  data: '1942-03-16',
  data_versione: null,
  numero_articolo: '2043',
  numero_atto: '262',
  tipo_atto: 'codice civile',
  tipo_atto_reale: 'regio decreto',
  url: CC_ACT,
  urn: `${CC_ACT}:2~art2043`,
  versione: null,
};
const ccArticle = (n: string) => ({ ...ART_2043, numero_articolo: n, urn: `${CC_ACT}:2~art${n.replace('-', '')}` });

const PARSED: Record<string, { parsed: Record<string, string> | null; recognized: boolean; display?: string }> = {
  'art. 2043 c.c.': { parsed: { act_type: 'codice civile', article: '2043' }, recognized: true, display: 'Art. 2043 — codice civile' },
  'art 2059 cc': { parsed: { act_type: 'codice civile', article: '2059' }, recognized: true, display: 'Art. 2059 — codice civile' },
  'art. 2645-bis c.c.': { parsed: { act_type: 'codice civile', article: '2645-bis' }, recognized: true },
  'art. 99999 c.c.': { parsed: { act_type: 'codice civile', article: '99999' }, recognized: true },
  'art. 3000 c.c.': { parsed: { act_type: 'codice civile', article: '3000' }, recognized: true },
  'artt. 2043 e 2059 c.c.': { parsed: { act_type: 'codice civile', article: '2043,2059' }, recognized: true },
  'art. 2 legge': { parsed: { act_type: 'legge', article: '2' }, recognized: true },
  'art. 5 gdpr': { parsed: { act_type: 'regolamento UE', act_number: '679', date: '2016', article: '5' }, recognized: true },
  'dossier su contratti': { parsed: null, recognized: false },
};

const GDPR_5 = {
  allegato: null, data: '2016-04-27', data_versione: null, numero_articolo: '5', numero_atto: '679',
  tipo_atto: 'regolamento UE', url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita',
  urn: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita~art5', versione: null,
};

const calls: Record<string, number> = {};
let fingerprintsAvailable = true;
let parseQueryDown = false;
let articleText = 'Qualunque fatto doloso o colposo…';

function stubPythonApi() {
  for (const key of Object.keys(calls)) delete calls[key];
  const count = (path: string) => (calls[path] = (calls[path] ?? 0) + 1);
  nock(API).post('/parse_query').times(500).reply((_uri: string, body: { query: string }) => {
    count('/parse_query');
    if (parseQueryDown) return [503, { error: 'down' }];
    return [200, PARSED[body.query] ?? { parsed: null, recognized: false }];
  });
  nock(API).post('/fetch_norma_data').times(500).reply((_uri: string, body: Record<string, string>) => {
    count('/fetch_norma_data');
    if (body.act_type === 'regolamento UE') return [200, { norma_data: [GDPR_5] }];
    if (body.act_type === 'legge') {
      return [200, { norma_data: [{ ...ART_2043, tipo_atto: 'legge', data: null, numero_atto: null, allegato: null,
        url: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:None;None', urn: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:None;None~art2' }] }];
    }
    if (body.article === '99999') return [404, { error: 'Articolo 99999 non presente in codice civile 1942-03-16, n. 262' }];
    return [200, { norma_data: [ccArticle(body.article)] }];
  });
  nock(API).post('/fetch_act_fingerprints').times(500).reply(() => {
    count('/fetch_act_fingerprints');
    if (!fingerprintsAvailable) return [200, { available: false, fingerprints: {}, parts: [], count: 0 }];
    return [200, { available: true, fingerprints: { '2043': 'a'.repeat(64), '2059': 'b'.repeat(64), '2645-bis': 'c'.repeat(64) }, parts: [], count: 3 }];
  });
  nock(API).post('/fetch_article_text').times(500).reply((_uri: string, body: Record<string, string>) => {
    count('/fetch_article_text');
    return [200, [{ article_text: body.article === '3000' ? '' : articleText, norma_data: {} }]];
  });
}

async function addNorms(user: TestUser, dossierId: string, references: string[]) {
  return request(app).post(`/api/dossiers/${dossierId}/norms`).set(authHeader(user)).send({ references });
}

beforeAll(() => nock.activate());
afterAll(() => nock.restore());

describe('POST /api/dossiers/:id/norms', () => {
  let alice: TestUser;
  let dossierId: string;
  beforeEach(async () => {
    process.env.LEGAL_API_URL = API;
    fingerprintsAvailable = true;
    parseQueryDown = false;
    articleText = 'Qualunque fatto doloso o colposo…';
    stubPythonApi();
    alice = await createTestUser('norms-alice');
    dossierId = (await request(app).post('/api/dossiers').set(authHeader(alice)).send({ name: 'Prova' })).body.id;
  });
  afterEach(() => {
    nock.cleanAll();
    if (originalLegalApiUrl === undefined) delete process.env.LEGAL_API_URL;
    else process.env.LEGAL_API_URL = originalLegalApiUrl;
  });

  it('adds arts. 2043 and 2059 c.c. as the web app stores a norm, checking the act once', async () => {
    const response = await addNorms(alice, dossierId, ['art. 2043 c.c.', 'art 2059 cc']);
    expect(response.status).toBe(200);
    expect(response.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['added', 'added']);
    expect(response.body.results[0]).toMatchObject({ reference: 'art. 2043 c.c.', display: 'Art. 2043 — codice civile' });
    const items = await prisma.dossierItem.findMany({ where: { dossierId }, orderBy: { position: 'asc' } });
    expect(items.map((i) => i.itemType)).toEqual(['norm', 'norm']);
    expect(items[0].title).toBe('codice civile');
    expect(items[0].content).toEqual(ART_2043);
    expect(items[1].content).toEqual(ccArticle('2059'));
    expect(items.map((i) => i.position)).toEqual([0, 1]);
    expect(calls['/fetch_act_fingerprints']).toBe(1);
    expect(response.body.results[0].itemId).toBe(items[0].id);
  });

  it('never saves an article that does not exist', async () => {
    const response = await addNorms(alice, dossierId, ['art. 99999 c.c.', 'art. 3000 c.c.']);
    expect(response.status).toBe(200);
    expect(response.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['does_not_exist', 'does_not_exist']);
    expect(await prisma.dossierItem.count()).toBe(0);
  });

  it('falls back to the article itself when the act has no index', async () => {
    fingerprintsAvailable = false;
    const response = await addNorms(alice, dossierId, ['art. 2043 c.c.', 'art. 3000 c.c.']);
    expect(response.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['added', 'does_not_exist']);
    expect(calls['/fetch_article_text']).toBe(2);
  });

  it('checks an EU act through its article, which has no AKN index', async () => {
    const response = await addNorms(alice, dossierId, ['art. 5 gdpr']);
    expect(response.body.results[0].outcome).toBe('added');
    expect(calls['/fetch_act_fingerprints'] ?? 0).toBe(0);
    expect(calls['/fetch_article_text']).toBe(1);
  });

  it('reports what is ambiguous or unrecognised and saves the others', async () => {
    const response = await addNorms(alice, dossierId, [
      'artt. 2043 e 2059 c.c.',
      'art. 2 legge',
      'dossier su contratti',
      'art. 2645-bis c.c.',
    ]);
    expect(response.body.results.map((r: { outcome: string }) => r.outcome)).toEqual([
      'ambiguous',
      'ambiguous',
      'not_recognised',
      'added',
    ]);
    for (const r of response.body.results.slice(0, 3)) expect(r.detail).toEqual(expect.any(String));
    expect(await prisma.dossierItem.count()).toBe(1);
  });

  it('adds the same article once, in a call and across calls', async () => {
    const first = await addNorms(alice, dossierId, ['art. 2043 c.c.', 'art. 2043 c.c.']);
    expect(first.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['added', 'already_present']);
    const second = await addNorms(alice, dossierId, ['art. 2043 c.c.']);
    expect(second.body.results[0].outcome).toBe('already_present');
    expect(await prisma.dossierItem.count()).toBe(1);
  });

  it('says the sources are unavailable, and saves nothing unchecked', async () => {
    parseQueryDown = true;
    const response = await addNorms(alice, dossierId, ['art. 2043 c.c.']);
    expect(response.status).toBe(200);
    expect(response.body.results[0].outcome).toBe('unavailable');
    expect(await prisma.dossierItem.count()).toBe(0);
  });

  it('takes 1 to 50 references, each a short string', async () => {
    const fiftyOne = Array.from({ length: 51 }, (_, i) => `art. ${i + 1} c.c.`);
    expect((await addNorms(alice, dossierId, fiftyOne)).status).toBe(400);
    expect((await addNorms(alice, dossierId, [])).status).toBe(400);
    expect((await addNorms(alice, dossierId, ['x'.repeat(201)])).status).toBe(400);
    expect(await prisma.dossierItem.count()).toBe(0);
  });

  it("answers 404 for another user's dossier", async () => {
    const bob = await createTestUser('norms-bob');
    const response = await addNorms(bob, dossierId, ['art. 2043 c.c.']);
    expect(response.status).toBe(404);
    expect(await prisma.dossierItem.count()).toBe(0);
  });

  it('is open to an exchanged token with dossier:write, at two points per reference', async () => {
    const { apiToken } = await delegatedToken(alice);
    const bearer = { Authorization: `Bearer ${apiToken}` };
    const before = (await request(app).get('/api/oauth/quota').set(bearer)).body.points.remaining;
    const response = await request(app)
      .post(`/api/dossiers/${dossierId}/norms`)
      .set(bearer)
      .send({ references: ['art. 2043 c.c.', 'art 2059 cc', 'dossier su contratti'] });
    expect(response.status).toBe(200);
    const after = (await request(app).get('/api/oauth/quota').set(bearer)).body.points.remaining;
    expect(before - after).toBe(6);
    const readOnly = await delegatedToken(alice, 'dossier:read');
    const refused = await request(app)
      .post(`/api/dossiers/${dossierId}/norms`)
      .set({ Authorization: `Bearer ${readOnly.apiToken}` })
      .send({ references: ['art. 2043 c.c.'] });
    expect(refused.status).toBe(403);
  });
});
