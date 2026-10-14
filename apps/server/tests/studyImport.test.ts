import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { app, authHeader, createSharedEnv, createTestUser, prisma, request, type TestUser } from './helpers';
import { prisma as appPrisma } from '../src/lib/prisma';

// Content becomes study dossiers in one request (spec docs/superpowers/specs/2026-10-13-environments-into-forum-design.md,
// D8–D9, D11–D12): a Forum download, an archived environment recovered, a pack or an old link.

const NORM = { tipo_atto: 'codice civile', numero_articolo: '2043' };
const COST = { corte: 'corte_costituzionale', numero: 1, anno: 2014, tipo: 'sentenza', data_deposito: '2014-01-13' };
const COST_LABEL = 'Corte cost., sent. 13 gennaio 2014, n. 1';
const NORM_KEY = 'codice-civile--2043';
const DECISION_KEY = 'corte_costituzionale:2014:1';
// Root rule 23: the text, the anchor and the offset arrive as they left.
const NOTE_TEXT = 'Vedi anche \r\n';
const ANCHOR = 'Qualunque fatto doloso ';

function publication() {
  return {
    dossiers: [{
      title: 'Responsabilità',
      items: [
        { id: 'n1', type: 'norma', status: 'important', data: NORM },
        { id: 's1', type: 'sentenza', data: COST },
        { id: 'k1', type: 'note', data: 'sul 2043', aboutItemId: 'n1' },
      ],
    }],
    quickNorms: [],
    annotations: [
      { normaKey: NORM_KEY, articleId: '2043', text: NOTE_TEXT, anchorText: ANCHOR, startOffset: 7 },
      { normaKey: DECISION_KEY, articleId: '', text: 'sulla sentenza' },
    ],
    highlights: [
      { normaKey: NORM_KEY, articleId: '2043', text: ANCHOR, color: 'green', startOffset: 7 },
      { normaKey: NORM_KEY, articleId: '2043', text: 'senza posizione', color: 'yellow' },
    ],
  };
}

