import { beforeEach, describe, expect, it } from 'vitest';
import { app, authHeader, createTestUser, prisma, request, type TestUser } from './helpers';

const SENTENZA = {
  corte: 'cassazione', archivio: 'penale', numero: 10787, anno: 2024, sezione: '7', tipo: 'sentenza',
  data_deposito: '2024-03-12', etichetta: 'Cass. pen., sez. VII, sent. dep. 12 marzo 2024, n. 10787',
};

describe('dossier items of type sentenza (design 2026-10-01 §6)', () => {
  let owner: TestUser;
  let dossierId: string;

  beforeEach(async () => {
    owner = await createTestUser('sentenza-owner');
    dossierId = (await prisma.dossier.create({ data: { name: 'Pratica', userId: owner.id } })).id;
  });

  const add = (body: object) =>
    request(app).post(`/api/dossiers/${dossierId}/items`).set(authHeader(owner)).send(body);

  it('keeps a decision: its identity and its label, never a text', async () => {
    const res = await add({ itemType: 'sentenza', title: 'ignorato', content: SENTENZA });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ item_type: 'sentenza', title: SENTENZA.etichetta, content: SENTENZA });
    // The server cites a decision as the web app does (source convention §4), for the MCP tools.
    expect(res.body).toMatchObject({ citation: SENTENZA.etichetta, act_citation: null });
  });

  it.each([
    ['an unknown court', { ...SENTENZA, corte: 'tar' }],
    ['a Cassazione decision without its archive', { ...SENTENZA, archivio: undefined }],
    ['number zero', { ...SENTENZA, numero: 0 }],
    ['a year in the future', { ...SENTENZA, anno: new Date().getFullYear() + 1 }],
    ['an unknown key', { ...SENTENZA, testo: 'il testo intero' }],
    ['a label too long', { ...SENTENZA, etichetta: 'x'.repeat(201) }],
    ['a date with no such month', { ...SENTENZA, data_deposito: '2024-13-05' }],
    ['a Corte costituzionale decision with a section',
      { corte: 'corte_costituzionale', numero: 1, anno: 2014, sezione: '3', etichetta: 'Corte cost. n. 1/2014' }],
    ['a Corte costituzionale decision before 1956',
      { corte: 'corte_costituzionale', numero: 1, anno: 1955, etichetta: 'Corte cost. n. 1/1955' }],
    ['a Corte costituzionale decision with an archive',
      { corte: 'corte_costituzionale', numero: 1, anno: 2014, archivio: 'civile', etichetta: 'Corte cost. n. 1/2014' }],
    ['a star that is not a boolean', { ...SENTENZA, _dossierMeta: { important: 'x' } }],
  ])('refuses %s', async (_label, content) => {
    const res = await add({ itemType: 'sentenza', title: 'x', content });
    expect(res.status).toBe(400);
    expect(await prisma.dossierItem.count({ where: { dossierId } })).toBe(0);
  });

  it('stores its own citation as the label, whatever the client sent (D9: «A ogni scrittura»)', async () => {
    const res = await add({ itemType: 'sentenza', title: 'x', content: { ...SENTENZA, etichetta: '<b>Cass.</b>' } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: SENTENZA.etichetta, content: { etichetta: SENTENZA.etichetta } });
  });

  it('carries the star in its envelope, checks an update like a creation, and keeps the title on the label', async () => {
    const created = await add({ itemType: 'sentenza', title: 'x', content: SENTENZA });
    const url = `/api/dossiers/${dossierId}/items/${created.body.id}`;
    // A section corrected: the label follows the identity, not the copy the client sent.
    const relabelled = { ...SENTENZA, sezione: '6', etichetta: 'Cass. pen., sez. VII, n. 10787/2024', _dossierMeta: { important: true } };
    const expected = { ...relabelled, etichetta: 'Cass. pen., sez. VI, sent. dep. 12 marzo 2024, n. 10787' };
    const starred = await request(app).put(url).set(authHeader(owner)).send({ title: 'altro', content: relabelled });
    expect(starred.status).toBe(200);
    expect(starred.body).toMatchObject({ title: expected.etichetta, content: expected, citation: expected.etichetta });
    const titleOnly = await request(app).put(url).set(authHeader(owner)).send({ title: 'altro' });
    expect(titleOnly.body.title).toBe(expected.etichetta);
    const broken = await request(app).put(url).set(authHeader(owner)).send({ content: { ...SENTENZA, numero: -1 } });
    expect(broken.status).toBe(400);
    const row = await prisma.dossierItem.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row).toMatchObject({ title: expected.etichetta, content: expected });
  });

  it('moves to another dossier, and goes into a snapshot, unchanged', async () => {
    const created = await add({ itemType: 'sentenza', title: 'x', content: SENTENZA });
    const other = (await prisma.dossier.create({ data: { name: 'Altra', userId: owner.id } })).id;
    const moved = await request(app).post(`/api/dossiers/${dossierId}/items/${created.body.id}/move`)
      .set(authHeader(owner)).send({ targetDossierId: other });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ item_type: 'sentenza', title: SENTENZA.etichetta, content: SENTENZA });
    const snapshot = await request(app).post(`/api/dossiers/${other}/snapshots`).set(authHeader(owner)).send({});
    expect(snapshot.status).toBe(201);
    const stored = await prisma.dossierSnapshot.findUniqueOrThrow({ where: { id: snapshot.body.id } });
    expect((stored.content as { items: unknown[] }).items).toEqual([
      expect.objectContaining({ itemType: 'sentenza', content: SENTENZA }),
    ]);
  });

  it('leaves norm items to their own rules', async () => {
    const res = await add({ itemType: 'norm', title: 'codice civile',
      content: { tipo_atto: 'codice civile', numero_articolo: '2043' } });
    expect(res.status).toBe(201);
  });
});
