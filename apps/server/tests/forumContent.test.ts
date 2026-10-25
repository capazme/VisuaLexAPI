import { beforeEach, describe, expect, it } from 'vitest';
import { app, authHeader, createTestUser, prisma, request, type TestUser } from './helpers';

// What a Forum item may hold and answer (spec docs/superpowers/specs/2026-10-13-environments-into-forum-design.md,
// D4, D6, D7): the allow-list on every write and read, publishing from a dossier, withdrawal that hides.

const NORM = { tipo_atto: 'codice civile', numero_articolo: '2043' };
// Root rule 23: a no-break space, a trailing blank and a line break must come back as they went.
const NOTE_TEXT = 'Vedi Cass. 1/2020 \r\n e oltre ';
const ANCHOR = 'Qualunque fatto doloso o colposo ';

const personal = { userId: 'u-1', originalAuthor: { id: 'u-2', username: 'mario' }, sourceSuggestionId: 's-1', bookmarkId: 'b-1', segreto: 'x' };

function richContent() {
  return {
    dossiers: [{
      id: 'private-1', title: 'Rossi c. Bianchi', description: 'pratica', tags: ['cliente'], color: '#fff', isPinned: true,
      createdAt: '2026-10-01T10:00:00.000Z', ...personal,
      items: [
        { id: 'n1', type: 'norma', addedAt: '2026-10-01', data: NORM, createdBy: { clientName: 'Claude' } },
        { id: 'k1', type: 'note', addedAt: '2026-10-01', data: 'sul 2043', aboutItemId: 'n1' },
        { id: 'k2', type: 'note', addedAt: '2026-10-01', data: 'altrove', aboutItemId: 'fuori' },
      ],
    }],
    quickNorms: [{
      id: 'q-old', label: 'Art. 2043', searchParams: { act_type: 'codice civile', article: '2043', tabLabel: 'Pratica Rossi', targetPracticeId: 'p1' },
      sourceUrl: 'https://example.com/tracker', usageCount: 42, lastUsedAt: '2026-10-02', createdAt: '2026-09-01T00:00:00Z', ...personal,
    }],
    customAliases: [{ id: 'c-old', trigger: 'cc', type: 'shortcut', expandTo: 'codice civile', usageCount: 9, ...personal }],
    annotations: [{
      id: 'a-old', normaKey: 'codice-civile--2043', articleId: '2043', text: NOTE_TEXT, anchorText: ANCHOR, startOffset: 12,
      createdAt: '2026-10-01T10:00:00.000Z', color: 'red', ...personal,
    }],
    highlights: [{
      id: 'h-old', normaKey: 'codice-civile--2043', articleId: '2043', text: ANCHOR, color: 'green', startOffset: 12,
      rangeSerialized: 'xpath(/p[1])', note: 'nota privata', ...personal,
    }],
  };
}

const ALLOWED = {
  dossier: ['description', 'id', 'items', 'tags', 'title'],
  annotation: ['anchorText', 'articleId', 'createdAt', 'id', 'normaKey', 'startOffset', 'text'],
  highlight: ['articleId', 'color', 'id', 'normaKey', 'rangeSerialized', 'startOffset', 'text'],
  quickNorm: ['createdAt', 'id', 'label', 'searchParams', 'usageCount'],
  alias: ['expandTo', 'id', 'trigger', 'type', 'usageCount'],
};