describe('«Aggiungi ai miei dossier»: a Forum download', () => {
  let alice: TestUser;
  let bob: TestUser;
  let envId: string;

  beforeEach(async () => {
    alice = await createTestUser('import-alice');
    bob = await createTestUser('import-bob');
    const res = await request(app).post('/api/shared-environments').set(authHeader(alice))
      .send({ title: 'Responsabilità', category: 'civil', content: publication() });
    expect(res.status).toBe(201);
    envId = res.body.id;
  });

  afterEach(() => vi.restoreAllMocks());

  const download = (user: TestUser, body: object = { addNotes: true, addHighlights: true }) =>
    request(app).post(`/api/shared-environments/${envId}/download`).set(authHeader(user)).send(body);

  it('makes a dossier di studio, credited to the publisher, with its entries as the web writes them', async () => {
    const res = await download(bob);
    expect(res.status).toBe(201);
    expect(res.body.dossiers).toHaveLength(1);
    const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: res.body.dossiers[0].id }, include: { items: { orderBy: { position: 'asc' } } } });
    expect(dossier).toMatchObject({ userId: bob.id, name: 'Responsabilità', kind: 'studio', originalAuthorId: alice.id });
    expect(dossier.items.map((i) => [i.itemType, i.title])).toEqual([['norm', 'codice civile'], ['sentenza', COST_LABEL], ['note', 'Nota']]);
    expect(dossier.items[0].content).toEqual({ ...NORM, _dossierMeta: { important: true } });
    expect(dossier.items[1].content).toEqual({ ...COST, etichetta: COST_LABEL });
    expect(dossier.items[2].aboutItemId).toBe(dossier.items[0].id);
    // It reads back through the dossier routes, citations included.
    const read = await request(app).get(`/api/dossiers/${dossier.id}`).set(authHeader(bob));
    expect(read.body.kind).toBe('studio');
    expect(read.body.items[1].citation).toBe(COST_LABEL);
  });

  it('adds the notes and highlights under the keys the web reads, credited to the publisher, text unchanged', async () => {
    const res = await download(bob);
    expect(res.body.notes).toEqual({ added: 2, skipped: 0 });
    // The highlight without a position cannot be anchored: skipped and counted.
    expect(res.body.highlights).toEqual({ added: 1, skipped: 1 });
    const notes = await prisma.annotation.findMany({ where: { userId: bob.id }, orderBy: { content: 'asc' } });
    expect(notes.map((n) => [n.normaKey, n.content, n.textContext, n.position, n.originalAuthorId])).toEqual([
      [`${NORM_KEY}::art::2043`, NOTE_TEXT, ANCHOR, 7, alice.id],
      [`${DECISION_KEY}::art::`, 'sulla sentenza', null, null, alice.id],
    ]);
    const [mark] = await prisma.highlight.findMany({ where: { userId: bob.id } });
    expect(mark).toMatchObject({ normaKey: `${NORM_KEY}::art::2043`, text: ANCHOR, color: 'green', startOffset: 7, endOffset: 7 + ANCHOR.length, originalAuthorId: alice.id });
  });

  it('skips on a second download the notes and highlights the user already has, never the dossier', async () => {
    await download(bob);
    const again = await download(bob);
    expect(again.status).toBe(201);
    expect(again.body.notes).toEqual({ added: 0, skipped: 2 });
    expect(again.body.highlights).toEqual({ added: 0, skipped: 2 });
    expect(await prisma.dossier.count({ where: { userId: bob.id } })).toBe(2);
    expect(await prisma.annotation.count({ where: { userId: bob.id } })).toBe(2);
    expect((await prisma.sharedEnvironment.findUniqueOrThrow({ where: { id: envId } })).downloadCount).toBe(2);
  });

  it('brings no notes or highlights when the switches are off, or when the publisher left them out', async () => {
    const off = await download(bob, { addNotes: false, addHighlights: false });
    expect(off.body.notes.added + off.body.highlights.added).toBe(0);
    await prisma.sharedEnvironment.update({ where: { id: envId }, data: { includeNotes: false } });
    const excluded = await download(bob);
    expect(excluded.body.notes.added).toBe(0);
    expect(excluded.body.highlights.added).toBe(1);
  });

  it('is one\'s own work on one\'s own item: no credit, no download counted', async () => {
    const res = await download(alice);
    expect(res.status).toBe(201);
    const dossier = await prisma.dossier.findFirstOrThrow({ where: { userId: alice.id, kind: 'studio' } });
    expect(dossier.originalAuthorId).toBeNull();
    expect((await prisma.sharedEnvironment.findUniqueOrThrow({ where: { id: envId } })).downloadCount).toBe(0);
  });

  it('still answers an older client with the content', async () => {
    const res = await request(app).post(`/api/shared-environments/${envId}/download`).set(authHeader(bob));
    expect(res.status).toBe(200);
    expect(res.body.content.dossiers[0].title).toBe('Responsabilità');
    expect(await prisma.dossier.count({ where: { userId: bob.id } })).toBe(0);
  });

  it('writes nothing at all when the database refuses one row', async () => {
    const original = appPrisma.$transaction.bind(appPrisma) as (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => Promise<unknown>;
    vi.spyOn(appPrisma, '$transaction').mockImplementationOnce(((fn: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
      original(async (tx) => fn(new Proxy(tx, {
        get: (target, key) => (key === 'highlight'
          ? { createMany: async () => { throw new Error('refused by the database'); } }
          : Reflect.get(target, key)),
      })))) as never);
    const res = await download(bob);
    expect(res.status).toBe(500);
    expect(await prisma.dossier.count({ where: { userId: bob.id } })).toBe(0);
    expect(await prisma.annotation.count({ where: { userId: bob.id } })).toBe(0);
  });

  it('skips and counts what a legacy item carries that cannot be read, and merges its quick norms and aliases', async () => {
    await prisma.quickNorm.create({ data: { userId: bob.id, label: 'Art. 2043', searchParams: { act_type: 'codice civile' } } });
    await prisma.customAlias.create({ data: { userId: bob.id, trigger: 'cc', aliasType: 'shortcut', expandTo: 'codice civile' } });
    const legacy = await prisma.sharedEnvironment.create({
      data: {
        title: 'Vecchio', category: 'civil', tags: [], userId: alice.id,
        content: {
          dossiers: [{ title: 'Vecchio', items: [{ type: 'norma', data: NORM }, { type: 'norma', data: { tipo_atto: 'premi Accept', numero_articolo: '1' } }] }],
          quickNorms: [
            { label: 'art. 2043', searchParams: { act_type: 'codice civile', article: '2043' } },
            { label: 'Art. 1218', searchParams: { act_type: 'codice civile', article: '1218' } },
          ],
          customAliases: [{ trigger: 'cc', type: 'shortcut', expandTo: 'codice civile' }, { trigger: 'cp', type: 'shortcut', expandTo: 'codice penale' }],
          annotations: [], highlights: [],
        } as object,
      },
    });
    const res = await request(app).post(`/api/shared-environments/${legacy.id}/download`).set(authHeader(bob)).send({ addNotes: true, addHighlights: true });
    expect(res.status).toBe(201);
    expect(res.body.refused).toBe(1);
    expect(res.body.dossiers[0].entries).toBe(1);
    expect(res.body.quickNorms).toEqual({ added: 1, skipped: 1 });
    expect(res.body.aliases).toEqual({ added: 1, skipped: 1 });
    expect((await prisma.customAlias.findFirstOrThrow({ where: { userId: bob.id, trigger: 'cp' } })).originalAuthorId).toBe(alice.id);
  });

  it('is refused on a withdrawn item, as every other route', async () => {
    await request(app).post(`/api/shared-environments/${envId}/withdraw`).set(authHeader(alice));
    expect((await download(bob)).status).toBe(404);
  });
});

