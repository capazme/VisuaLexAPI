import { beforeEach, describe, expect, it } from 'vitest';
import { app, authHeader, createTestUser, prisma, request, type TestUser } from './helpers';

// A recital in a dossier is a `norm` entry with the key `considerando` (spec
// docs/superpowers/specs/2026-11-17-eu-recitals-design.md §6.2, G-538): checked, titled with its citation.
const RECITAL = { tipo_atto: 'regolamento ue', numero_atto: '679', data: '2016', considerando: '26' };
const CITATION = 'considerando 26, reg. (UE) 2016/679';
const ARTICLE = { tipo_atto: 'regolamento ue', numero_atto: '679', data: '2016', numero_articolo: '5' };

describe('a recital as a dossier entry (spec 2026-11-17 §6.2)', () => {
  let owner: TestUser;
  let dossierId: string;

  beforeEach(async () => {
    owner = await createTestUser('recital-owner');
    dossierId = (await prisma.dossier.create({ data: { name: 'Pratica', userId: owner.id } })).id;
  });

  const add = (body: object) => request(app).post(`/api/dossiers/${dossierId}/items`).set(authHeader(owner)).send(body);
  const put = (itemId: string, body: object) =>
    request(app).put(`/api/dossiers/${dossierId}/items/${itemId}`).set(authHeader(owner)).send(body);

  it('stores it titled with its citation, whatever title was sent, and cites it', async () => {
    const res = await add({ itemType: 'norm', title: 'regolamento ue', content: RECITAL });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ item_type: 'norm', title: CITATION, content: RECITAL, citation: CITATION, act_citation: 'reg. (UE) 2016/679' });
    const read = await request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(owner));
    expect(read.body.items[0]).toMatchObject({ title: CITATION, citation: CITATION });
  });

  it.each([
    ['an article number beside it', { ...RECITAL, numero_articolo: '5' }, /una voce è un articolo o un considerando/],
    ['an annex', { ...RECITAL, allegato: 'I' }, /Campo «allegato» non ammesso/],
    ['an Italian act', { ...RECITAL, tipo_atto: 'legge' }, /Solo i regolamenti e le direttive/],
    ['a leading zero', { ...RECITAL, considerando: '026' }, /Numero del considerando non valido/],
    ['an empty number', { ...RECITAL, considerando: '' }, /Numero del considerando mancante/],
  ])('refuses %s in words', async (_what, content, reason) => {
    const res = await add({ itemType: 'norm', title: 'x', content });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(reason);
    expect(await prisma.dossierItem.count({ where: { dossierId } })).toBe(0);
  });

  it('keeps the star and the citation on a PUT, and ignores a forged title', async () => {
    const id = (await add({ itemType: 'norm', title: 'x', content: RECITAL })).body.id;
    const starred = await put(id, { content: { ...RECITAL, _dossierMeta: { important: true } } });
    expect(starred.status).toBe(200);
    expect(starred.body).toMatchObject({ title: CITATION, content: { ...RECITAL, _dossierMeta: { important: true } } });
    const forged = await put(id, { title: 'art. 26, reg. (UE) 2016/679' });
    expect(forged.status).toBe(200);
    expect(forged.body.title).toBe(CITATION);
  });

  it('never turns an article into a recital, nor a recital into an article', async () => {
    const recital = (await add({ itemType: 'norm', title: 'x', content: RECITAL })).body.id;
    const article = (await add({ itemType: 'norm', title: 'regolamento ue', content: ARTICLE })).body.id;
    const toArticle = await put(recital, { content: ARTICLE });
    expect(toArticle.status).toBe(400);
    expect(JSON.stringify(toArticle.body)).toMatch(/Una voce resta un articolo o un considerando/);
    const toRecital = await put(article, { content: RECITAL });
    expect(toRecital.status).toBe(400);
    expect((await prisma.dossierItem.findUniqueOrThrow({ where: { id: article } })).content).toEqual(ARTICLE);
  });

  it('stores an article and titles it as before (a pin)', async () => {
    const res = await add({ itemType: 'norm', title: 'regolamento ue', content: ARTICLE });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'regolamento ue', content: ARTICLE, citation: 'art. 5, reg. (UE) 2016/679' });
  });

  it('takes a note about the whole recital (a pin)', async () => {
    const id = (await add({ itemType: 'norm', title: 'x', content: RECITAL })).body.id;
    const note = await request(app).post(`/api/dossiers/${dossierId}/notes`).set(authHeader(owner)).send({ text: 'Sul dato anonimo.', aboutItemId: id });
    expect(note.status).toBe(201);
    expect(note.body.about_item_id).toBe(id);
  });
});