function expectFiltered(content: Record<string, Array<Record<string, unknown>>>) {
  const [dossier] = content.dossiers;
  expect(Object.keys(dossier).sort()).toEqual(ALLOWED.dossier);
  expect(dossier.id).toBe('d1');
  const items = dossier.items as Array<Record<string, unknown>>;
  expect(items.map((i) => i.id)).toEqual(['d1-1', 'd1-2', 'd1-3']);
  expect(items[0]).not.toHaveProperty('createdBy');
  expect(items[1].aboutItemId).toBe('d1-1');
  expect(items[2]).not.toHaveProperty('aboutItemId');
  expect(Object.keys(content.annotations[0]).sort()).toEqual(ALLOWED.annotation);
  expect(content.annotations[0]).toMatchObject({ id: 'a1', text: NOTE_TEXT, anchorText: ANCHOR, startOffset: 12 });
  expect(Object.keys(content.highlights[0]).sort()).toEqual(ALLOWED.highlight);
  expect(content.highlights[0]).toMatchObject({ id: 'h1', text: ANCHOR, color: 'green', startOffset: 12, rangeSerialized: '' });
  expect(Object.keys(content.quickNorms[0]).sort()).toEqual(ALLOWED.quickNorm);
  expect(content.quickNorms[0]).toMatchObject({ id: 'q1', usageCount: 0, searchParams: { act_type: 'codice civile', article: '2043' } });
  expect(Object.keys(content.customAliases[0]).sort()).toEqual(ALLOWED.alias);
  expect(content.customAliases[0]).toMatchObject({ id: 'c1', usageCount: 0 });
  expect(JSON.stringify(content)).not.toMatch(/u-1|u-2|mario|s-1|b-1|segreto|Claude|nota privata|tracker|Pratica Rossi|lastUsedAt/);
}

