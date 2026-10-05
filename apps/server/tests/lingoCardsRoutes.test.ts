import nock from 'nock';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from './helpers';
import { exchangeCode, startAuthorization, tokenExchange } from './oauth/oauthHelpers';
import { spendDelegatedCounter } from '../src/middleware/delegated';
import { deleteUserAccount } from '../src/lingo/deleteUserAccount';

// The study-card routes (MCP second round, spec §6; the spike plan's Task 12):
// a card made through them is always the author's draft, anchored on articles
// given as references, each with the fingerprint the Python API computes.

const API = 'http://legal-api.test';
const originalLegalApiUrl = process.env.LEGAL_API_URL;
const CC = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262';
const ccArticle = (n: string) => ({
  tipo_atto: 'codice civile', tipo_atto_reale: 'regio decreto', data: '1942-03-16', numero_atto: '262', numero_articolo: n,
  allegato: '2', url: CC, urn: `${CC}:2~art${n}`, versione: null, data_versione: null,
});
const HASH: Record<string, string> = { '1453': 'a'.repeat(64), '1455': 'b'.repeat(64) };

const LONG_ACT = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1941-09-09;1023';
// A real act name long enough to overflow the card schema's 100-character normaKey (code review of PR 5).
const LONG_NAME = 'disposizioni di coordinamento, transitorie e di attuazione dei Codici penali militari di pace e di guerra';
const GDPR = 'https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita';
let pythonDown = false;
const calls: Record<string, number> = {};

function stubPythonApi() {
  for (const key of Object.keys(calls)) delete calls[key];
  const count = (path: string) => (calls[path] = (calls[path] ?? 0) + 1);
  nock(API).post('/parse_query').times(200).reply((_u: string, body: { query: string }) => {
    count('/parse_query');
    if (pythonDown) return [503, { error: 'down' }];
    if (body.query === 'art. 5 gdpr') return [200, { parsed: { act_type: 'regolamento UE', act_number: '679', date: '2016', article: '5' }, recognized: true }];
    if (body.query === 'art. 7 coord. militari') return [200, { parsed: { act_type: LONG_NAME, article: '7' }, recognized: true }];
    const m = /^art\. (\d+) c\.c\.$/.exec(body.query);
    return [200, m ? { parsed: { act_type: 'codice civile', article: m[1] }, recognized: true } : { parsed: null, recognized: false }];
  });
  nock(API).post('/fetch_norma_data').times(200).reply((_u: string, body: { act_type: string; article: string }) => {
    count('/fetch_norma_data');
    if (body.act_type === 'regolamento UE') {
      return [200, { norma_data: [{ tipo_atto: 'regolamento UE', tipo_atto_reale: null, data: '2016-04-27', numero_atto: '679', numero_articolo: '5', allegato: null, url: GDPR, urn: `${GDPR}~art5` }] }];
    }
    if (body.act_type === LONG_NAME) {
      return [200, { norma_data: [{ tipo_atto: LONG_NAME, tipo_atto_reale: 'regio decreto', data: '1941-09-09', numero_atto: '1023', numero_articolo: '7', allegato: null, url: LONG_ACT, urn: `${LONG_ACT}~art7` }] }];
    }
    return body.article === '99999' ? [404, { error: 'Articolo 99999 non presente in codice civile' }] : [200, { norma_data: [ccArticle(body.article)] }];
  });
  nock(API).post('/fetch_act_fingerprints').times(200).reply((_u: string, body: { urn: string }) => {
    count('/fetch_act_fingerprints');
    if (body.urn === LONG_ACT) return [200, { available: true, fingerprints: { '7': { fingerprint: 'e'.repeat(64), date: null } }, parts: [], count: 1 }];
    return [200, {
      available: true,
      fingerprints: { '1453': { fingerprint: HASH['1453'], date: null }, '1455': { fingerprint: HASH['1455'], date: null } },
      parts: [
        { name: 'Disposizioni sulla legge in generale', fingerprints: { '1': { fingerprint: 'f'.repeat(64), date: null } } },
        { name: 'CODICE CIVILE', fingerprints: { '1453': { fingerprint: HASH['1453'], date: null }, '1455': { fingerprint: HASH['1455'], date: null } } },
      ],
      count: 3,
    }];
  });
  nock(API).post('/fetch_tree').times(200).reply(() => {
    count('/fetch_tree');
    return [200, { articles: [{ allegato: '1', numero: '1' }, { allegato: '2', numero: '1453' }, { allegato: '2', numero: '1455' }] }];
  });
  nock(API).post('/fetch_article_text').times(200).reply(() => [200, [{ article_text: 'I dati personali sono trattati in modo lecito…', norma_data: {} }]]);
}

