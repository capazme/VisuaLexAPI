import { describe, it, expect, beforeEach } from 'vitest';
import { request, app, createTestUser, authHeader, type TestUser } from './helpers';

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
});
