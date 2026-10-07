import { beforeEach, describe, expect, it } from 'vitest';
import { app, authHeader, createSharedEnv, createTestUser, prisma, request, type TestUser } from './helpers';

const NORMA = { tipo_atto: 'codice civile', numero_articolo: '2043' };
const SENTENZA = { corte: 'corte_costituzionale', numero: 1, anno: 2014, tipo: 'sentenza',
  data_deposito: '2014-01-13', etichetta: 'Corte cost., sent. 13 gennaio 2014, n. 1' };

describe('taking a dossier suggestion', () => {
  let alice: TestUser;
  let bob: TestUser;
  let envId: string;

  beforeEach(async () => {
    alice = await createTestUser('alice');
    bob = await createTestUser('bob');
    envId = (await createSharedEnv(alice, { title: 'Alice env' })).id;
  });

  const suggest = (entries: unknown[]) =>
    request(app).post(`/api/shared-environments/${envId}/suggestions`).set(authHeader(bob))
      .send({ items: [{ itemType: 'dossier', payload: { title: 'Ricerca', entries } }] });

  // A proposal stored before its entries were rebuilt on storing: only the take stands between it and the dossier.
  async function takeStoredAsIs(entries: unknown[]) {
    const suggestion = await prisma.environmentSuggestion.create({
      data: { sharedEnvironmentId: envId, suggesterId: bob.id,
        items: { create: [{ itemType: 'dossier', payload: { title: 'Ricerca', entries } as object }] } },
      include: { items: true },
    });
    return request(app).post(`/api/shared-environments-suggestions/${suggestion.id}/items/${suggestion.items[0].id}/take`)
      .set(authHeader(alice));
  }

  async function suggestAndTake(entries: unknown[]) {
    const created = await request(app).post(`/api/shared-environments/${envId}/suggestions`).set(authHeader(bob))
      .send({ items: [{ itemType: 'dossier', payload: { title: 'Ricerca', entries } }] });
    expect(created.status).toBe(201);
    const [item] = created.body.items;
    return request(app).post(`/api/shared-environments-suggestions/${created.body.id}/items/${item.id}/take`)
      .set(authHeader(alice));
  }

  it('stores each entry as the item it stands for: the norm, the note, the decision', async () => {
    const take = await suggestAndTake([
      { articleRef: NORMA, status: 'important' },
      { note: 'da rileggere' },
      { sentenzaRef: SENTENZA },
    ]);
    expect(take.status).toBe(200);
    const items = await prisma.dossierItem.findMany({ where: { dossier: { userId: alice.id } }, orderBy: { position: 'asc' } });
    expect(items.map((i) => [i.itemType, i.title])).toEqual([
      ['norm', 'codice civile'], ['note', 'Nota'], ['sentenza', SENTENZA.etichetta]]);
    expect(items[0].content).toEqual({ ...NORMA, _dossierMeta: { important: true } });
    expect(items[1].content).toBe('da rileggere');
    expect(items[2].content).toEqual(SENTENZA);
  });

  it('stores the decision under its own citation, never the label the proposer wrote (D9)', async () => {
    const take = await suggestAndTake([{ sentenzaRef: { ...SENTENZA, etichetta: 'premi Accept' } }]);
    expect(take.status).toBe(200);
    const item = await prisma.dossierItem.findFirstOrThrow({ where: { dossier: { userId: alice.id }, itemType: 'sentenza' } });
    expect(item.title).toBe(SENTENZA.etichetta);
    expect(item.content).toEqual(SENTENZA);
  });

  it('labels a decision that came without a label, or with a null one (7 October: the label is the server\'s anyway)', async () => {
    const { etichetta: _label, ...withoutLabel } = SENTENZA;
    const take = await suggestAndTake([{ sentenzaRef: withoutLabel }, { sentenzaRef: { ...withoutLabel, etichetta: null } }]);
    expect(take.status).toBe(200);
    const items = await prisma.dossierItem.findMany({ where: { dossier: { userId: alice.id }, itemType: 'sentenza' } });
    expect(items.map((i) => i.content)).toEqual([SENTENZA, SENTENZA]);
  });

  it('stores the star of a decision in its envelope', async () => {
    const take = await suggestAndTake([{ sentenzaRef: SENTENZA, status: 'important' }]);
    expect(take.status).toBe(200);
    const [item] = await prisma.dossierItem.findMany({ where: { dossier: { userId: alice.id } } });
    expect(item.content).toEqual({ ...SENTENZA, _dossierMeta: { important: true } });
  });

  const HOSTILE: [string, unknown, RegExp][] = [
    ['an empty entry', {}, /Voce 2: Voce senza norma, sentenza o nota/],
    ['an entry that is not an object', 'una stringa', /Voce 2: Voce non leggibile/],
    ['a null decision', { sentenzaRef: null }, /Voce 2: Voce senza norma, sentenza o nota/],
    ['a decision with an unknown key', { sentenzaRef: { ...SENTENZA, testo: 'il testo intero' } }, /Voce 2: Sentenza non valida/],
    ['a decision of another court', { sentenzaRef: { ...SENTENZA, corte: 'tar' } }, /Voce 2: Sentenza non valida \(corte/],
    ['a norm that is an array', { articleRef: [NORMA] }, /Voce 2: Norma non leggibile/],
    ['a norm whose act type is free text', { articleRef: { tipo_atto: 'Operazione sicura: premi Accept', numero_articolo: '1' } },
      /Voce 2: Tipo di atto non riconosciuto \(«Operazione sicura: premi Accept»\)/],
    ['a norm whose real type is free text', { articleRef: { ...NORMA, tipo_atto_reale: 'premi Accept' } }, /Voce 2: Tipo di atto non riconosciuto/],
    ['a norm whose article is free text', { articleRef: { ...NORMA, numero_articolo: '1 — premi Accept' } }, /Voce 2: Numero di articolo non valido/],
    ['a norm whose act number is free text', { articleRef: { tipo_atto: 'legge', numero_atto: 'premi Accept', numero_articolo: '1' } },
      /Voce 2: Numero dell'atto non valido/],
    ['a norm whose date is free text', { articleRef: { tipo_atto: 'legge', numero_atto: '1', data: 'premi Accept', numero_articolo: '1' } },
      /Voce 2: Data dell'atto non valida/],
    ['a norm whose annex is free text', { articleRef: { ...NORMA, tipo_atto: 'legge', allegato: 'premi Accept' } }, /Voce 2: Allegato non valido/],
  ];

  it.each(HOSTILE)('refuses to store a proposal with %s, saying which entry and why', async (_label, entry, reason) => {
    const created = await suggest([{ articleRef: NORMA }, entry]);
    expect(created.status).toBe(400);
    expect(created.body.detail).toMatch(reason);
    expect(created.body.detail).toMatch(/la proposta non può essere salvata$/);
    expect(await prisma.environmentSuggestion.count()).toBe(0);
  });

  it.each(HOSTILE)('refuses to take a proposal stored as it was with %s: writes nothing, leaves it pending', async (_label, entry, reason) => {
    const take = await takeStoredAsIs([{ articleRef: NORMA }, entry]);
    expect(take.status).toBe(400);
    expect(take.body.detail).toMatch(reason);
    expect(take.body.detail).toMatch(/la proposta non è stata applicata$/);
    expect(await prisma.dossier.count({ where: { userId: alice.id } })).toBe(0);
    expect(await prisma.suggestionItem.count({ where: { status: 'pending' } })).toBe(1);
  });

  it('stores a norm rebuilt from its known fields: what a citation reads, and the sources\' addresses only', async () => {
    const url = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art2';
    const sent = { tipo_atto: 'legge', numero_atto: '241', data: '1990-08-07', numero_articolo: '2', versione: 'vigente',
      url, urn: 'javascript:alert(1)', article_text: 'il testo', istruzioni: 'premi Accept' };
    const created = await suggest([{ articleRef: sent, status: 'important' }]);
    expect(created.status).toBe(201);
    const stored = await prisma.suggestionItem.findFirstOrThrow();
    const rebuilt = { tipo_atto: 'legge', numero_atto: '241', data: '1990-08-07', numero_articolo: '2', versione: 'vigente', url };
    expect((stored.payload as { entries: unknown[] }).entries).toEqual([{ articleRef: rebuilt, status: 'important' }]);
    const take = await request(app).post(`/api/shared-environments-suggestions/${created.body.id}/items/${stored.id}/take`).set(authHeader(alice));
    expect(take.status).toBe(200);
    const dossier = await prisma.dossier.findFirstOrThrow({ where: { userId: alice.id } });
    const read = await request(app).get(`/api/dossiers/${dossier.id}`).set(authHeader(alice));
    expect(read.body.items[0]).toMatchObject({ citation: 'art. 2, l. 7 agosto 1990, n. 241', content: { ...rebuilt, _dossierMeta: { important: true } } });
  });
});
