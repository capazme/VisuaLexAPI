import { describe, it, expect } from 'vitest';
import { request, app, prisma, createTestUser, authHeader } from './helpers';

/** Atti (draft for Alfred and Guglielmo): the CRUD, and that nobody reaches another user's act or dossier. */
describe('Atti (draft)', () => {
  it('creates, lists, reads, updates and deletes an act of the caller', async () => {
    const user = await createTestUser('atti-owner');
    const dossier = await prisma.dossier.create({ data: { name: 'Pratica', userId: user.id } });

    const created = await request(app).post('/api/atti').set(authHeader(user)).send({ titolo: '  Atto di appello ', tipo: 'Appello', dossierId: dossier.id });
    expect(created.status).toBe(201);
    expect(created.body.atto).toMatchObject({ titolo: 'Atto di appello', tipo: 'Appello', testo: '', stato: 'bozza', dossierId: dossier.id });
    const attoId = created.body.atto.id;

    const list = await request(app).get(`/api/atti?dossierId=${dossier.id}`).set(authHeader(user));
    expect(list.status).toBe(200);
    expect(list.body.atti).toHaveLength(1);
    expect(list.body.atti[0].testo).toBeUndefined();

    const updated = await request(app).put(`/api/atti/${attoId}`).set(authHeader(user)).send({ testo: 'Primo motivo.', stato: 'finale' });
    expect(updated.status).toBe(200);
    expect(updated.body.atto).toMatchObject({ testo: 'Primo motivo.', stato: 'finale' });

    const read = await request(app).get(`/api/atti/${attoId}`).set(authHeader(user));
    expect(read.body.atto.testo).toBe('Primo motivo.');

    expect((await request(app).delete(`/api/atti/${attoId}`).set(authHeader(user))).status).toBe(204);
    expect(await prisma.atto.findUnique({ where: { id: attoId } })).toBeNull();
  });

  it('refuses an empty title, an unknown field and an unknown state', async () => {
    const user = await createTestUser('atti-checks');
    expect((await request(app).post('/api/atti').set(authHeader(user)).send({ titolo: '   ' })).status).toBe(400);
    expect((await request(app).post('/api/atti').set(authHeader(user)).send({ titolo: 'A', userId: 'x' })).status).toBe(400);
    const { body } = await request(app).post('/api/atti').set(authHeader(user)).send({ titolo: 'A' });
    expect((await request(app).put(`/api/atti/${body.atto.id}`).set(authHeader(user)).send({ stato: 'pubblicato' })).status).toBe(400);
  });

  it('answers 404 for another user act and for a dossier that is not the caller', async () => {
    const victim = await createTestUser('atti-victim');
    const attacker = await createTestUser('atti-attacker');
    const victimDossier = await prisma.dossier.create({ data: { name: 'Altrui', userId: victim.id } });
    const atto = await prisma.atto.create({ data: { userId: victim.id, titolo: 'Riservato', testo: 'segreto' } });

    expect((await request(app).get(`/api/atti/${atto.id}`).set(authHeader(attacker))).status).toBe(404);
    expect((await request(app).put(`/api/atti/${atto.id}`).set(authHeader(attacker)).send({ testo: 'x' })).status).toBe(404);
    expect((await request(app).delete(`/api/atti/${atto.id}`).set(authHeader(attacker))).status).toBe(404);
    expect((await request(app).post('/api/atti').set(authHeader(attacker)).send({ titolo: 'B', dossierId: victimDossier.id })).status).toBe(404);
    expect((await request(app).get(`/api/atti?dossierId=${victimDossier.id}`).set(authHeader(attacker))).status).toBe(404);
    const list = await request(app).get('/api/atti').set(authHeader(attacker));
    expect(list.body.atti).toHaveLength(0);
    expect((await prisma.atto.findUnique({ where: { id: atto.id } }))?.testo).toBe('segreto');
  });

  it('keeps the act when its dossier is deleted', async () => {
    const user = await createTestUser('atti-dossier-gone');
    const dossier = await prisma.dossier.create({ data: { name: 'Temporaneo', userId: user.id } });
    const atto = await prisma.atto.create({ data: { userId: user.id, titolo: 'Resta', dossierId: dossier.id } });
    await prisma.dossier.delete({ where: { id: dossier.id } });
    expect((await prisma.atto.findUnique({ where: { id: atto.id } }))?.dossierId).toBeNull();
  });

  it('needs a session', async () => {
    expect((await request(app).get('/api/atti')).status).toBe(401);
  });
});
