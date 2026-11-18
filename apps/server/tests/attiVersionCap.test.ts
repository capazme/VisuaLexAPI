import { describe, expect, it } from 'vitest';
import { app, authHeader, createTestUser, prisma, request, type TestUser } from './helpers';
import { MAX_ATTI_PER_USER } from '../src/routes/atti';

/**
 * Atti on the server (item 13 of the security inventory): two tabs on one act no longer overwrite each other in
 * silence, and an account holds at most MAX_ATTI_PER_USER acts.
 */
const create = (user: TestUser, titolo = 'Atto') => request(app).post('/api/atti').set(authHeader(user)).send({ titolo });
const save = (user: TestUser, id: string, body: object) => request(app).put(`/api/atti/${id}`).set(authHeader(user)).send(body);

describe('two tabs saving the same act', () => {
  it('refuses with 409 the save of a tab whose copy is older, writes nothing, and gives back the act as it is', async () => {
    const user = await createTestUser('atti-tabs');
    const loaded = (await create(user)).body.atto;

    const first = await save(user, loaded.id, { testo: 'Scritto nella prima scheda.', baseUpdatedAt: loaded.updatedAt });
    expect(first.status).toBe(200);

    const second = await save(user, loaded.id, { testo: 'Scritto nella seconda scheda.', baseUpdatedAt: loaded.updatedAt });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('conflict');
    expect(second.body.atto.testo).toBe('Scritto nella prima scheda.');
    expect(second.body.atto.updatedAt).toBe(first.body.atto.updatedAt);
    expect((await prisma.atto.findUniqueOrThrow({ where: { id: loaded.id } })).testo).toBe('Scritto nella prima scheda.');
  });

  it('takes the save of a tab whose copy is the current one, and each save gives the version to send next', async () => {
    const user = await createTestUser('atti-chain');
    const loaded = (await create(user)).body.atto;
    const first = await save(user, loaded.id, { testo: 'Uno.', baseUpdatedAt: loaded.updatedAt });
    const second = await save(user, loaded.id, { testo: 'Due.', baseUpdatedAt: first.body.atto.updatedAt });
    expect(second.status).toBe(200);
    expect(second.body.atto.testo).toBe('Due.');
  });

  it('saves as before when the field is absent (the web until it sends it)', async () => {
    const user = await createTestUser('atti-legacy');
    const loaded = (await create(user)).body.atto;
    await save(user, loaded.id, { testo: 'Uno.' });
    expect((await save(user, loaded.id, { testo: 'Due.' })).status).toBe(200);
  });

  it('answers 404, never 409, for another user’s act, whatever version it names', async () => {
    const owner = await createTestUser('atti-owner-v');
    const other = await createTestUser('atti-other-v');
    const loaded = (await create(owner)).body.atto;
    const response = await save(other, loaded.id, { testo: 'Altrui.', baseUpdatedAt: '2020-01-01T00:00:00.000Z' });
    expect(response.status).toBe(404);
    expect(response.body.atto).toBeUndefined();
  });

  it('refuses a version that is not a date', async () => {
    const user = await createTestUser('atti-bad-version');
    const loaded = (await create(user)).body.atto;
    expect((await save(user, loaded.id, { testo: 'x', baseUpdatedAt: 'ieri' })).status).toBe(400);
  });
});

describe('how many acts an account holds', () => {
  it(`refuses the act after the ${MAX_ATTI_PER_USER}th with 409, and creates again once one is deleted`, async () => {
    const user = await createTestUser('atti-cap');
    const other = await createTestUser('atti-cap-other');
    await prisma.atto.createMany({
      data: Array.from({ length: MAX_ATTI_PER_USER }, (_, i) => ({ userId: user.id, titolo: `Atto ${i}` })),
    });

    const refused = await create(user, 'Uno di troppo');
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('atti_limit');
    expect(refused.body.detail).toContain(String(MAX_ATTI_PER_USER));
    expect(await prisma.atto.count({ where: { userId: user.id } })).toBe(MAX_ATTI_PER_USER);
    expect((await create(other)).status).toBe(201);

    const one = await prisma.atto.findFirstOrThrow({ where: { userId: user.id } });
    expect((await request(app).delete(`/api/atti/${one.id}`).set(authHeader(user))).status).toBe(204);
    expect((await create(user, 'Ora sì')).status).toBe(201);
  });

  it('keeps every act in the list: the cap is not above what the list shows', async () => {
    const user = await createTestUser('atti-cap-list');
    await prisma.atto.createMany({
      data: Array.from({ length: MAX_ATTI_PER_USER }, (_, i) => ({ userId: user.id, titolo: `Atto ${i}` })),
    });
    const list = await request(app).get('/api/atti').set(authHeader(user));
    expect(list.body.atti).toHaveLength(MAX_ATTI_PER_USER);
  });
});