describe('the Forum\'s allow-list', () => {
  let alice: TestUser;
  let bob: TestUser;

  beforeEach(async () => {
    alice = await createTestUser('content-alice');
    bob = await createTestUser('content-bob');
  });

  const publish = (body: object, user = alice) => request(app).post('/api/shared-environments').set(authHeader(user)).send(body);

  it('stores and answers only the listed fields of each row, offsets and text byte for byte', async () => {
    const res = await publish({ title: 'Ricerca', category: 'civil', content: richContent() });
    expect(res.status).toBe(201);
    expectFiltered(res.body.content);
    const stored = await prisma.sharedEnvironment.findUniqueOrThrow({ where: { id: res.body.id } });
    expectFiltered(stored.content as Record<string, Array<Record<string, unknown>>>);
  });

  it('filters what an item published before the allow-list answers, without rewriting the row', async () => {
    const legacy = await prisma.sharedEnvironment.create({
      data: { title: 'Vecchio', category: 'civil', tags: [], userId: alice.id, content: richContent() as object },
    });
    const reads = [
      (await request(app).get('/api/shared-environments').set(authHeader(bob))).body.data[0].content,
      (await request(app).get(`/api/shared-environments/${legacy.id}`).set(authHeader(bob))).body.content,
      (await request(app).post(`/api/shared-environments/${legacy.id}/download`).set(authHeader(bob))).body.content,
      (await request(app).get('/api/shared-environments/my').set(authHeader(alice))).body[0].content,
    ];
    for (const content of reads) expectFiltered(content);
    const row = await prisma.sharedEnvironment.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(row.content).toEqual(richContent());
  });

  it('leaves out on a read the rows that do not pass, never failing the answer', async () => {
    const legacy = await prisma.sharedEnvironment.create({
      data: {
        title: 'Vecchio', category: 'civil', tags: [], userId: alice.id,
        content: {
          dossiers: [{ title: 'Ok', items: [{ type: 'norma', data: NORM }, { type: 'norma', data: { tipo_atto: 'premi Accept', numero_articolo: '1' } }] }, { items: [] }],
          quickNorms: [{ label: 'senza parametri' }],
          annotations: [{ normaKey: 'a::art::b', articleId: '1', text: 'chiave falsa' }, { normaKey: 'k', articleId: '1', text: 'buona' }],
          highlights: [{ normaKey: 'k', articleId: '1', text: 'x', color: 'nero' }],
        } as object,
      },
    });
    const read = await request(app).get(`/api/shared-environments/${legacy.id}`).set(authHeader(bob));
    expect(read.status).toBe(200);
    expect(read.body.content.dossiers).toHaveLength(1);
    expect(read.body.content.dossiers[0].items).toHaveLength(1);
    expect(read.body.content.quickNorms).toEqual([]);
    expect(read.body.content.annotations.map((a: { text: string }) => a.text)).toEqual(['buona']);
    expect(read.body.content.highlights).toEqual([]);
  });

  it.each([
    ['a note with a forged key', { annotations: [{ normaKey: 'x::art::y', articleId: '1', text: 't' }] }, /^Nota 1: riferimento alla norma non valido: non può essere pubblicato$/],
    ['a note with no text', { annotations: [{ normaKey: 'k', articleId: '1', text: '  ' }] }, /^Nota 1: testo mancante/],
    ['a negative offset', { highlights: [{ normaKey: 'k', articleId: '1', text: 't', color: 'yellow', startOffset: -1 }] }, /^Evidenziazione 1: posizione non valida/],
    ['an unknown colour', { highlights: [{ normaKey: 'k', articleId: '1', text: 't', color: 'nero' }] }, /^Evidenziazione 1: colore non valido/],
    ['a quick norm with no act', { quickNorms: [{ label: 'x', searchParams: {} }] }, /^Norma rapida 1: tipo di atto mancante/],
    // A date asks for the text in force that day (G-353): with «originale» the API answers 400.
    ['a quick norm asking for the original at a date',
      { quickNorms: [{ label: 'x', searchParams: { act_type: 'legge', article: '2', version: 'originale', version_date: '2020-01-01' } }] },
      /^Norma rapida 1: versione originale con una data della versione/],
    ['an alias with spaces', { customAliases: [{ trigger: 'c c', type: 'shortcut', expandTo: 'x' }] }, /^Alias 1: abbreviazione non valida/],
    ['a dossier with no title', { dossiers: [{ items: [] }] }, /^Dossier 1: titolo mancante/],
  ])('refuses %s on publish, in Italian', async (_label, part, message) => {
    const res = await publish({ title: 'Ricerca', category: 'civil', content: { dossiers: [], quickNorms: [], annotations: [], highlights: [], ...part } });
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(message);
  });

  it('keeps a note whose anchor has no position, as a note on the whole article', async () => {
    const res = await publish({ title: 'Ricerca', category: 'civil', content: {
      dossiers: [], quickNorms: [], highlights: [],
      annotations: [{ normaKey: 'k', articleId: '1', text: NOTE_TEXT, anchorText: ANCHOR }],
    } });
    expect(res.status).toBe(201);
    expect(res.body.content.annotations).toEqual([{ id: 'a1', normaKey: 'k', articleId: '1', text: NOTE_TEXT }]);
  });

  it('leaves out the tags it cannot read, never refusing the dossier for them', async () => {
    const tags = [...Array.from({ length: 25 }, (_, i) => `t${i}`), 'x'.repeat(51), 7, ''];
    const res = await publish({ title: 'Ricerca', category: 'civil', content: { dossiers: [{ title: 'D', tags, items: [] }], quickNorms: [], annotations: [], highlights: [] } });
    expect(res.status).toBe(201);
    expect(res.body.content.dossiers[0].tags).toEqual(Array.from({ length: 20 }, (_, i) => `t${i}`));
  });

  it('filters a new content on an update as on a publication', async () => {
    const res = await publish({ title: 'Ricerca', category: 'civil', content: { dossiers: [], quickNorms: [], annotations: [], highlights: [] } });
    const updated = await request(app).put(`/api/shared-environments/${res.body.id}`).set(authHeader(alice)).send({ content: richContent() });
    expect(updated.status).toBe(200);
    expectFiltered(updated.body.content);
    const stored = await prisma.sharedEnvironment.findUniqueOrThrow({ where: { id: res.body.id } });
    expectFiltered(stored.content as Record<string, Array<Record<string, unknown>>>);
  });

  it('filters a version when it is restored, as a publication', async () => {
    const res = await publish({ title: 'Ricerca', category: 'civil', content: { dossiers: [], quickNorms: [], annotations: [], highlights: [] } });
    const version = await prisma.sharedEnvironmentVersion.create({
      data: { sharedEnvironmentId: res.body.id, version: 50, content: richContent() as object },
    });
    const restored = await request(app).post(`/api/shared-environments/${res.body.id}/versions/${version.id}/restore`).set(authHeader(alice));
    expect(restored.status).toBe(200);
    const stored = await prisma.sharedEnvironment.findUniqueOrThrow({ where: { id: res.body.id } });
    expectFiltered(stored.content as Record<string, Array<Record<string, unknown>>>);
  });

  it('says the daily limit in Italian', async () => {
    const empty = { dossiers: [], quickNorms: [], annotations: [], highlights: [] };
    for (let i = 0; i < 5; i++) expect((await publish({ title: `Ricerca ${i}`, category: 'civil', content: empty })).status).toBe(201);
    const sixth = await publish({ title: 'Ricerca 6', category: 'civil', content: empty });
    expect(sixth.status).toBe(429);
    expect(sixth.body.detail).toBe('Puoi pubblicare al massimo 5 dossier al giorno: riprova domani.');
  });
});