const CARD = {
  materia: 'DIRITTO_CIVILE',
  istituto: 'Risoluzione per inadempimento',
  domanda: 'Quando si può chiedere la risoluzione del contratto?',
  risposta: 'Quando l’altra parte non adempie e l’inadempimento non è di scarsa importanza.',
  ancore: [{ riferimento: 'art. 1453 c.c.' }, { riferimento: 'art. 1455 c.c.' }],
};

/** An API token for `scope`, for a connection with deletion on. */
async function delegated(user: TestUser, scope: string) {
  const flow = await startAuthorization({ scope: 'dossier:read dossier:write lingo:cards:read lingo:cards:write' });
  const auth = authHeader(user);
  await request(app).get(`/api/oauth/requests/${flow.requestId}`).set(auth);
  const decision = await request(app).post(`/api/oauth/requests/${flow.requestId}/decision`).set(auth).send({ approve: true, allowDelete: true });
  const code = new URL(decision.body.redirectTo).searchParams.get('code')!;
  const access = (await exchangeCode(flow.clientId, code, flow.verifier)).body.access_token as string;
  const exchanged = await tokenExchange(access, { scope });
  if (exchanged.status !== 200) throw new Error(`exchange failed: ${JSON.stringify(exchanged.body)}`);
  return { Authorization: `Bearer ${exchanged.body.access_token}` };
}