describe('«Recupera i dossier» from an archived environment', () => {
  it('makes study dossiers of its dossiers, its own notes uncredited, and leaves the environment as it is', async () => {
    const carla = await createTestUser('recover-carla');
    const dan = await createTestUser('recover-dan');
    const content = {
      dossiers: [{ id: 'x', title: 'Archivio', createdAt: '2026-01-01', items: [{ id: 'i1', type: 'norma', addedAt: '2026-01-01', data: NORM }] }],
      quickNorms: [{ id: 'q', label: 'Art. 1', searchParams: { act_type: 'legge' }, createdAt: '2026-01-01', usageCount: 3 }],
      customAliases: [],
      annotations: [{ id: 'a', normaKey: NORM_KEY, articleId: '2043', text: 'mia', createdAt: '2026-01-01' }],
      highlights: [],
    };
    const env = await prisma.environment.create({ data: { userId: carla.id, name: 'Vecchio ambiente', content } });
    expect((await request(app).post(`/api/environments/${env.id}/recover`).set(authHeader(dan)).send({})).status).toBe(404);

    const res = await request(app).post(`/api/environments/${env.id}/recover`).set(authHeader(carla)).send({});
    expect(res.status).toBe(201);
    expect(res.body.dossiers).toEqual([expect.objectContaining({ name: 'Archivio', entries: 1 })]);
    expect(res.body.notes).toEqual({ added: 1, skipped: 0 });
    const dossier = await prisma.dossier.findFirstOrThrow({ where: { userId: carla.id } });
    expect(dossier).toMatchObject({ kind: 'studio', originalAuthorId: null });
    expect(await prisma.quickNorm.count({ where: { userId: carla.id } })).toBe(0);
    expect((await prisma.environment.findUniqueOrThrow({ where: { id: env.id } })).content).toEqual(content);
  });
});

