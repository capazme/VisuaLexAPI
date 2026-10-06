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

  it('stores the star of a decision in its envelope', async () => {
    const take = await suggestAndTake([{ sentenzaRef: SENTENZA, status: 'important' }]);
    expect(take.status).toBe(200);
    const [item] = await prisma.dossierItem.findMany({ where: { dossier: { userId: alice.id } } });
    expect(item.content).toEqual({ ...SENTENZA, _dossierMeta: { important: true } });
  });

  it.each([
    ['an empty entry', {}],
    ['an entry that is not an object', 'una stringa'],
    ['a null decision', { sentenzaRef: null }],
    ['a decision with an unknown key', { sentenzaRef: { ...SENTENZA, testo: 'il testo intero' } }],
    ['a norm that is an array', { articleRef: [NORMA] }],
  ])('refuses %s, writes nothing and leaves the entry pending', async (_label, entry) => {
    const take = await suggestAndTake([{ articleRef: NORMA }, entry]);
    expect(take.status).toBe(400);
    expect(await prisma.dossier.count({ where: { userId: alice.id } })).toBe(0);
    expect(await prisma.suggestionItem.count({ where: { status: 'pending' } })).toBe(1);
  });

  it('refuses the whole suggestion when one decision entry is not valid, and writes nothing', async () => {
    const take = await suggestAndTake([{ articleRef: NORMA }, { sentenzaRef: { ...SENTENZA, corte: 'tar' } }]);
    expect(take.status).toBe(400);
    expect(await prisma.dossier.count({ where: { userId: alice.id } })).toBe(0);
    const pending = await prisma.suggestionItem.count({ where: { status: 'pending' } });
    expect(pending).toBe(1);
  });
});