describe('publishing from a dossier', () => {
  let alice: TestUser;
  let bob: TestUser;
  let dossierId: string;

  beforeEach(async () => {
    alice = await createTestUser('pub-alice');
    bob = await createTestUser('pub-bob');
    dossierId = (await request(app).post('/api/dossiers').set(authHeader(alice)).send({ name: 'Rossi c. Bianchi' })).body.id;
  });

  const oneDossier = (extra: object = {}) => ({
    dossiers: [{ title: 'Rossi c. Bianchi', description: 'pratica privata', tags: ['cliente'], items: [{ type: 'norma', data: NORM }] }],
    quickNorms: [], annotations: [], highlights: [], ...extra,
  });
  const publish = (body: object, user = alice) =>
    request(app).post('/api/shared-environments').set(authHeader(user))
      .send({ title: 'Responsabilità extracontrattuale', description: 'Gli articoli chiave', tags: ['civile'], category: 'civil', sourceDossierId: dossierId, content: oneDossier(), ...body });

  it('names the dossier inside as the dialog did, never by its private name, and links it for its owner only', async () => {
    const res = await publish({});
    expect(res.status).toBe(201);
    expect(res.body.content.dossiers[0]).toMatchObject({ title: 'Responsabilità extracontrattuale', description: 'Gli articoli chiave', tags: ['civile'] });
    expect(JSON.stringify(res.body.content)).not.toMatch(/Rossi|pratica privata|cliente/);
    expect(res.body.sourceDossierId).toBe(dossierId);
    const seenByBob = await request(app).get(`/api/shared-environments/${res.body.id}`).set(authHeader(bob));
    expect(seenByBob.body).not.toHaveProperty('sourceDossierId');
    expect(seenByBob.body).not.toHaveProperty('withdrawnByAdmin');
    const dossier = await request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(alice));
    expect(dossier.body.published).toMatchObject({ shared_environment_id: res.body.id, version: 1, is_active: true });
  });

  it('answers 404 for a dossier that is not the caller\'s, as for one that does not exist', async () => {
    expect((await publish({}, bob)).status).toBe(404);
    expect((await publish({ sourceDossierId: 'non-esiste' })).status).toBe(404);
    expect(await prisma.sharedEnvironment.count()).toBe(0);
  });

  it('publishes a dossier once: a second publication is a 409, also when both arrive together', async () => {
    const [one, two] = await Promise.all([publish({}), publish({})]);
    expect([one.status, two.status].sort()).toEqual([201, 409]);
    const third = await publish({});
    expect(third.status).toBe(409);
    expect(third.body.detail).toMatch(/già pubblicato nel Forum/);
    expect(await prisma.sharedEnvironment.count()).toBe(1);
  });

  it.each([
    ['two dossiers', { content: { ...oneDossier(), dossiers: [oneDossier().dossiers[0], oneDossier().dossiers[0]] } }, /un solo dossier/],
    ['a quick norm', { content: oneDossier({ quickNorms: [{ label: 'x', searchParams: { act_type: 'legge' } }] }) }, /norme rapide/],
    ['notes when they are excluded', { includeNotes: false, content: oneDossier({ annotations: [{ normaKey: 'k', articleId: '1', text: 't' }] }) }, /note sono escluse/],
    ['highlights when they are excluded', { includeHighlights: false, content: oneDossier({ highlights: [{ normaKey: 'k', articleId: '1', text: 't', color: 'yellow' }] }) }, /evidenziazioni sono escluse/],
  ])('refuses %s', async (_label, body, message) => {
    const res = await publish(body);
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(message);
  });

  it('updates in place: a new content is a new version under the same name; a new name is not', async () => {
    const res = await publish({});
    const id = res.body.id;
    const renamed = await request(app).put(`/api/shared-environments/${id}`).set(authHeader(alice)).send({ title: 'Nuovo titolo', sourceDossierId: 'altro' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.currentVersion).toBe(1);
    expect(renamed.body.content.dossiers[0].title).toBe('Nuovo titolo');
    expect(renamed.body.sourceDossierId).toBe(dossierId);
    const updated = await request(app).put(`/api/shared-environments/${id}`).set(authHeader(alice))
      .send({ content: oneDossier({ dossiers: [{ title: 'Rossi c. Bianchi', items: [{ type: 'norma', data: NORM }, { type: 'note', data: 'nuova' }] }] }) });
    expect(updated.status).toBe(200);
    expect(updated.body.currentVersion).toBe(2);
    expect(updated.body.content.dossiers[0].title).toBe('Nuovo titolo');
    expect(updated.body.content.dossiers[0].items).toHaveLength(2);
  });

  it('takes a note in a later version although the first publication had none, and says so to a downloader', async () => {
    // As the web publishes a dossier with every note left out.
    const res = await publish({ includeNotes: false, includeHighlights: false });
    expect(res.body.includeNotes).toBe(false);
    const note = { normaKey: 'codice-civile--2043', articleId: '2043', text: 'una nota' };
    const updated = await request(app).put(`/api/shared-environments/${res.body.id}`).set(authHeader(alice))
      .send({ content: oneDossier({ annotations: [note] }) });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ includeNotes: true, includeHighlights: false, currentVersion: 2 });
    expect(updated.body.content.annotations).toHaveLength(1);
  });

  it('clears the description of the dossier inside when the item\'s is cleared', async () => {
    const res = await publish({});
    const cleared = await request(app).put(`/api/shared-environments/${res.body.id}`).set(authHeader(alice)).send({ description: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.description).toBeNull();
    expect(cleared.body.content.dossiers[0]).not.toHaveProperty('description');
  });

  it('refuses a version side by side for an item published from a dossier', async () => {
    const res = await publish({});
    const coexist = await request(app).put(`/api/shared-environments/${res.body.id}`).set(authHeader(alice))
      .send({ versionMode: 'coexist', content: oneDossier() });
    expect(coexist.status).toBe(400);
    expect(await prisma.sharedEnvironment.count()).toBe(1);
  });

  it('stays blocked once the admin withdrew its copy: deleting the copy does not undo it, until the admin allows it (question 190)', async () => {
    const admin = await createTestUser('pub-admin');
    await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: true } });
    const res = await publish({});
    expect((await request(app).post(`/api/admin/shared-environments/${res.body.id}/withdraw`).set(authHeader(admin))).status).toBe(200);
    expect((await request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(alice))).body.forum_blocked).toBe(true);

    // The author keeps the right to delete their own copy…
    expect((await request(app).delete(`/api/shared-environments/${res.body.id}`).set(authHeader(alice))).status).toBe(204);
    // …but cannot publish the dossier again, not even after the trash.
    const trashId = (await request(app).delete(`/api/dossiers/${dossierId}`).set(authHeader(alice))).body.trashId;
    await request(app).post(`/api/trash/${trashId}/restore`).set(authHeader(alice)).send({});
    const again = await publish({});
    expect(again.status).toBe(403);
    expect(again.body.detail).toMatch(/ritirato questo dossier dal Forum/);

    const blocks = await request(app).get('/api/admin/forum-blocks').set(authHeader(admin));
    expect(blocks.body).toEqual([expect.objectContaining({ dossierId, owner: { id: alice.id, username: 'pub-alice' }, publishedCopy: null })]);
    expect((await request(app).get('/api/admin/forum-blocks').set(authHeader(alice))).status).toBe(403);
    expect((await request(app).delete(`/api/admin/forum-blocks/${dossierId}`).set(authHeader(admin))).status).toBe(204);
    expect((await publish({})).status).toBe(201);
  });

  it('is unblocked when the admin republishes its copy', async () => {
    const admin = await createTestUser('pub-admin2');
    await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: true } });
    const res = await publish({});
    await request(app).post(`/api/admin/shared-environments/${res.body.id}/withdraw`).set(authHeader(admin));
    expect((await request(app).post(`/api/admin/shared-environments/${res.body.id}/republish`).set(authHeader(admin))).status).toBe(200);
    expect((await request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(alice))).body.forum_blocked).toBe(false);
  });

  it('keeps the name when an older version is restored', async () => {
    const res = await publish({});
    const version = await prisma.sharedEnvironmentVersion.create({ data: { sharedEnvironmentId: res.body.id, version: 9, content: oneDossier() as object } });
    const restored = await request(app).post(`/api/shared-environments/${res.body.id}/versions/${version.id}/restore`).set(authHeader(alice));
    expect(restored.status).toBe(200);
    expect(restored.body.content.dossiers[0].title).toBe('Responsabilità extracontrattuale');
  });
});

