import { beforeEach, describe, expect, it } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from './helpers';
import { exchangeCode, startAuthorization, tokenExchange } from './oauth/oauthHelpers';
import { spendDelegatedCounter } from '../src/middleware/delegated';
import { deleteUserAccount } from '../src/lingo/deleteUserAccount';
import { findDelegatedRoute } from '../src/oauth/delegatedRoutes';
import { sweepExpiredTrash } from '../src/trash/trash';

// The trash (MCP second round, spec §4.3): what a connected application
// deletes goes there for 30 days, and only the user's session restores it.

const LAW = { tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31', urn: 'urn:nir:stato:legge:2012-12-31;247' };
const law = (article: string) => ({ ...LAW, numero_articolo: article, urn: `${LAW.urn}~art${article}` });

/** A connection with deletion on, and an API token for `scope`. */
async function connected(user: TestUser, scope = 'content:delete') {
  const flow = await startAuthorization({ scope: 'dossier:read dossier:write' });
  const auth = authHeader(user);
  await request(app).get(`/api/oauth/requests/${flow.requestId}`).set(auth);
  const decision = await request(app)
    .post(`/api/oauth/requests/${flow.requestId}/decision`)
    .set(auth)
    .send({ approve: true, allowDelete: true });
  const code = new URL(decision.body.redirectTo).searchParams.get('code')!;
  const access = (await exchangeCode(flow.clientId, code, flow.verifier)).body.access_token as string;
  const exchanged = await tokenExchange(access, { scope });
  if (exchanged.status !== 200) throw new Error(`exchange failed: ${JSON.stringify(exchanged.body)}`);
  const grant = await prisma.oAuthGrant.findFirstOrThrow({ where: { userId: user.id, clientId: flow.clientId } });
  return { bearer: { Authorization: `Bearer ${exchanged.body.access_token}` }, grant };
}

describe('the trash', () => {
  let alice: TestUser;
  let dossierId: string;
  let art3: string;
  let art25: string;
  let noteId: string;

  const addItem = async (id: string, body: object) =>
    (await request(app).post(`/api/dossiers/${id}/items`).set(authHeader(alice)).send(body)).body.id as string;

  beforeEach(async () => {
    alice = await createTestUser('trash-alice');
    dossierId = (await request(app).post('/api/dossiers').set(authHeader(alice)).send({ name: 'Prova' })).body.id;
    art3 = await addItem(dossierId, { itemType: 'norm', title: 'legge', content: law('3') });
    art25 = await addItem(dossierId, { itemType: 'norm', title: 'legge', content: law('25') });
    noteId = (
      await request(app).post(`/api/dossiers/${dossierId}/notes`).set(authHeader(alice)).send({ text: 'Sul punto 3.', aboutItemId: art3 })
    ).body.id;
    await request(app).post(`/api/dossiers/${dossierId}/snapshots`).set(authHeader(alice)).send({ label: 'v1' });
  });

  it('moves a whole dossier, with its entries and snapshots, into one entry', async () => {
    const { bearer } = await connected(alice);
    const moved = await request(app).post(`/api/dossiers/${dossierId}/trash`).set(bearer).send({ itemIds: [art3, art25, noteId] });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ itemCount: 3 });
    expect(await prisma.dossier.count({ where: { id: dossierId } })).toBe(0);
    const list = await request(app).get('/api/trash').set(authHeader(alice));
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ kind: 'DOSSIER', dossierId, label: 'Prova', itemCount: 3, clientName: 'Claude Code', byApplication: true });
    expect(new Date(list.body[0].expiresAt).getTime() - new Date(list.body[0].deletedAt).getTime()).toBe(30 * 24 * 3600 * 1000);
  });

  it('moves a whole dossier only if it still holds exactly the entries the user saw (security review of PR 4: TOCTOU)', async () => {
    const { bearer } = await connected(alice);
    // An entry added while the user was reading the confirmation dialog.
    const late = await addItem(dossierId, { itemType: 'norm', title: 'legge', content: law('9') });
    const refused = await request(app).post(`/api/dossiers/${dossierId}/trash`).set(bearer).send({ itemIds: [art3, art25, noteId] });
    expect(refused.status).toBe(409);
    expect(refused.body.detail).toBe('Il dossier è cambiato dopo la conferma: nulla è stato eliminato.');
    expect(await prisma.dossierItem.count({ where: { dossierId } })).toBe(4);
    expect(await prisma.trashEntry.count()).toBe(0);
    expect((await request(app).post(`/api/dossiers/${dossierId}/trash`).set(bearer).send({})).status).toBe(400);
    const moved = await request(app).post(`/api/dossiers/${dossierId}/trash`).set(bearer).send({ itemIds: [late, noteId, art25, art3] });
    expect(moved.status).toBe(200);
  });

  it('moves exactly the entries given, and reports the ids that are not in this dossier', async () => {
    const other = (await request(app).post('/api/dossiers').set(authHeader(alice)).send({ name: 'Altro' })).body.id;
    const elsewhere = await addItem(other, { itemType: 'norm', title: 'legge', content: law('9') });
    const { bearer } = await connected(alice);
    const moved = await request(app)
      .post(`/api/dossiers/${dossierId}/trash-items`)
      .set(bearer)
      .send({ itemIds: [art3, art25, elsewhere] });
    expect(moved.status).toBe(200);
    expect(moved.body.moved.sort()).toEqual([art3, art25].sort());
    expect(moved.body.notFound).toEqual([elsewhere]);
    expect(await prisma.dossierItem.count({ where: { id: elsewhere } })).toBe(1);
    expect(await prisma.dossierItem.count({ where: { dossierId } })).toBe(1);
  });

  it('nothing to move is a 404 and writes no trash entry', async () => {
    const { bearer } = await connected(alice);
    const response = await request(app)
      .post(`/api/dossiers/${dossierId}/trash-items`)
      .set(bearer)
      .send({ itemIds: ['00000000-0000-4000-8000-000000000000'] });
    expect(response.status).toBe(404);
    expect(await prisma.trashEntry.count()).toBe(0);
  });

  it('takes 1 to 50 ids', async () => {
    const { bearer } = await connected(alice);
    expect((await request(app).post(`/api/dossiers/${dossierId}/trash-items`).set(bearer).send({ itemIds: [] })).status).toBe(400);
    const many = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    expect((await request(app).post(`/api/dossiers/${dossierId}/trash-items`).set(bearer).send({ itemIds: many })).status).toBe(400);
  });

  it('lists entries with each citation and the act alone, notes with nulls, newest first', async () => {
    const { bearer } = await connected(alice);
    await request(app).post(`/api/dossiers/${dossierId}/trash-items`).set(bearer).send({ itemIds: [art3, noteId] });
    await request(app).post(`/api/dossiers/${dossierId}/trash-items`).set(bearer).send({ itemIds: [art25] });
    const list = (await request(app).get('/api/trash').set(authHeader(alice))).body;
    expect(list.map((e: { itemCount: number }) => e.itemCount)).toEqual([1, 2]);
    expect(list[1]).toMatchObject({ kind: 'DOSSIER_ITEMS', dossierId, label: 'Prova' });
    expect(list[1].items).toEqual([
      { itemType: 'norm', citation: 'art. 3, l. 31 dicembre 2012, n. 247', actCitation: 'l. 31 dicembre 2012, n. 247' },
      { itemType: 'note', citation: null, actCitation: null },
    ]);
    expect(JSON.stringify(list)).not.toContain('payload');
  });

  it('restores a dossier with the same ids for the dossier, its entries and its snapshots', async () => {
    const { bearer } = await connected(alice);
    const before = await prisma.dossierSnapshot.findMany({ where: { dossierId } });
    await request(app).post(`/api/dossiers/${dossierId}/trash`).set(bearer).send({ itemIds: [art3, art25, noteId] });
    const [entry] = (await request(app).get('/api/trash').set(authHeader(alice))).body;
    const restored = await request(app).post(`/api/trash/${entry.id}/restore`).set(authHeader(alice)).send({});
    expect(restored.status).toBe(200);
    expect(restored.body).toEqual({ dossierId });
    const read = await request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(alice));
    expect(read.body.items.map((i: { id: string }) => i.id)).toEqual([art3, art25, noteId]);
    expect(read.body.items[2].about_item_id).toBe(art3);
    expect((await prisma.dossierSnapshot.findMany({ where: { dossierId } })).map((s) => s.id)).toEqual(before.map((s) => s.id));
    expect(await prisma.trashEntry.count()).toBe(0);
  });

  it('restores every column of the dossier, its entries and its snapshots (review of PR 3, I1)', async () => {
    const author = await createTestUser('trash-author');
    await prisma.dossier.update({ where: { id: dossierId }, data: { originalAuthorId: author.id, description: 'd', color: 'blue', tags: ['a'], isPinned: true } });
    const strip = <T extends { updatedAt?: unknown }>(row: T) => {
      const { updatedAt: _ignored, ...rest } = row;
      return rest;
    };
    const before = {
      dossier: strip(await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })),
      items: await prisma.dossierItem.findMany({ where: { dossierId }, orderBy: { position: 'asc' } }),
      snapshots: await prisma.dossierSnapshot.findMany({ where: { dossierId } }),
    };
    const { bearer } = await connected(alice);
    await request(app).post(`/api/dossiers/${dossierId}/trash`).set(bearer).send({ itemIds: [art3, art25, noteId] });
    const [entry] = (await request(app).get('/api/trash').set(authHeader(alice))).body;
    expect((await request(app).post(`/api/trash/${entry.id}/restore`).set(authHeader(alice)).send({})).status).toBe(200);
    expect(strip(await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } }))).toEqual(before.dossier);
    expect(await prisma.dossierItem.findMany({ where: { dossierId }, orderBy: { position: 'asc' } })).toEqual(before.items);
    expect(await prisma.dossierSnapshot.findMany({ where: { dossierId } })).toEqual(before.snapshots);
  });

  it('restores a dossier whose original author has since gone, without the attribution', async () => {
    const author = await createTestUser('trash-gone-author');
    await prisma.dossier.update({ where: { id: dossierId }, data: { originalAuthorId: author.id } });
    const { bearer } = await connected(alice);
    await request(app).post(`/api/dossiers/${dossierId}/trash`).set(bearer).send({ itemIds: [art3, art25, noteId] });
    await prisma.user.delete({ where: { id: author.id } });
    const [entry] = (await request(app).get('/api/trash').set(authHeader(alice))).body;
    expect((await request(app).post(`/api/trash/${entry.id}/restore`).set(authHeader(alice)).send({})).status).toBe(200);
    expect((await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).originalAuthorId).toBeNull();
  });

  it('restores entries after the last entry, in their original order, once', async () => {
    const { bearer } = await connected(alice);
    await request(app).post(`/api/dossiers/${dossierId}/trash-items`).set(bearer).send({ itemIds: [art25, art3] });
    const added = await addItem(dossierId, { itemType: 'norm', title: 'legge', content: law('7') });
    const [entry] = (await request(app).get('/api/trash').set(authHeader(alice))).body;
    expect((await request(app).post(`/api/trash/${entry.id}/restore`).set(authHeader(alice)).send({})).status).toBe(200);
    const items = (await request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(alice))).body.items;
    expect(items.map((i: { id: string }) => i.id)).toEqual([noteId, added, art3, art25]);
    expect((await request(app).post(`/api/trash/${entry.id}/restore`).set(authHeader(alice)).send({})).status).toBe(404);
  });

  it('restoring entries whose dossier is gone asks where; lands in one of the user\'s dossiers', async () => {
    const { bearer } = await connected(alice);
    await request(app).post(`/api/dossiers/${dossierId}/trash-items`).set(bearer).send({ itemIds: [art3] });
    await request(app).delete(`/api/dossiers/${dossierId}`).set(authHeader(alice));
    const [entry] = (await request(app).get('/api/trash').set(authHeader(alice))).body;
    const asked = await request(app).post(`/api/trash/${entry.id}/restore`).set(authHeader(alice)).send({});
    expect(asked.status).toBe(409);
    expect(asked.body.detail).toBe('Il dossier non esiste più: scegli dove ripristinare.');
    const bob = await createTestUser('trash-bob');
    const bobs = (await request(app).post('/api/dossiers').set(authHeader(bob)).send({ name: 'Di Bob' })).body.id;
    expect((await request(app).post(`/api/trash/${entry.id}/restore`).set(authHeader(alice)).send({ targetDossierId: bobs })).status).toBe(404);
    const target = (await request(app).post('/api/dossiers').set(authHeader(alice)).send({ name: 'Nuovo' })).body.id;
    const restored = await request(app).post(`/api/trash/${entry.id}/restore`).set(authHeader(alice)).send({ targetDossierId: target });
    expect(restored.status).toBe(200);
    expect(restored.body).toEqual({ dossierId: target });
    expect(await prisma.dossierItem.findUniqueOrThrow({ where: { id: art3 } })).toMatchObject({ dossierId: target });
  });

  it('a note about a trashed article stays, and is about it again once it is restored', async () => {
    const { bearer } = await connected(alice);
    await request(app).post(`/api/dossiers/${dossierId}/trash-items`).set(bearer).send({ itemIds: [art3] });
    const read = (await request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(alice))).body;
    expect(read.items.find((i: { id: string }) => i.id === noteId)?.about_item_id).toBe(art3);
    const [entry] = (await request(app).get('/api/trash').set(authHeader(alice))).body;
    await request(app).post(`/api/trash/${entry.id}/restore`).set(authHeader(alice)).send({});
    const again = (await request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(alice))).body;
    expect(again.items.map((i: { id: string }) => i.id)).toContain(art3);
  });

  it("purges an entry; another user's entry is a 404 for list, restore and purge", async () => {
    const { bearer } = await connected(alice);
    await request(app).post(`/api/dossiers/${dossierId}/trash-items`).set(bearer).send({ itemIds: [art3] });
    const [entry] = (await request(app).get('/api/trash').set(authHeader(alice))).body;
    const bob = await createTestUser('trash-bob2');
    expect((await request(app).get('/api/trash').set(authHeader(bob))).body).toEqual([]);
    expect((await request(app).post(`/api/trash/${entry.id}/restore`).set(authHeader(bob)).send({})).status).toBe(404);
    expect((await request(app).delete(`/api/trash/${entry.id}`).set(authHeader(bob))).status).toBe(404);
    expect((await request(app).delete(`/api/trash/${entry.id}`).set(authHeader(alice))).status).toBe(204);
    expect(await prisma.trashEntry.count()).toBe(0);
  });

  it('the sweep removes expired entries only', async () => {
    const { bearer } = await connected(alice);
    await request(app).post(`/api/dossiers/${dossierId}/trash-items`).set(bearer).send({ itemIds: [art3] });
    await request(app).post(`/api/dossiers/${dossierId}/trash-items`).set(bearer).send({ itemIds: [art25] });
    const [newest] = await prisma.trashEntry.findMany({ orderBy: { deletedAt: 'desc' }, take: 1 });
    await prisma.trashEntry.update({ where: { id: newest.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await sweepExpiredTrash(new Date())).toBe(1);
    expect(await prisma.trashEntry.count()).toBe(1);
  });

  it('goes with the account', async () => {
    const { bearer } = await connected(alice);
    await request(app).post(`/api/dossiers/${dossierId}/trash`).set(bearer).send({ itemIds: [art3, art25, noteId] });
    await deleteUserAccount(alice.id);
    expect(await prisma.trashEntry.count()).toBe(0);
  });

  it('stays restorable after the connection that deleted is revoked', async () => {
    const { bearer, grant } = await connected(alice);
    await request(app).post(`/api/dossiers/${dossierId}/trash-items`).set(bearer).send({ itemIds: [art3] });
    expect((await request(app).delete(`/api/oauth/grants/${grant.id}`).set(authHeader(alice))).status).toBe(204);
    const [entry] = (await request(app).get('/api/trash').set(authHeader(alice))).body;
    expect((await request(app).post(`/api/trash/${entry.id}/restore`).set(authHeader(alice)).send({})).status).toBe(200);
  });

  it('a connected application can neither list, restore nor purge; a user session cannot use the moving routes', async () => {
    const { bearer } = await connected(alice);
    await request(app).post(`/api/dossiers/${dossierId}/trash-items`).set(bearer).send({ itemIds: [art3] });
    const entry = await prisma.trashEntry.findFirstOrThrow();
    expect((await request(app).get('/api/trash').set(bearer)).status).toBe(403);
    expect((await request(app).post(`/api/trash/${entry.id}/restore`).set(bearer).send({})).status).toBe(403);
    expect((await request(app).delete(`/api/trash/${entry.id}`).set(bearer)).status).toBe(403);
    expect((await request(app).post(`/api/dossiers/${dossierId}/trash`).set(authHeader(alice)).send({ itemIds: [] })).status).toBe(403);
    expect((await request(app).post(`/api/dossiers/${dossierId}/trash-items`).set(authHeader(alice)).send({ itemIds: [art25] })).status).toBe(403);
  });

  it('no route reachable by an exchanged token deletes for good', () => {
    expect(findDelegatedRoute('DELETE', `/dossiers/${dossierId}`)).toBeUndefined();
    expect(findDelegatedRoute('DELETE', `/dossiers/${dossierId}/items/${art3}`)).toBeUndefined();
    expect(findDelegatedRoute('DELETE', '/trash/x')).toBeUndefined();
  });

  it("another user's dossier is a 404 for both moving routes, and nothing moves (security review of PR 3)", async () => {
    const bob = await createTestUser('trash-bob3');
    const { bearer } = await connected(bob);
    expect((await request(app).post(`/api/dossiers/${dossierId}/trash`).set(bearer).send({ itemIds: [] })).status).toBe(404);
    expect((await request(app).post(`/api/dossiers/${dossierId}/trash-items`).set(bearer).send({ itemIds: [art3] })).status).toBe(404);
    expect(await prisma.dossierItem.count({ where: { dossierId } })).toBe(3);
    expect(await prisma.trashEntry.count()).toBe(0);
  });

  it('a connection that cannot read the dossiers cannot delete them either (security review, S1)', async () => {
    const { bearer, grant } = await connected(alice);
    await prisma.oAuthGrant.update({ where: { id: grant.id }, data: { scopes: ['dossier:write', 'content:delete'] } });
    const refused = await request(app).post(`/api/dossiers/${dossierId}/trash-items`).set(bearer).send({ itemIds: [art3] });
    expect(refused.status).toBe(403);
    expect(await prisma.dossierItem.count({ where: { id: art3 } })).toBe(1);
  });

  it('a note restored with its article into another dossier stays about it (security review, S4)', async () => {
    const { bearer } = await connected(alice);
    await request(app).post(`/api/dossiers/${dossierId}/trash-items`).set(bearer).send({ itemIds: [art3, noteId] });
    await request(app).delete(`/api/dossiers/${dossierId}`).set(authHeader(alice));
    const target = (await request(app).post('/api/dossiers').set(authHeader(alice)).send({ name: 'Nuovo' })).body.id;
    const [entry] = (await request(app).get('/api/trash').set(authHeader(alice))).body;
    await request(app).post(`/api/trash/${entry.id}/restore`).set(authHeader(alice)).send({ targetDossierId: target });
    expect((await prisma.dossierItem.findUniqueOrThrow({ where: { id: noteId } })).aboutItemId).toBe(art3);
  });

  it('needs content:delete, read live from the grant', async () => {
    const write = await connected(alice, 'dossier:write');
    expect((await request(app).post(`/api/dossiers/${dossierId}/trash-items`).set(write.bearer).send({ itemIds: [art3] })).status).toBe(403);
    const { bearer, grant } = await connected(alice);
    await prisma.oAuthGrant.update({ where: { id: grant.id }, data: { scopes: ['dossier:read', 'dossier:write'] } });
    const refused = await request(app).post(`/api/dossiers/${dossierId}/trash-items`).set(bearer).send({ itemIds: [art3] });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('insufficient_scope');
    expect(await prisma.dossierItem.count({ where: { id: art3 } })).toBe(1);
  });

  it('the 21st deletion of the day is a 429 with quota trash', async () => {
    const { bearer } = await connected(alice);
    await spendDelegatedCounter(alice.id, 'trash', 20);
    const refused = await request(app).post(`/api/dossiers/${dossierId}/trash-items`).set(bearer).send({ itemIds: [art3] });
    expect(refused.status).toBe(429);
    expect(refused.body.quota).toBe('trash');
  });

  it('a sentenza entry round-trips unchanged, listed by its type and its citation', async () => {
    const sentenza = { corte: 'corte_costituzionale', numero: 1, anno: 2014, tipo: 'sentenza',
      data_deposito: '2014-01-13', etichetta: 'Corte cost., sent. 13 gennaio 2014, n. 1', _dossierMeta: { important: true } };
    const decisionId = await addItem(dossierId, { itemType: 'sentenza', title: 'x', content: sentenza });
    const before = await prisma.dossierItem.findUniqueOrThrow({ where: { id: decisionId } });
    const { bearer } = await connected(alice);
    expect((await request(app).post(`/api/dossiers/${dossierId}/trash-items`).set(bearer).send({ itemIds: [decisionId] })).status).toBe(200);
    const [entry] = (await request(app).get('/api/trash').set(authHeader(alice))).body;
    expect(entry.items).toEqual([{ itemType: 'sentenza', citation: sentenza.etichetta, actCitation: null }]);
    expect((await request(app).post(`/api/trash/${entry.id}/restore`).set(authHeader(alice)).send({})).status).toBe(200);
    const after = await prisma.dossierItem.findUniqueOrThrow({ where: { id: decisionId } });
    expect(after).toMatchObject({ itemType: 'sentenza', title: sentenza.etichetta, content: sentenza, createdAt: before.createdAt });
  });
});
