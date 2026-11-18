import { describe, expect, it } from 'vitest';
import { app, authHeader, createTestUser, prisma, request, type TestUser } from './helpers';

/**
 * G-576, the owner's words: «Sì: 500 dossier, 2.000 voci per dossier e al massimo 10.000 voci in tutto per
 * account». Every path that creates dossiers or entries checks the three caps; a refusal is a 409 whose Italian
 * `detail` names the cap. The accounts are filled with Prisma, then the route under test is called once.
 */

async function fillDossiers(user: TestUser, count: number): Promise<void> {
  await prisma.dossier.createMany({ data: Array.from({ length: count }, (_, i) => ({ name: `Pratica ${i}`, userId: user.id })) });
}

async function dossierWith(user: TestUser, items: number, name = 'Piena'): Promise<string> {
  const dossier = await prisma.dossier.create({ data: { name, userId: user.id } });
  await prisma.dossierItem.createMany({
    data: Array.from({ length: items }, (_, i) => ({ dossierId: dossier.id, itemType: 'note' as const, title: 'Nota', content: 'x', position: i })),
  });
  return dossier.id;
}

const note = { itemType: 'note', title: 'Nota', content: 'testo' };

describe('at most 500 dossiers per account', () => {
  it('creates the 500th, refuses the 501st and names the cap', async () => {
    const user = await createTestUser('cap-dossiers');
    await fillDossiers(user, 499);
    expect((await request(app).post('/api/dossiers').set(authHeader(user)).send({ name: 'Ultima' })).status).toBe(201);
    const refused = await request(app).post('/api/dossiers').set(authHeader(user)).send({ name: 'Una di troppo' });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('dossier_limit');
    expect(refused.body.detail).toContain('500 pratiche');
    expect(await prisma.dossier.count({ where: { userId: user.id } })).toBe(500);
  });

  it('refuses an import that would pass the cap, and creates nothing', async () => {
    const user = await createTestUser('cap-dossiers-import');
    await fillDossiers(user, 499);
    const refused = await request(app).post('/api/dossiers/import-study').set(authHeader(user)).send({
      content: { dossiers: [{ title: 'Uno', items: [] }, { title: 'Due', items: [] }] },
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('dossier_limit');
    expect(await prisma.dossier.count({ where: { userId: user.id } })).toBe(499);
  });

  it('refuses to restore a dossier from the trash over the cap', async () => {
    const user = await createTestUser('cap-dossiers-trash');
    const created = await request(app).post('/api/dossiers').set(authHeader(user)).send({ name: 'Nel cestino' });
    const trashed = await request(app).delete(`/api/dossiers/${created.body.id}`).set(authHeader(user));
    expect(trashed.status).toBe(200);
    await fillDossiers(user, 500);
    const refused = await request(app).post(`/api/trash/${trashed.body.trashId}/restore`).set(authHeader(user)).send({});
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('dossier_limit');
  });
});

describe('at most 2,000 entries per dossier', () => {
  it('adds the 2,000th, refuses the 2,001st and names the cap', async () => {
    const user = await createTestUser('cap-items');
    const id = await dossierWith(user, 1999);
    expect((await request(app).post(`/api/dossiers/${id}/items`).set(authHeader(user)).send(note)).status).toBe(201);
    const refused = await request(app).post(`/api/dossiers/${id}/items`).set(authHeader(user)).send(note);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('dossier_items_limit');
    expect(refused.body.detail).toContain('2.000 voci');
    expect(await prisma.dossierItem.count({ where: { dossierId: id } })).toBe(2000);
  });

  it('refuses a note, and a move, into a full dossier', async () => {
    const user = await createTestUser('cap-items-move');
    const full = await dossierWith(user, 2000);
    const notes = await request(app).post(`/api/dossiers/${full}/notes`).set(authHeader(user)).send({ text: 'Una nota' });
    expect(notes.status).toBe(409);
    expect(notes.body.error).toBe('dossier_items_limit');
    const other = await dossierWith(user, 1, 'Altra');
    const item = await prisma.dossierItem.findFirstOrThrow({ where: { dossierId: other } });
    const moved = await request(app).post(`/api/dossiers/${other}/items/${item.id}/move`).set(authHeader(user)).send({ targetDossierId: full });
    expect(moved.status).toBe(409);
    expect(moved.body.error).toBe('dossier_items_limit');
    expect(await prisma.dossierItem.count({ where: { dossierId: other } })).toBe(1);
  });
});

describe('at most 10,000 entries per account', () => {
  it('refuses an entry over the total, in any dossier, and names the cap', async () => {
    const user = await createTestUser('cap-account');
    for (let d = 0; d < 5; d += 1) await dossierWith(user, 2000, `Piena ${d}`);
    const room = await dossierWith(user, 0, 'Vuota');
    const refused = await request(app).post(`/api/dossiers/${room}/items`).set(authHeader(user)).send(note);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('account_items_limit');
    expect(refused.body.detail).toContain('10.000 voci');
  });

  it('lets a move within the account through: it adds nothing to the total', async () => {
    const user = await createTestUser('cap-account-move');
    for (let d = 0; d < 4; d += 1) await dossierWith(user, 2000, `Piena ${d}`);
    const source = await dossierWith(user, 1999, 'Quasi');
    const target = await dossierWith(user, 1, 'Meta');
    const item = await prisma.dossierItem.findFirstOrThrow({ where: { dossierId: source } });
    const moved = await request(app).post(`/api/dossiers/${source}/items/${item.id}/move`).set(authHeader(user)).send({ targetDossierId: target });
    expect(moved.status).toBe(200);
  });

  it('refuses an import that would pass the total', async () => {
    const user = await createTestUser('cap-account-import');
    for (let d = 0; d < 5; d += 1) await dossierWith(user, 2000, `Piena ${d}`);
    const refused = await request(app).post('/api/dossiers/import-study').set(authHeader(user)).send({
      content: { dossiers: [{ title: 'Nuova', items: [{ type: 'norma', data: { tipo_atto: 'codice civile', numero_articolo: '2043' } }] }] },
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('account_items_limit');
  });
});