describe('a withdrawn item', () => {
  let alice: TestUser;
  let bob: TestUser;
  let admin: TestUser;
  let envId: string;

  beforeEach(async () => {
    alice = await createTestUser('wd-alice');
    bob = await createTestUser('wd-bob');
    admin = await createTestUser('wd-admin');
    await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: true } });
    const res = await request(app).post('/api/shared-environments').set(authHeader(alice))
      .send({ title: 'Ricerca', category: 'civil', content: { dossiers: [], quickNorms: [], annotations: [], highlights: [] } });
    envId = res.body.id;
  });

  it('is hidden from everyone but its owner and the admin, on every route', async () => {
    const suggestion = await request(app).post(`/api/shared-environments/${envId}/suggestions`).set(authHeader(bob))
      .send({ items: [{ itemType: 'annotation', payload: { text: 'x' } }] });
    expect(suggestion.status).toBe(201);
    expect((await request(app).post(`/api/shared-environments/${envId}/withdraw`).set(authHeader(alice))).status).toBe(200);

    const asBob = authHeader(bob);
    expect((await request(app).get(`/api/shared-environments/${envId}`).set(asBob)).status).toBe(404);
    expect((await request(app).post(`/api/shared-environments/${envId}/like`).set(asBob)).status).toBe(404);
    expect((await request(app).post(`/api/shared-environments/${envId}/download`).set(asBob)).status).toBe(404);
    expect((await request(app).get(`/api/shared-environments/${envId}/versions`).set(asBob)).status).toBe(404);
    expect((await request(app).post(`/api/shared-environments/${envId}/report`).set(asBob).send({ reason: 'spam' })).status).toBe(404);
    expect((await request(app).post(`/api/shared-environments/${envId}/suggestions`).set(asBob)
      .send({ items: [{ itemType: 'annotation', payload: { text: 'y' } }] })).status).toBe(404);
    expect((await request(app).post(`/api/shared-environments-suggestions/${suggestion.body.id}/items`).set(asBob)
      .send({ items: [{ itemType: 'annotation', payload: { text: 'z' } }] })).status).toBe(404);
    expect((await request(app).get('/api/shared-environments').set(asBob)).body.data).toHaveLength(0);

    const asAlice = authHeader(alice);
    expect((await request(app).get(`/api/shared-environments/${envId}`).set(asAlice)).status).toBe(200);
    expect((await request(app).get(`/api/shared-environments/${envId}/versions`).set(asAlice)).status).toBe(200);
    expect((await request(app).post(`/api/shared-environments/${envId}/download`).set(asAlice)).status).toBe(200);
    expect((await request(app).post(`/api/shared-environments/${envId}/like`).set(asAlice)).status).toBe(200);
    const asAdmin = authHeader(admin);
    expect((await request(app).get(`/api/shared-environments/${envId}`).set(asAdmin)).status).toBe(200);
    expect((await request(app).get(`/api/shared-environments/${envId}/versions`).set(asAdmin)).status).toBe(200);
    expect((await request(app).post(`/api/shared-environments/${envId}/download`).set(asAdmin)).status).toBe(200);

    // The proposer's own list no longer names it.
    const sent = await request(app).get('/api/shared-environments-suggestions/sent').set(asBob);
    expect(sent.body[0].sharedEnvironment).toBeUndefined();
    expect(JSON.stringify(sent.body)).not.toContain('Ricerca');
  });

  it('stays the admin\'s withdrawal when its author had withdrawn it first', async () => {
    expect((await request(app).post(`/api/shared-environments/${envId}/withdraw`).set(authHeader(alice))).status).toBe(200);
    expect((await request(app).post(`/api/admin/shared-environments/${envId}/withdraw`).set(authHeader(admin))).status).toBe(200);
    expect((await request(app).post(`/api/shared-environments/${envId}/republish`).set(authHeader(alice))).status).toBe(403);
  });

  it('cannot come back as a copy side by side when the admin withdrew it', async () => {
    expect((await request(app).post(`/api/admin/shared-environments/${envId}/withdraw`).set(authHeader(admin))).status).toBe(200);
    const coexist = await request(app).put(`/api/shared-environments/${envId}`).set(authHeader(alice))
      .send({ versionMode: 'coexist', content: { dossiers: [], quickNorms: [], annotations: [], highlights: [] } });
    expect(coexist.status).toBe(403);
    expect(await prisma.sharedEnvironment.count({ where: { isActive: true } })).toBe(0);
  });

  it('cannot be republished by its author when the admin withdrew it, until the admin republishes it', async () => {
    expect((await request(app).post(`/api/admin/shared-environments/${envId}/withdraw`).set(authHeader(admin))).status).toBe(200);
    const mine = await request(app).get('/api/shared-environments/my').set(authHeader(alice));
    expect(mine.body[0].withdrawnByAdmin).toBe(true);
    const refused = await request(app).post(`/api/shared-environments/${envId}/republish`).set(authHeader(alice));
    expect(refused.status).toBe(403);
    expect(refused.body.detail).toMatch(/ritirato dall'amministrazione/);
    expect((await prisma.sharedEnvironment.findUniqueOrThrow({ where: { id: envId } })).isActive).toBe(false);

    expect((await request(app).post(`/api/admin/shared-environments/${envId}/republish`).set(authHeader(admin))).status).toBe(200);
    expect((await request(app).post(`/api/shared-environments/${envId}/withdraw`).set(authHeader(alice))).status).toBe(200);
    expect((await request(app).post(`/api/shared-environments/${envId}/republish`).set(authHeader(alice))).status).toBe(200);
  });
});
