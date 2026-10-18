import { describe, expect, it } from 'vitest';
import { authHeader, createTestUser, prisma, request, app } from './helpers';

// The personal environments are read-only on the server since the Forum absorbed them: nothing
// creates or edits one any more (the web and MCP clients call neither), so POST and PUT are gone.
// Reading, deleting and recovering an archived environment stay.

describe('/api/environments: no create or edit route', () => {
  it('POST /api/environments is not a route any more', async () => {
    const alice = await createTestUser('env_post_gone');
    const res = await request(app)
      .post('/api/environments')
      .set(authHeader(alice))
      .send({ name: 'Nuovo ambiente' });
    expect(res.status).toBe(404);
    expect(await prisma.environment.count({ where: { userId: alice.id } })).toBe(0);
  });

  it('PUT /api/environments/:id is not a route any more', async () => {
    const alice = await createTestUser('env_put_gone');
    const env = await prisma.environment.create({
      data: { name: 'Archivio', userId: alice.id, content: {} },
    });
    const res = await request(app)
      .put(`/api/environments/${env.id}`)
      .set(authHeader(alice))
      .send({ name: 'Rinominato' });
    expect(res.status).toBe(404);
    const after = await prisma.environment.findUnique({ where: { id: env.id } });
    expect(after?.name).toBe('Archivio');
  });

  it('GET /api/environments still lists the owner’s archive', async () => {
    const alice = await createTestUser('env_get_kept');
    await prisma.environment.create({ data: { name: 'Archivio', userId: alice.id, content: {} } });
    const res = await request(app).get('/api/environments').set(authHeader(alice));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain('Archivio');
  });
});