describe('study dossiers from a pack or an old link', () => {
  let erin: TestUser;
  beforeEach(async () => {
    erin = await createTestUser('pack-erin');
  });
  const importStudy = (body: object) => request(app).post('/api/dossiers/import-study').set(authHeader(erin)).send(body);

  it('makes each dossier of the content a dossier di studio', async () => {
    const res = await importStudy({ content: { dossiers: [
      { title: 'GDPR: diritti', items: [{ type: 'norma', data: { tipo_atto: 'regolamento ue', numero_atto: '679', data: '2016-04-27', numero_articolo: '15' } }] },
      { title: 'GDPR: articoli chiave', items: [] },
    ] } });
    expect(res.status).toBe(201);
    expect(res.body.dossiers.map((d: { name: string }) => d.name)).toEqual(['GDPR: diritti', 'GDPR: articoli chiave']);
    expect(await prisma.dossier.count({ where: { userId: erin.id, kind: 'studio' } })).toBe(2);
  });

  it('refuses content with no readable dossier, and a NUL anywhere it would be stored', async () => {
    expect((await importStudy({ content: { dossiers: [] } })).status).toBe(400);
    const nul = await importStudy({ content: { dossiers: [{ title: 'a\u0000b', items: [] }] } });
    expect(nul.status).toBe(400);
    const nulTag = await importStudy({ content: { dossiers: [{ title: 'ok', tags: ['a\u0000', 'buona'], items: [] }] } });
    expect(nulTag.status).toBe(201);
    expect((await prisma.dossier.findFirstOrThrow({ where: { userId: erin.id } })).tags).toEqual(['buona']);
  });

  it('refuses content over one megabyte', async () => {
    const big = await importStudy({ content: { dossiers: [{ title: 'x', description: 'y'.repeat(1024 * 1024), items: [] }] } });
    expect(big.status).toBe(400);
    expect(big.body.detail).toMatch(/1 MB/);
  });

  it('allows thirty imports an hour, then says so in Italian', async () => {
    const body = { content: { dossiers: [{ title: 'x', items: [] }] } };
    for (let i = 0; i < 30; i++) expect((await importStudy(body)).status).toBe(201);
    const over = await importStudy(body);
    expect(over.status).toBe(429);
    expect(over.body.detail).toMatch(/riprova più tardi/);
  });
});

describe('the take of a suggested note on a decision', () => {
  it('stores it under the decision\'s key, where the web reads it', async () => {
    const owner = await createTestUser('take-owner');
    const proposer = await createTestUser('take-proposer');
    const envId = (await createSharedEnv(owner)).id;
    const created = await request(app).post(`/api/shared-environments/${envId}/suggestions`).set(authHeader(proposer))
      .send({ items: [
        { itemType: 'annotation', payload: { normaKey: DECISION_KEY, articleId: '', text: 'nota sulla sentenza' } },
        { itemType: 'highlight', payload: { normaKey: NORM_KEY, articleId: '2043', anchorText: ANCHOR, colorVar: 'red', startOffset: 3 } },
      ] });
    expect(created.status).toBe(201);
    for (const item of created.body.items) {
      const take = await request(app).post(`/api/shared-environments-suggestions/${created.body.id}/items/${item.id}/take`).set(authHeader(owner));
      expect(take.status).toBe(200);
    }
    const note = await prisma.annotation.findFirstOrThrow({ where: { userId: owner.id } });
    expect(note.normaKey).toBe(`${DECISION_KEY}::art::`);
    const mark = await prisma.highlight.findFirstOrThrow({ where: { userId: owner.id } });
    expect(mark).toMatchObject({ normaKey: `${NORM_KEY}::art::2043`, startOffset: 3, endOffset: 3 + ANCHOR.length });
  });

  it('refuses a suggested highlight with no position, instead of marking the article\'s first characters', async () => {
    const owner = await createTestUser('take-owner2');
    const proposer = await createTestUser('take-proposer2');
    const envId = (await createSharedEnv(owner)).id;
    const created = await request(app).post(`/api/shared-environments/${envId}/suggestions`).set(authHeader(proposer))
      .send({ items: [{ itemType: 'highlight', payload: { normaKey: NORM_KEY, articleId: '2043', anchorText: ANCHOR, colorVar: 'red' } }] });
    const take = await request(app).post(`/api/shared-environments-suggestions/${created.body.id}/items/${created.body.items[0].id}/take`).set(authHeader(owner));
    expect(take.status).toBe(400);
    expect(await prisma.highlight.count({ where: { userId: owner.id } })).toBe(0);
  });
});