describe('the study-card routes', () => {
  let alice: TestUser;
  beforeAll(() => nock.activate());
  afterAll(() => nock.restore());
  beforeEach(async () => {
    process.env.LEGAL_API_URL = API;
    pythonDown = false;
    stubPythonApi();
    alice = await createTestUser('cards-alice');
  });
  afterEach(() => {
    nock.cleanAll();
    if (originalLegalApiUrl === undefined) delete process.env.LEGAL_API_URL;
    else process.env.LEGAL_API_URL = originalLegalApiUrl;
  });

  const create = (who: Record<string, string>, cards: unknown[]) => request(app).post('/api/lingo/cards').set(who).send({ cards });

  it('creates a card as the author’s draft, anchored with the keys, the official URN and the fingerprint the API computed', async () => {
    const response = await create(authHeader(alice), [CARD]);
    expect(response.status).toBe(200);
    expect(response.body.results[0]).toMatchObject({ outcome: 'created' });
    const card = await prisma.lingoCard.findUniqueOrThrow({ where: { id: response.body.results[0].id }, include: { ancore: { orderBy: { articleId: 'asc' } } } });
    expect(card).toMatchObject({ autoreId: alice.id, stato: 'BOZZA_PERSONALE', istituto: CARD.istituto });
    expect(card.ancore.map((a) => [a.normaKey, a.articleId, a.urn, a.aknFingerprint, a.isPrimary])).toEqual([
      ['codice_civile', 'art_1453', 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453', HASH['1453'], true],
      ['codice_civile', 'art_1455', 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1455', HASH['1455'], false],
    ]);
  });

  it('marks the primary anchor the caller names', async () => {
    const response = await create(authHeader(alice), [{ ...CARD, ancore: [{ riferimento: 'art. 1453 c.c.' }, { riferimento: 'art. 1455 c.c.', principale: true }] }]);
    const card = await prisma.lingoCard.findUniqueOrThrow({ where: { id: response.body.results[0].id }, include: { ancore: true } });
    expect(card.ancore.find((a) => a.isPrimary)?.articleId).toBe('art_1455');
  });

  it('refuses a body that tries to set the state, the author or a fingerprint', async () => {
    for (const extra of [{ stato: 'VALIDATA' }, { autoreId: 'x' }]) {
      expect((await create(authHeader(alice), [{ ...CARD, ...extra }])).status).toBe(400);
    }
    expect((await create(authHeader(alice), [{ ...CARD, ancore: [{ riferimento: 'art. 1453 c.c.', aknFingerprint: 'a'.repeat(64) }] }])).status).toBe(400);
    expect(await prisma.lingoCard.count()).toBe(0);
  });

  it('refuses a card whose anchor cannot be verified, and still creates the others', async () => {
    const response = await create(authHeader(alice), [{ ...CARD, ancore: [{ riferimento: 'art. 99999 c.c.' }] }, CARD]);
    expect(response.body.results[0]).toMatchObject({ outcome: 'refused' });
    expect(response.body.results[0].anchors[0]).toMatchObject({ reference: 'art. 99999 c.c.', outcome: 'does_not_exist' });
    expect(response.body.results[1]).toMatchObject({ outcome: 'created' });
    expect(await prisma.lingoCard.count()).toBe(1);
  });

  it('takes 1 to 10 cards and 1 to 10 anchors each', async () => {
    expect((await create(authHeader(alice), [])).status).toBe(400);
    expect((await create(authHeader(alice), Array.from({ length: 11 }, () => CARD))).status).toBe(400);
    expect((await create(authHeader(alice), [{ ...CARD, ancore: [] }])).status).toBe(400);
  });

  it('checks at most 20 references a call, and charges each one like the dossier’s norms (security review of 89de00d2)', async () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ riferimento: `art. ${1400 + i} c.c.` }));
    const tooMany = await create(authHeader(alice), [{ ...CARD, ancore: many.slice(0, 10) }, { ...CARD, ancore: many.slice(10, 20) }, { ...CARD, ancore: many.slice(20) }]);
    expect(tooMany.status).toBe(400);
    const write = await delegated(alice, 'lingo:cards:write');
    const reader = await delegated(alice, 'dossier:read');
    const quota = async () => (await request(app).get('/api/oauth/quota').set(reader)).body.points.remaining;
    const before = await quota();
    await create(write, [{ ...CARD, ancore: [{ riferimento: 'art. 1453 c.c.' }, { riferimento: 'art. 1455 c.c.' }, { riferimento: 'art. 1453 c.c.' }] }]);
    // Two distinct references, two points each.
    expect(before - (await quota())).toBe(4);
  });

  describe('review findings on PR 5', () => {
    it('CR1. a card the schema would refuse is refused in its result, never a 400 after earlier cards were written', async () => {
      const response = await create(authHeader(alice), [CARD, { ...CARD, ancore: [{ riferimento: 'art. 7 coord. militari' }] }]);
      expect(response.status).toBe(200);
      expect(response.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['created', 'refused']);
      expect(await prisma.lingoCard.count()).toBe(1);
    });

    it('CR1. two primary anchors on one card are refused before anything is written', async () => {
      const response = await create(authHeader(alice), [CARD, { ...CARD, ancore: [{ riferimento: 'art. 1453 c.c.', principale: true }, { riferimento: 'art. 1455 c.c.', principale: true }] }]);
      expect(response.status).toBe(400);
      expect(await prisma.lingoCard.count()).toBe(0);
    });

    it('CR2. sources down for every card: 503, nothing written, nothing spent', async () => {
      pythonDown = true;
      const write = await delegated(alice, 'lingo:cards:write');
      const reader = await delegated(alice, 'dossier:read');
      const before = (await request(app).get('/api/oauth/quota').set(reader)).body;
      const response = await create(write, [CARD]);
      expect(response.status).toBe(503);
      const after = (await request(app).get('/api/oauth/quota').set(reader)).body;
      expect(after.points.remaining).toBe(before.points.remaining);
      expect(after.counters.card.remaining).toBe(before.counters.card.remaining);
    });

    it('CR3. anchors that resolve to the same official URN are one anchor', async () => {
      const response = await create(authHeader(alice), [{ ...CARD, ancore: [{ riferimento: 'art. 1453 c.c.' }, { riferimento: 'art. 1453 c.c.', principale: true }, { riferimento: 'art. 1455 c.c.' }] }]);
      const card = await prisma.lingoCard.findUniqueOrThrow({ where: { id: response.body.results[0].id }, include: { ancore: true } });
      expect(card.ancore).toHaveLength(2);
      expect(card.ancore.find((a) => a.articleId === 'art_1453')?.isPrimary).toBe(true);
    });

    it('CR6. a call refused at the card limit does not use up the cards left', async () => {
      const write = await delegated(alice, 'lingo:cards:write');
      await spendDelegatedCounter(alice.id, 'card', 95);
      expect((await create(write, Array.from({ length: 10 }, () => CARD))).status).toBe(429);
      expect((await create(write, Array.from({ length: 5 }, () => CARD))).status).toBe(200);
    });

    it('CR7. one act is looked up once for its fingerprints, however many of its articles a call anchors', async () => {
      await create(authHeader(alice), [CARD, { ...CARD, ancore: [{ riferimento: 'art. 1455 c.c.' }] }]);
      // One lookup to confirm the articles exist, one to anchor them.
      expect(calls['/fetch_act_fingerprints']).toBeLessThanOrEqual(2);
    });

    it('CR8. pages never repeat or skip a card when several share a creation time', async () => {
      const ids = (await create(authHeader(alice), [CARD, CARD, CARD])).body.results.map((r: { id: string }) => r.id);
      await prisma.lingoCard.updateMany({ where: { id: { in: ids } }, data: { createdAt: new Date('2026-10-05T10:00:00Z') } });
      const page1 = (await request(app).get('/api/lingo/cards?limit=2').set(authHeader(alice))).body.cards.map((c: { id: string }) => c.id);
      const page2 = (await request(app).get('/api/lingo/cards?limit=2&offset=2').set(authHeader(alice))).body.cards.map((c: { id: string }) => c.id);
      expect([...page1, ...page2].sort()).toEqual([...ids].sort());
    });

    it('SR-M1. a refusal that will not change (an EU act) is paid for; only a source failure is handed back', async () => {
      const write = await delegated(alice, 'lingo:cards:write');
      const reader = await delegated(alice, 'dossier:read');
      const before = (await request(app).get('/api/oauth/quota').set(reader)).body.points.remaining;
      const response = await create(write, [{ ...CARD, ancore: [{ riferimento: 'art. 5 gdpr' }] }]);
      expect(response.body.results[0].outcome).toBe('refused');
      expect(before - (await request(app).get('/api/oauth/quota').set(reader)).body.points.remaining).toBe(2);
    });

    it('SR-M4. deleting cards needs the card read permission on the grant, not only content:delete', async () => {
      const id = (await create(authHeader(alice), [CARD])).body.results[0].id;
      const flow = await startAuthorization({ scope: 'dossier:read dossier:write' });
      await request(app).get(`/api/oauth/requests/${flow.requestId}`).set(authHeader(alice));
      const decision = await request(app).post(`/api/oauth/requests/${flow.requestId}/decision`).set(authHeader(alice)).send({ approve: true, allowDelete: true });
      const code = new URL(decision.body.redirectTo).searchParams.get('code')!;
      const access = (await exchangeCode(flow.clientId, code, flow.verifier)).body.access_token as string;
      const token = (await tokenExchange(access, { scope: 'content:delete' })).body.access_token as string;
      const refused = await request(app).post('/api/lingo/cards/trash').set({ Authorization: `Bearer ${token}` }).send({ cardIds: [id] });
      expect(refused.status).toBe(403);
      expect(await prisma.lingoCard.count({ where: { id } })).toBe(1);
    });
  });

  it('lists and reads only the user’s own cards', async () => {
    const id = (await create(authHeader(alice), [CARD])).body.results[0].id;
    const bob = await createTestUser('cards-bob');
    expect((await request(app).get(`/api/lingo/cards/${id}`).set(authHeader(bob))).status).toBe(404);
    expect((await request(app).get('/api/lingo/cards').set(authHeader(bob))).body.cards).toEqual([]);
    const mine = await request(app).get('/api/lingo/cards').set(authHeader(alice));
    expect(mine.body.cards.map((c: { id: string }) => c.id)).toEqual([id]);
    const one = await request(app).get(`/api/lingo/cards/${id}`).set(authHeader(alice));
    expect(one.body).toMatchObject({ id, stato: 'BOZZA_PERSONALE', ancore: [expect.objectContaining({ articleId: 'art_1453' }), expect.anything()] });
  });

  it('is open to a connected application with the card permissions, and counts the cards against the day', async () => {
    const write = await delegated(alice, 'lingo:cards:write');
    expect((await create(write, [CARD])).status).toBe(200);
    const read = await delegated(alice, 'lingo:cards:read');
    expect((await request(app).get('/api/lingo/cards').set(read)).body.cards).toHaveLength(1);
    const dossierOnly = await delegated(alice, 'dossier:write');
    expect((await create(dossierOnly, [CARD])).status).toBe(403);
    await spendDelegatedCounter(alice.id, 'card', 99);
    const refused = await create(write, [CARD, CARD]);
    expect(refused.status).toBe(429);
    expect(refused.body.quota).toBe('card');
  });

  describe('deleting cards through a connected application', () => {
    it('moves the user’s own drafts and archived cards; a card the community took up is refused, another user’s not found', async () => {
      const [draft, archived, proposed] = (await create(authHeader(alice), [CARD, CARD, CARD])).body.results.map((r: { id: string }) => r.id);
      await prisma.lingoCard.update({ where: { id: archived }, data: { stato: 'ARCHIVIATA' } });
      await prisma.lingoCard.update({ where: { id: proposed }, data: { stato: 'PROPOSTA_COMMUNITY' } });
      const bob = await createTestUser('cards-bob2');
      const bobs = (await create(authHeader(bob), [CARD])).body.results[0].id;
      const del = await delegated(alice, 'content:delete');
      const response = await request(app).post('/api/lingo/cards/trash').set(del).send({ cardIds: [draft, archived, proposed, bobs] });
      expect(response.status).toBe(200);
      expect(response.body.moved.sort()).toEqual([draft, archived].sort());
      expect(response.body.notDeletable).toEqual([proposed]);
      expect(response.body.notFound).toEqual([bobs]);
      expect(await prisma.lingoCard.count({ where: { id: { in: [draft, archived] } } })).toBe(0);
      expect(await prisma.lingoCard.count({ where: { id: { in: [proposed, bobs] } } })).toBe(2);
      const trash = (await request(app).get('/api/trash').set(authHeader(alice))).body;
      expect(trash[0]).toMatchObject({ kind: 'LINGO_CARDS', dossierId: null, label: 'Schede LingoLex', itemCount: 2 });
      expect(trash[0].cards[0]).toEqual({ istituto: CARD.istituto, domanda: CARD.domanda });
    });

    it('restores the cards with their ids, anchors and state', async () => {
      const id = (await create(authHeader(alice), [CARD])).body.results[0].id;
      const before = await prisma.lingoCard.findUniqueOrThrow({ where: { id }, include: { ancore: true } });
      const del = await delegated(alice, 'content:delete');
      await request(app).post('/api/lingo/cards/trash').set(del).send({ cardIds: [id] });
      const [entry] = (await request(app).get('/api/trash').set(authHeader(alice))).body;
      expect((await request(app).post(`/api/trash/${entry.id}/restore`).set(authHeader(alice)).send({})).status).toBe(200);
      const after = await prisma.lingoCard.findUniqueOrThrow({ where: { id }, include: { ancore: true } });
      const { updatedAt: _a, ...beforeRest } = before;
      const { updatedAt: _b, ...afterRest } = after;
      expect(afterRest).toEqual(beforeRest);
    });

    it('nothing deletable writes no trash entry', async () => {
      const id = (await create(authHeader(alice), [CARD])).body.results[0].id;
      await prisma.lingoCard.update({ where: { id }, data: { stato: 'VALIDATA' } });
      const del = await delegated(alice, 'content:delete');
      const response = await request(app).post('/api/lingo/cards/trash').set(del).send({ cardIds: [id] });
      expect(response.body).toMatchObject({ moved: [], notDeletable: [id] });
      expect(response.body.trashId).toBeUndefined();
      expect(await prisma.trashEntry.count()).toBe(0);
    });

    it('needs content:delete and the card read permission; a user session cannot use it', async () => {
      const id = (await create(authHeader(alice), [CARD])).body.results[0].id;
      expect((await request(app).post('/api/lingo/cards/trash').set(await delegated(alice, 'lingo:cards:write')).send({ cardIds: [id] })).status).toBe(403);
      expect((await request(app).post('/api/lingo/cards/trash').set(authHeader(alice)).send({ cardIds: [id] })).status).toBe(403);
    });
  });

  it('account deletion still removes the drafts and keeps a card the community took up', async () => {
    const [draft, proposed] = (await create(authHeader(alice), [CARD, CARD])).body.results.map((r: { id: string }) => r.id);
    await prisma.lingoCard.update({ where: { id: proposed }, data: { stato: 'PROPOSTA_COMMUNITY' } });
    await deleteUserAccount(alice.id);
    expect(await prisma.lingoCard.count({ where: { id: draft } })).toBe(0);
    expect(await prisma.lingoCard.findUniqueOrThrow({ where: { id: proposed } })).toMatchObject({ autoreId: null });
  });
});
