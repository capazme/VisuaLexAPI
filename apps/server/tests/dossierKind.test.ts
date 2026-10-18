import { beforeEach, describe, expect, it } from 'vitest';
import { app, authHeader, createSharedEnv, createTestUser, prisma, request, type TestUser } from './helpers';

// A dossier di lavoro or di studio, and the dossier's copy in the Forum (spec
// docs/superpowers/specs/2026-10-13-environments-into-forum-design.md, D2 and D4).

describe('the kind of a dossier', () => {
  let alice: TestUser;

  beforeEach(async () => {
    alice = await createTestUser('kind-alice');
  });

  const create = (body: object) => request(app).post('/api/dossiers').set(authHeader(alice)).send(body);

  it('is «lavoro» unless the creation says «studio»', async () => {
    const work = await create({ name: 'Pratica' });
    const study = await create({ name: 'GDPR', kind: 'studio' });
    expect(work.status).toBe(201);
    expect(work.body.kind).toBe('lavoro');
    expect(study.body.kind).toBe('studio');
    const list = await request(app).get('/api/dossiers').set(authHeader(alice));
    expect(list.body.map((d: { name: string; kind: string }) => [d.name, d.kind]).sort()).toEqual([
      ['GDPR', 'studio'],
      ['Pratica', 'lavoro'],
    ]);
  });

  it('refuses a kind it does not know', async () => {
    expect((await create({ name: 'X', kind: 'pratica' })).status).toBe(400);
    const id = (await create({ name: 'Y' })).body.id;
    expect((await request(app).put(`/api/dossiers/${id}`).set(authHeader(alice)).send({ kind: 'altro' })).status).toBe(400);
  });

  it('changes in «Modifica», and only when named', async () => {
    const id = (await create({ name: 'Pratica' })).body.id;
    const changed = await request(app).put(`/api/dossiers/${id}`).set(authHeader(alice)).send({ kind: 'studio' });
    expect(changed.body.kind).toBe('studio');
    const renamed = await request(app).put(`/api/dossiers/${id}`).set(authHeader(alice)).send({ name: 'Studio' });
    expect(renamed.body.kind).toBe('studio');
  });

  it('survives the trash: a dossier di studio restores as one', async () => {
    const id = (await create({ name: 'GDPR', kind: 'studio' })).body.id;
    const trashed = await request(app).delete(`/api/dossiers/${id}`).set(authHeader(alice));
    expect(trashed.status).toBe(200);
    const restored = await request(app).post(`/api/trash/${trashed.body.trashId}/restore`).set(authHeader(alice)).send({});
    expect(restored.status).toBe(200);
    expect((await prisma.dossier.findUniqueOrThrow({ where: { id } })).kind).toBe('studio');
  });

  it('restores a dossier trashed before kinds existed as a dossier di lavoro', async () => {
    const id = (await create({ name: 'Vecchio', kind: 'studio' })).body.id;
    const trashId = (await request(app).delete(`/api/dossiers/${id}`).set(authHeader(alice))).body.trashId;
    const entry = await prisma.trashEntry.findUniqueOrThrow({ where: { id: trashId } });
    const payload = entry.payload as { dossier: Record<string, unknown> };
    delete payload.dossier.kind;
    await prisma.trashEntry.update({ where: { id: trashId }, data: { payload: payload as object } });
    await request(app).post(`/api/trash/${trashId}/restore`).set(authHeader(alice)).send({});
    expect((await prisma.dossier.findUniqueOrThrow({ where: { id } })).kind).toBe('lavoro');
  });
});

