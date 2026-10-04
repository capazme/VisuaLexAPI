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
  'art. 99 c.c.': { parsed: { act_type: 'codice civile', article: '99' }, recognized: true },
  'artt. 2043 e 2059 c.c.': { parsed: { act_type: 'codice civile', article: '2043,2059' }, recognized: true },
  'art. 2 legge': { parsed: { act_type: 'legge', article: '2' }, recognized: true },
  'art. 5 gdpr': { parsed: { act_type: 'regolamento UE', act_number: '679', date: '2016', article: '5' }, recognized: true },
  'dossier su contratti': { parsed: null, recognized: false },
  'art. 40 preleggi': { parsed: { act_type: 'preleggi', article: '40' }, recognized: true },
  'art. 12 preleggi': { parsed: { act_type: 'preleggi', article: '12' }, recognized: true },
  'art. 99 gdpr': { parsed: { act_type: 'regolamento UE', act_number: '679', date: '2016', article: '99' }, recognized: true },
  'art. 3 l. 241/1990': { parsed: { act_type: 'legge', act_number: '241', date: '1990', article: '3' }, recognized: true, display: 'Art. 3 — legge' },
  'art. 3 l. 247/2012': { parsed: { act_type: 'legge', act_number: '247', date: '2012', article: '3' }, recognized: true, display: 'Art. 3 — legge' },
  'art. 3 l. 49/2023': { parsed: { act_type: 'legge', act_number: '49', date: '2023', article: '3' }, recognized: true, display: 'Art. 3 — legge' },
};

// The full date fetch_norma_data finds for a law named by number and year.
const LAW_DATES: Record<string, string> = { '241': '1990-08-07', '247': '2012-12-31', '49': '2023-04-21' };
const lawUrl = (number: string) => `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:${LAW_DATES[number]};${number}`;


const GDPR_5 = {
  allegato: null, data: '2016-04-27', data_versione: null, numero_articolo: '5', numero_atto: '679',
  tipo_atto: 'regolamento UE', url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita',
  urn: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita~art5', versione: null,
};

const calls: Record<string, number> = {};
let fingerprintsAvailable = true;
let parseQueryDown = false;
let articleText = 'Qualunque fatto doloso o colposo…';
/** Force a status on a path (429: the Python API's per-address limit). */
let forcedStatus: Record<string, number> = {};
let treeDown = false;
let eurlexDown = false;
// Normattiva answers a request for a missing article with the act's art. 1, and 200.
const ART_1 = 'La capacità giuridica si acquista dal momento della nascita.';
// The codice civile's tree: the preleggi (annex 1, 31 articles) and the code (annex 2).
const CC_TREE = [
  ...Array.from({ length: 31 }, (_, i) => ({ allegato: '1', numero: String(i + 1) })),
  ...['2043', '2059', '2645 bis'].map((numero) => ({ allegato: '2', numero })),
  ...Array.from({ length: 60 }, (_, i) => ({ allegato: '2', numero: String(i + 1) })),
];

