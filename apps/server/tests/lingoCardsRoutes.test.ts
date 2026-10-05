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

function stubPythonApi() {
  nock(API).post('/parse_query').times(200).reply((_u: string, body: { query: string }) => {
    const m = /^art\. (\d+) c\.c\.$/.exec(body.query);
    return [200, m ? { parsed: { act_type: 'codice civile', article: m[1] }, recognized: true } : { parsed: null, recognized: false }];
  });
  nock(API).post('/fetch_norma_data').times(200).reply((_u: string, body: { article: string }) =>
    body.article === '99999' ? [404, { error: 'Articolo 99999 non presente in codice civile' }] : [200, { norma_data: [ccArticle(body.article)] }],
  );
  nock(API).post('/fetch_act_fingerprints').times(200).reply(() => [200, {
    available: true,
    fingerprints: { '1453': { fingerprint: HASH['1453'], date: null }, '1455': { fingerprint: HASH['1455'], date: null } },
    parts: [
      { name: 'Disposizioni sulla legge in generale', fingerprints: { '1': { fingerprint: 'f'.repeat(64), date: null } } },
      { name: 'CODICE CIVILE', fingerprints: { '1453': { fingerprint: HASH['1453'], date: null }, '1455': { fingerprint: HASH['1455'], date: null } } },
    ],
    count: 3,
  }]);
  nock(API).post('/fetch_tree').times(200).reply(() => [200, { articles: [{ allegato: '1', numero: '1' }, { allegato: '2', numero: '1453' }, { allegato: '2', numero: '1455' }] }]);
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