describe('the dossier\'s copy in the Forum', () => {
  let alice: TestUser;
  let bob: TestUser;
  let dossierId: string;

  beforeEach(async () => {
    alice = await createTestUser('copy-alice');
    bob = await createTestUser('copy-bob');
    dossierId = (await request(app).post('/api/dossiers').set(authHeader(alice)).send({ name: 'Studio' })).body.id;
  });

  const read = () => request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(alice));

  it('is null for a dossier never published', async () => {
    expect((await read()).body.published).toBeNull();
  });

  it('names the copy, its version and whether it is withdrawn', async () => {
    const env = await createSharedEnv(alice);
    await prisma.sharedEnvironment.update({ where: { id: env.id }, data: { sourceDossierId: dossierId, currentVersion: 3 } });
    expect((await read()).body.published).toMatchObject({ shared_environment_id: env.id, version: 3, is_active: true });
    await prisma.sharedEnvironment.update({ where: { id: env.id }, data: { isActive: false } });
    expect((await read()).body.published).toMatchObject({ shared_environment_id: env.id, is_active: false });
    const list = await request(app).get('/api/dossiers').set(authHeader(alice));
    expect(list.body[0].published.shared_environment_id).toBe(env.id);
  });

  it('is one per dossier', async () => {
    const one = await createSharedEnv(alice);
    const two = await createSharedEnv(alice);
    await prisma.sharedEnvironment.update({ where: { id: one.id }, data: { sourceDossierId: dossierId } });
    await expect(prisma.sharedEnvironment.update({ where: { id: two.id }, data: { sourceDossierId: dossierId } })).rejects.toThrow();
  });

  it('stays published when the dossier goes to the trash, and is linked again on restore', async () => {
    const env = await createSharedEnv(alice);
    await prisma.sharedEnvironment.update({ where: { id: env.id }, data: { sourceDossierId: dossierId } });
    const trashId = (await request(app).delete(`/api/dossiers/${dossierId}`).set(authHeader(alice))).body.trashId;
    const meanwhile = await prisma.sharedEnvironment.findUniqueOrThrow({ where: { id: env.id } });
    expect(meanwhile.sourceDossierId).toBeNull();
    expect(meanwhile.isActive).toBe(true);
    await request(app).post(`/api/trash/${trashId}/restore`).set(authHeader(alice)).send({});
    expect((await read()).body.published.shared_environment_id).toBe(env.id);
  });

  it.each([
    ['given to someone else', (id: string) => prisma.sharedEnvironment.update({ where: { id }, data: { userId: bob.id } })],
    ['deleted', (id: string) => prisma.sharedEnvironment.delete({ where: { id } })],
  ])('is not linked again when the copy was meanwhile %s', async (_label, meanwhile) => {
    const env = await createSharedEnv(alice);
    await prisma.sharedEnvironment.update({ where: { id: env.id }, data: { sourceDossierId: dossierId } });
    const trashId = (await request(app).delete(`/api/dossiers/${dossierId}`).set(authHeader(alice))).body.trashId;
    await meanwhile(env.id);
    const restored = await request(app).post(`/api/trash/${trashId}/restore`).set(authHeader(alice)).send({});
    expect(restored.status).toBe(200);
    expect((await read()).body.published).toBeNull();
  });

  it('is never shown to someone else', async () => {
    const env = await createSharedEnv(alice);
    await prisma.sharedEnvironment.update({ where: { id: env.id }, data: { sourceDossierId: dossierId } });
    expect((await request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(bob))).status).toBe(404);
  });
});

describe('a dossier taken from a Forum suggestion', () => {
  it('is a dossier di studio: someone else\'s proposal', async () => {
    const alice = await createTestUser('take-alice');
    const bob = await createTestUser('take-bob');
    const envId = (await createSharedEnv(alice)).id;
    const created = await request(app).post(`/api/shared-environments/${envId}/suggestions`).set(authHeader(bob))
      .send({ items: [{ itemType: 'dossier', payload: { title: 'Ricerca', entries: [{ note: 'da rileggere' }] } }] });
    expect(created.status).toBe(201);
    const take = await request(app)
      .post(`/api/shared-environments-suggestions/${created.body.id}/items/${created.body.items[0].id}/take`)
      .set(authHeader(alice));
    expect(take.status).toBe(200);
    const dossier = await prisma.dossier.findFirstOrThrow({ where: { userId: alice.id } });
    expect(dossier.kind).toBe('studio');
  });
});