function stubPythonApi() {
  for (const key of Object.keys(calls)) delete calls[key];
  const count = (path: string) => (calls[path] = (calls[path] ?? 0) + 1);
  const forced = (path: string): [number, unknown] | undefined =>
    forcedStatus[path] ? [forcedStatus[path], { error: 'Too Many Requests' }] : undefined;
  nock(API).post('/parse_query').times(500).reply((_uri: string, body: { query: string }) => {
    count('/parse_query');
    if (parseQueryDown) return [503, { error: 'down' }];
    return forced('/parse_query') ?? [200, PARSED[body.query] ?? { parsed: null, recognized: false }];
  });
  nock(API).post('/fetch_norma_data').times(500).reply((_uri: string, body: Record<string, string>) => {
    count('/fetch_norma_data');
    const f = forced('/fetch_norma_data');
    if (f) return f;
    if (body.act_type === 'regolamento UE') return [200, { norma_data: [{ ...GDPR_5, numero_articolo: body.article, urn: `${GDPR_5.url}~art${body.article}` }] }];
    if (body.act_type === 'legge' && !body.act_number) {
      return [200, { norma_data: [{ ...ART_2043, tipo_atto: 'legge', data: null, numero_atto: null, allegato: null,
        url: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:None;None', urn: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:None;None~art2' }] }];
    }
    if (body.act_type === 'legge') {
      const url = lawUrl(body.act_number);
      return [200, { norma_data: [{ ...ART_2043, tipo_atto: 'legge', data: LAW_DATES[body.act_number], numero_atto: body.act_number, allegato: null, tipo_atto_reale: null,
        numero_articolo: body.article, url, urn: `${url}~art${body.article}` }] }];
    }
    if (body.act_type === 'preleggi') {
      return [200, { norma_data: [{ ...ccArticle(body.article), tipo_atto: 'preleggi', allegato: '1', urn: `${CC_ACT}:1~art${body.article}` }] }];
    }
    if (body.article === '99999') return [404, { error: 'Articolo 99999 non presente in codice civile 1942-03-16, n. 262' }];
    return [200, { norma_data: [ccArticle(body.article)] }];
  });
  nock(API).post('/fetch_act_fingerprints').times(500).reply((_uri: string, body: { urn: string }) => {
    count('/fetch_act_fingerprints');
    const f = forced('/fetch_act_fingerprints');
    if (f) return f;
    if (!fingerprintsAvailable) return [200, { available: false, fingerprints: {}, parts: [], count: 0 }];
    if (body.urn.includes(':legge:')) return [200, { available: true, fingerprints: { '1': 'x', '2': 'y', '3': 'z' }, parts: [{ name: 'Legge', fingerprints: {} }], count: 3 }];
    // The codice civile has three parts; `fingerprints` is the dominant one (the code), which has an art. 40.
    return [200, {
      available: true,
      fingerprints: { '40': 'd'.repeat(64), '2043': 'a'.repeat(64), '2059': 'b'.repeat(64), '2645-bis': 'c'.repeat(64) },
      parts: [{ name: 'Disposizioni sulla legge in generale', fingerprints: {} }, { name: 'CODICE CIVILE', fingerprints: {} }, { name: 'Dispositivo', fingerprints: {} }],
      count: 4,
    }];
  });
  nock(API).post('/fetch_tree').times(500).reply(() => {
    count('/fetch_tree');
    const f = forced('/fetch_tree');
    if (f) return f;
    if (treeDown) return [500, { error: 'Normattiva non raggiungibile' }];
    return [200, { articles: CC_TREE, count: CC_TREE.length }];
  });
  nock(API).post('/fetch_article_text').times(500).reply((_uri: string, body: Record<string, string>) => {
    count('/fetch_article_text');
    if (eurlexDown) return [200, [{ error: 'Network error: EUR-Lex unreachable' }]];
    if (body.act_type === 'regolamento UE' && body.article === '99') return [200, [{ error: 'Article 99 not found in the document' }]];
    // Normattiva: a missing article comes back as art. 1, with 200.
    return [200, [{ article_text: body.article === '3000' ? ART_1 : articleText, norma_data: {} }]];
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
    forcedStatus = {};
    treeDown = false;
    eurlexDown = false;
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
    expect(response.body.results[0]).toMatchObject({ reference: 'art. 2043 c.c.', display: 'art. 2043 c.c.' });
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
    // 99999: fetch_norma_data says so; 3000: not among the code's fingerprints.
    expect(response.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['does_not_exist', 'does_not_exist']);
    expect(await prisma.dossierItem.count()).toBe(0);
  });

  it('checks a multi-part act on its tree, annex by annex', async () => {
    // Art. 40 exists in the codice civile (annex 2) but not in the preleggi
    // (annex 1, 31 articles): the dominant part's fingerprints cannot tell.
    const response = await addNorms(alice, dossierId, ['art. 40 preleggi', 'art. 12 preleggi', 'art. 2043 c.c.', 'art. 2645-bis c.c.']);
    expect(response.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['does_not_exist', 'added', 'added', 'added']);
    expect(calls['/fetch_tree']).toBe(1);
  });

  it('decides a single-part act on its fingerprints alone', async () => {
    const response = await addNorms(alice, dossierId, ['art. 3 l. 241/1990']);
    expect(response.body.results[0].outcome).toBe('added');
    expect(calls['/fetch_tree'] ?? 0).toBe(0);
  });

  it('without an index, decides on the tree, and never on the text alone', async () => {
    fingerprintsAvailable = false;
    const response = await addNorms(alice, dossierId, ['art. 2043 c.c.', 'art. 99 c.c.']);
    expect(response.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['added', 'does_not_exist']);
    expect(calls['/fetch_article_text'] ?? 0).toBe(0);
  });

  it('without an index or a tree, says it cannot verify: Normattiva answers a missing article with art. 1', async () => {
    fingerprintsAvailable = false;
    treeDown = true;
    const response = await addNorms(alice, dossierId, ['art. 3000 c.c.', 'art. 2043 c.c.']);
    expect(response.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['unavailable', 'unavailable']);
    expect(await prisma.dossierItem.count()).toBe(0);
  });

  it('reads a source at its limit (429) as unavailable, never as missing or unrecognised', async () => {
    for (const path of ['/parse_query', '/fetch_norma_data', '/fetch_act_fingerprints']) {
      forcedStatus = { [path]: 429 };
      if (path === '/fetch_act_fingerprints') forcedStatus['/fetch_tree'] = 429;
      const response = await addNorms(alice, dossierId, ['art. 2043 c.c.']);
      expect([path, response.body.results[0].outcome]).toEqual([path, 'unavailable']);
    }
    expect(await prisma.dossierItem.count()).toBe(0);
  });

  it('a failure on one act does not take the other acts with it', async () => {
    forcedStatus = { '/fetch_act_fingerprints': 429, '/fetch_tree': 429 };
    const response = await addNorms(alice, dossierId, ['art. 5 gdpr', 'art. 2043 c.c.']);
    expect(response.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['added', 'unavailable']);
  });

  it('checks an EU act through its article, which has no AKN index', async () => {
    const response = await addNorms(alice, dossierId, ['art. 5 gdpr', 'art. 99 gdpr']);
    expect(response.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['added', 'does_not_exist']);
    expect(calls['/fetch_act_fingerprints'] ?? 0).toBe(0);
    expect(calls['/fetch_article_text']).toBe(2);
  });

  it('reads an EUR-Lex outage inside a 200 as unavailable, not as missing', async () => {
    eurlexDown = true;
    const response = await addNorms(alice, dossierId, ['art. 5 gdpr']);
    expect(response.body.results[0].outcome).toBe('unavailable');
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

  it('names each norm in the app\'s citation style, so two laws in one dossier are told apart', async () => {
    const response = await addNorms(alice, dossierId, ['art. 3 l. 247/2012', 'art. 3 l. 49/2023', 'art. 2043 c.c.', 'art. 99 c.c.']);
    expect(response.body.results.map((r: { outcome: string; display?: string }) => [r.outcome, r.display])).toEqual([
      ['added', 'art. 3, l. 31 dicembre 2012, n. 247'],
      ['added', 'art. 3, l. 21 aprile 2023, n. 49'],
      ['added', 'art. 2043 c.c.'],
      ['does_not_exist', 'art. 99 c.c.'],
    ]);
    // Python's own label ("Art. 3 — legge") never reaches the answer.
    expect(JSON.stringify(response.body)).not.toContain('— legge');

    // The dossier's items carry the same citation, for every reader of the API (the MCP tools included).
    const dossier = await request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(alice));
    expect(dossier.body.items.map((i: { citation?: string | null }) => i.citation)).toEqual([
      'art. 3, l. 31 dicembre 2012, n. 247',
      'art. 3, l. 21 aprile 2023, n. 49',
      'art. 2043 c.c.',
    ]);
    const list = await request(app).get('/api/dossiers').set(authHeader(alice));
    expect(list.body[0].items[0].citation).toBe('art. 3, l. 31 dicembre 2012, n. 247');
  });

  it('gives a note no citation', async () => {
    await request(app).post(`/api/dossiers/${dossierId}/items`).set(authHeader(alice)).send({ itemType: 'note', title: 'Nota', content: 'appunto' });
    const dossier = await request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(alice));
    expect(dossier.body.items[0].citation).toBeNull();
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
    // References the sources could not check are not charged (review of PR #57, M3).
    forcedStatus = { '/parse_query': 429 };
    const unchecked = await request(app)
      .post(`/api/dossiers/${dossierId}/norms`)
      .set(bearer)
      .send({ references: ['art. 2043 c.c.', 'art 2059 cc'] });
    expect(unchecked.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['unavailable', 'unavailable']);
    const afterUnchecked = (await request(app).get('/api/oauth/quota').set(bearer)).body.points.remaining;
    expect(afterUnchecked).toBe(after);
    forcedStatus = {};
    const readOnly = await delegatedToken(alice, 'dossier:read');
    const refused = await request(app)
      .post(`/api/dossiers/${dossierId}/norms`)
      .set({ Authorization: `Bearer ${readOnly.apiToken}` })
      .send({ references: ['art. 2043 c.c.'] });
    expect(refused.status).toBe(403);
  });
});