describe('the admin\'s withdrawal of a copy whose dossier is in the trash', () => {
  it('blocks the dossier when it comes back from the trash (question 190)', async () => {
    const author = await createTestUser('trash-author');
    const admin = await createTestUser('trash-admin');
    await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: true } });
    const dossierId = (await request(app).post('/api/dossiers').set(authHeader(author)).send({ name: 'Privato' })).body.id;
    const published = await request(app).post('/api/shared-environments').set(authHeader(author)).send({
      title: 'Pubblico', category: 'civil', sourceDossierId: dossierId,
      content: { dossiers: [{ title: 'x', items: [{ type: 'norma', data: NORM }] }], quickNorms: [], annotations: [], highlights: [] },
    });
    expect(published.status).toBe(201);
    const trashId = (await request(app).delete(`/api/dossiers/${dossierId}`).set(authHeader(author))).body.trashId;
    expect((await request(app).post(`/api/admin/shared-environments/${published.body.id}/withdraw`).set(authHeader(admin))).status).toBe(200);
    await request(app).post(`/api/trash/${trashId}/restore`).set(authHeader(author)).send({});
    expect((await request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(author))).body.forum_blocked).toBe(true);
    await request(app).delete(`/api/shared-environments/${published.body.id}`).set(authHeader(author));
    const again = await request(app).post('/api/shared-environments').set(authHeader(author)).send({
      title: 'Pubblico', category: 'civil', sourceDossierId: dossierId,
      content: { dossiers: [{ title: 'x', items: [] }], quickNorms: [], annotations: [], highlights: [] },
    });
    expect(again.status).toBe(403);
  });

  it('comes back unblocked when the admin republished the copy meanwhile', async () => {
    const author = await createTestUser('trash-author2');
    const admin = await createTestUser('trash-admin2');
    await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: true } });
    const dossierId = (await request(app).post('/api/dossiers').set(authHeader(author)).send({ name: 'Privato' })).body.id;
    const published = await request(app).post('/api/shared-environments').set(authHeader(author)).send({
      title: 'Pubblico', category: 'civil', sourceDossierId: dossierId,
      content: { dossiers: [{ title: 'x', items: [] }], quickNorms: [], annotations: [], highlights: [] },
    });
    const trashId = (await request(app).delete(`/api/dossiers/${dossierId}`).set(authHeader(author))).body.trashId;
    await request(app).post(`/api/admin/shared-environments/${published.body.id}/withdraw`).set(authHeader(admin));
    await request(app).post(`/api/admin/shared-environments/${published.body.id}/republish`).set(authHeader(admin));
    await request(app).post(`/api/trash/${trashId}/restore`).set(authHeader(author)).send({});
    expect((await request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(author))).body.forum_blocked).toBe(false);
  });

  it('is lifted by the admin also while the dossier is in the trash', async () => {
    const author = await createTestUser('trash-author3');
    const admin = await createTestUser('trash-admin3');
    await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: true } });
    const dossierId = (await request(app).post('/api/dossiers').set(authHeader(author)).send({ name: 'Privato' })).body.id;
    const published = await request(app).post('/api/shared-environments').set(authHeader(author)).send({
      title: 'Pubblico', category: 'civil', sourceDossierId: dossierId,
      content: { dossiers: [{ title: 'x', items: [] }], quickNorms: [], annotations: [], highlights: [] },
    });
    await request(app).post(`/api/admin/shared-environments/${published.body.id}/withdraw`).set(authHeader(admin));
    const trashId = (await request(app).delete(`/api/dossiers/${dossierId}`).set(authHeader(author))).body.trashId;
    expect((await request(app).delete(`/api/admin/forum-blocks/${dossierId}`).set(authHeader(admin))).status).toBe(204);
    await request(app).post(`/api/trash/${trashId}/restore`).set(authHeader(author)).send({});
    expect((await request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(author))).body.forum_blocked).toBe(false);
  });
});
