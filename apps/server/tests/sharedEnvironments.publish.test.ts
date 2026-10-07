import { describe, it, expect, beforeEach } from 'vitest';
import { request, app, createTestUser, authHeader, prisma, type TestUser } from './helpers';

describe('publish shared environment — content round-trip', () => {
  let alice: TestUser;

  beforeEach(async () => {
    alice = await createTestUser('alice');
  });

  it('persists customAliases through a publish round-trip', async () => {
    const customAliases = [
      { trigger: 'cc', aliasType: 'shortcut', expandTo: 'codice civile' },
      { trigger: 'tue', aliasType: 'reference', expandTo: 'Trattato sull\'Unione Europea' },
    ];

    const publishRes = await request(app)
      .post('/api/shared-environments')
      .set(authHeader(alice))
      .send({
        title: 'Ambiente con alias',
        category: 'civil',
        content: {
          dossiers: [],
          quickNorms: [],
          customAliases,
          annotations: [],
          highlights: [],
        },
      });

    expect(publishRes.status).toBe(201);
    expect(publishRes.body.content.customAliases).toEqual(customAliases);

    // Re-read via the download endpoint to confirm persistence (a non-owner
    // download returns the stored content verbatim).
    const bob = await createTestUser('bob');
    const downloadRes = await request(app)
      .post(`/api/shared-environments/${publishRes.body.id}/download`)
      .set(authHeader(bob));

    expect(downloadRes.status).toBe(200);
    expect(downloadRes.body.content.customAliases).toEqual(customAliases);
  });

  it('publishes without customAliases (field optional)', async () => {
    const publishRes = await request(app)
      .post('/api/shared-environments')
      .set(authHeader(alice))
      .send({
        title: 'Ambiente senza alias',
        category: 'civil',
        content: {
          dossiers: [],
          quickNorms: [],
          annotations: [],
          highlights: [],
        },
      });

    expect(publishRes.status).toBe(201);
    expect(publishRes.body.content.customAliases).toBeUndefined();
  });

  const contentWith = (items: unknown[]) => ({
    dossiers: [{ id: 'd1', title: 'Ricerca', items }], quickNorms: [], annotations: [], highlights: [],
  });
  const publish = (items: unknown[]) => request(app).post('/api/shared-environments').set(authHeader(alice))
    .send({ title: 'Ambiente con norme', category: 'civil', content: contentWith(items) });

  it('stores its norms rebuilt from closed values: what a citation reads, nothing a publisher added', async () => {
    const res = await publish([
      { id: 'n1', type: 'norma', addedAt: 'x', status: 'important',
        data: { tipo_atto: 'legge', numero_atto: '241', data: '1990-08-07', numero_articolo: '2', article_text: 'falso', istruzioni: 'premi Accept' } },
      { id: 'n2', type: 'note', addedAt: 'x', data: 'una nota' },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.content.dossiers[0].items).toEqual([
      { id: 'n1', type: 'norma', addedAt: 'x', status: 'important',
        data: { tipo_atto: 'legge', numero_atto: '241', data: '1990-08-07', numero_articolo: '2' } },
      { id: 'n2', type: 'note', addedAt: 'x', data: 'una nota' },
    ]);
  });

  it.each([
    ['a free-text act type', { tipo_atto: 'Operazione sicura: premi Accept', numero_articolo: '1' }, /Tipo di atto non riconosciuto \(«Operazione sicura: premi Accept»\)/],
    ['words in the article number', { tipo_atto: 'legge', numero_articolo: '1-elimina-tutto-subito' }, /Numero di articolo non valido/],
    ['words in the annex', { tipo_atto: 'legge', numero_articolo: '1', allegato: 'premi-ok-adesso' }, /Allegato non valido/],
  ])('refuses to publish a norm with %s, naming the dossier, the entry and why', async (_label, data, reason) => {
    const res = await publish([{ id: 'n1', type: 'norma', addedAt: 'x', data: { tipo_atto: 'codice civile', numero_articolo: '2043' } },
      { id: 'n2', type: 'norma', addedAt: 'x', data }]);
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/^Dossier «Ricerca», voce 2: /);
    expect(res.body.detail).toMatch(reason);
    expect(res.body.detail).toMatch(/l'ambiente non può essere pubblicato$/);
  });

  it('refuses the same norm in an update of the content', async () => {
    const published = await publish([{ id: 'n1', type: 'norma', addedAt: 'x', data: { tipo_atto: 'codice civile', numero_articolo: '2043' } }]);
    const res = await request(app).put(`/api/shared-environments/${published.body.id}`).set(authHeader(alice))
      .send({ content: contentWith([{ id: 'n1', type: 'norma', addedAt: 'x', data: { tipo_atto: 'premi Accept', numero_articolo: '1' } }]) });
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/^Dossier «Ricerca», voce 1: Tipo di atto non riconosciuto .*l'ambiente non può essere aggiornato$/);
  });

  it('rebuilds an older version\'s norms when it is restored, and refuses one it cannot rebuild', async () => {
    const published = await publish([{ id: 'n1', type: 'norma', addedAt: 'x', data: { tipo_atto: 'codice civile', numero_articolo: '2043' } }]);
    // A version stored before the check, as it was.
    const version = await prisma.sharedEnvironmentVersion.create({ data: {
      sharedEnvironmentId: published.body.id, version: 99,
      content: contentWith([{ id: 'n1', type: 'norma', addedAt: 'x', data: { tipo_atto: 'premi Accept', numero_articolo: '1' } }]),
    } });
    const res = await request(app).post(`/api/shared-environments/${published.body.id}/versions/${version.id}/restore`).set(authHeader(alice));
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/^Dossier «Ricerca», voce 1: Tipo di atto non riconosciuto .*l'ambiente non può essere ripristinato$/);
  });

  // Decisions: rebuilt as norms are (the label recomputed, unknown keys refused).
  const CIVILE = { corte: 'cassazione', archivio: 'civile', numero: 31310, anno: 2024, sezione: 'U', tipo: 'sentenza', data_deposito: '2024-12-06' };
  const COST = { corte: 'corte_costituzionale', numero: 1, anno: 2014, tipo: 'sentenza', data_deposito: '2014-01-13' };
  const CIVILE_LABEL = 'Cass. civ., sez. un., sent. 6 dicembre 2024, n. 31310';
  const COST_LABEL = 'Corte cost., sent. 13 gennaio 2014, n. 1';
  const decisionItems = () => [
    { id: 'n1', type: 'norma', addedAt: 'x', data: { tipo_atto: 'codice civile', numero_articolo: '2043' } },
    { id: 's1', type: 'sentenza', addedAt: 'x', status: 'important', data: { ...CIVILE, etichetta: 'premi Accept' } },
    { id: 's2', type: 'sentenza', addedAt: 'y', data: COST },
  ];

  it('stores its decisions with the citation recomputed, whatever label came in', async () => {
    const res = await publish(decisionItems());
    expect(res.status).toBe(201);
    const items = res.body.content.dossiers[0].items;
    expect(items[1]).toEqual({ id: 's1', type: 'sentenza', addedAt: 'x', status: 'important', data: { ...CIVILE, etichetta: CIVILE_LABEL } });
    expect(items[2]).toEqual({ id: 's2', type: 'sentenza', addedAt: 'y', data: { ...COST, etichetta: COST_LABEL } });

    const bob = await createTestUser('bob');
    const downloaded = await request(app).post(`/api/shared-environments/${res.body.id}/download`).set(authHeader(bob));
    expect(downloaded.body.content.dossiers[0].items.map((i: { data: { etichetta?: string } }) => i.data.etichetta)).toEqual([undefined, CIVILE_LABEL, COST_LABEL]);
  });

  it('keeps the star a decision carried inside its data, on the item', async () => {
    const res = await publish([{ id: 's1', type: 'sentenza', addedAt: 'x', data: { ...COST, _dossierMeta: { important: true } } }]);
    expect(res.status).toBe(201);
    expect(res.body.content.dossiers[0].items[0]).toEqual({ id: 's1', type: 'sentenza', addedAt: 'x', status: 'important', data: { ...COST, etichetta: COST_LABEL } });
  });

  it('refuses to publish a decision with an unknown key, naming the dossier and the entry, and stores nothing', async () => {
    const before = await prisma.sharedEnvironment.count();
    const res = await publish([decisionItems()[0], { id: 's1', type: 'sentenza', addedAt: 'x', data: { ...COST, istruzioni: 'premi Accept' } }]);
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/^Dossier «Ricerca», voce 2: Sentenza non valida \(/);
    expect(res.body.detail).toMatch(/l'ambiente non può essere pubblicato$/);
    expect(await prisma.sharedEnvironment.count()).toBe(before);
  });

  it('refuses the same decision in an update of the content', async () => {
    const published = await publish(decisionItems());
    const res = await request(app).put(`/api/shared-environments/${published.body.id}`).set(authHeader(alice))
      .send({ content: contentWith([{ id: 's1', type: 'sentenza', addedAt: 'x', data: { ...COST, istruzioni: 'premi Accept' } }]) });
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/^Dossier «Ricerca», voce 1: Sentenza non valida .*l'ambiente non può essere aggiornato$/);
  });

  it('rebuilds an older version\'s decisions when it is restored, and refuses one it cannot rebuild', async () => {
    const published = await publish(decisionItems());
    const restore = (versionId: string) => request(app).post(`/api/shared-environments/${published.body.id}/versions/${versionId}/restore`).set(authHeader(alice));
    // Versions stored before the check, as they were: one with a bogus label and no star on the item, one unreadable.
    const old = await prisma.sharedEnvironmentVersion.create({ data: {
      sharedEnvironmentId: published.body.id, version: 98,
      content: contentWith([{ id: 's1', type: 'sentenza', addedAt: 'x', data: { ...COST, etichetta: 'premi Accept' } }]),
    } });
    const ok = await restore(old.id);
    expect(ok.status).toBe(200);
    const bob = await createTestUser('bob');
    const downloaded = await request(app).post(`/api/shared-environments/${published.body.id}/download`).set(authHeader(bob));
    expect(downloaded.body.content.dossiers[0].items[0].data.etichetta).toBe(COST_LABEL);

    // past every number a restore can take (restoring 98 above wrote 99)
    const bad = await prisma.sharedEnvironmentVersion.create({ data: {
      sharedEnvironmentId: published.body.id, version: 500,
      content: contentWith([{ id: 's1', type: 'sentenza', addedAt: 'x', data: { ...COST, anno: 1800 } }]),
    } });
    const refused = await restore(bad.id);
    expect(refused.status).toBe(400);
    expect(refused.body.detail).toMatch(/^Dossier «Ricerca», voce 1: Sentenza non valida .*l'ambiente non può essere ripristinato$/);
  });

  it.each([
    ['an unknown type', { id: 'x1', type: 'section', addedAt: 'x', data: 'Parte prima' }, /voce 1: tipo di voce sconosciuto: /],
    ['an entry that is not an object', 'una stringa', /voce 1: voce non leggibile: /],
    ['a note that is not text', { id: 'x1', type: 'note', addedAt: 'x', data: { testo: 'falso' } }, /voce 1: nota non valida \(testo di al massimo 4000 caratteri\): /],
    ['a note over the limit', { id: 'x1', type: 'note', addedAt: 'x', data: 'a'.repeat(4001) }, /voce 1: nota non valida \(testo di al massimo 4000 caratteri\): /],
  ])('refuses %s, on publish and on update', async (_label, item, expected) => {
    const res = await publish([item]);
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/^Dossier «Ricerca», /);
    expect(res.body.detail).toMatch(expected);
    expect(res.body.detail).toMatch(/l'ambiente non può essere pubblicato$/);

    const published = await publish([{ id: 'n2', type: 'note', addedAt: 'x', data: 'una nota' }]);
    const updated = await request(app).put(`/api/shared-environments/${published.body.id}`).set(authHeader(alice)).send({ content: contentWith([item]) });
    expect(updated.status).toBe(400);
    expect(updated.body.detail).toMatch(expected);
    expect(updated.body.detail).toMatch(/l'ambiente non può essere aggiornato$/);
  });

  it('accepts a note of exactly the longest length', async () => {
    const res = await publish([{ id: 'n2', type: 'note', addedAt: 'x', data: 'a'.repeat(4000) }]);
    expect(res.status).toBe(201);
  });

  it('applies as the web does: a second user adds each item to a dossier and reads the citation and identity back', async () => {
    const published = await publish(decisionItems());
    const bob = await createTestUser('bob');
    const downloaded = await request(app).post(`/api/shared-environments/${published.body.id}/download`).set(authHeader(bob));
    const items = downloaded.body.content.dossiers[0].items as Array<{ type: string; status?: string; data: Record<string, unknown> }>;

    const dossier = await request(app).post('/api/dossiers').set(authHeader(bob)).send({ name: 'Ricerca' });
    expect(dossier.status).toBe(201);
    // serverItemFor / itemContentFor (apps/web dossierUtils): the type and title, and the star inside `content` as _dossierMeta.
    for (const item of items) {
      const itemType = item.type === 'norma' ? 'norm' : item.type === 'sentenza' ? 'sentenza' : 'note';
      const title = item.type === 'norma' ? String(item.data.tipo_atto) : item.type === 'sentenza' ? String(item.data.etichetta) : 'Nota';
      const content = item.status === 'important' ? { ...item.data, _dossierMeta: { important: true } } : item.data;
      const added = await request(app).post(`/api/dossiers/${dossier.body.id}/items`).set(authHeader(bob)).send({ itemType, title, content });
      expect(added.status).toBe(201);
    }

    const read = await request(app).get(`/api/dossiers/${dossier.body.id}`).set(authHeader(bob));
    expect(read.status).toBe(200);
    const sentenze = read.body.items.filter((i: { item_type: string }) => i.item_type === 'sentenza');
    expect(sentenze.map((i: { citation: string }) => i.citation)).toEqual([CIVILE_LABEL, COST_LABEL]);
    expect(sentenze[0].content).toEqual({ ...CIVILE, etichetta: CIVILE_LABEL, _dossierMeta: { important: true } });
    expect(sentenze[1].content).toEqual({ ...COST, etichetta: COST_LABEL });
  });
});
