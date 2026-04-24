import { describe, it, expect, beforeEach } from 'vitest';
import { request, app, createTestUser, authHeader, createSharedEnv, prisma, type TestUser } from './helpers';

describe('alias trigger conflict on take', () => {
  let alice: TestUser;
  let bob: TestUser;
  let envId: string;

  beforeEach(async () => {
    alice = await createTestUser('alice');
    bob = await createTestUser('bob');
    envId = (await createSharedEnv(alice)).id;
  });

  it('returns 409 with resolution payload when alice already owns trigger "cc"', async () => {
    await prisma.customAlias.create({
      data: {
        userId: alice.id,
        trigger: 'cc',
        aliasType: 'shortcut',
        expandTo: 'codice civile',
      },
    });

    const create = await request(app)
      .post(`/api/shared-environments/${envId}/suggestions`)
      .set(authHeader(bob))
      .send({
        items: [{
          itemType: 'alias',
          payload: { trigger: 'cc', aliasType: 'reference', expandTo: 'Civil Code', description: 'mine' },
        }],
      });
    const itemId = create.body.items[0].id;

    const take = await request(app)
      .post(`/api/shared-environments-suggestions/${create.body.id}/items/${itemId}/take`)
      .set(authHeader(alice));

    expect(take.status).toBe(409);
    expect(take.body.error).toBe('alias_trigger_conflict');
    expect(take.body.suggestedTrigger).toBe('cc');
    expect(take.body.existingAliasId).toBeTruthy();
  });

  it('item status stays pending after a 409 conflict (no half-state)', async () => {
    await prisma.customAlias.create({
      data: { userId: alice.id, trigger: 'cc', aliasType: 'shortcut', expandTo: 'civile' },
    });
    const create = await request(app)
      .post(`/api/shared-environments/${envId}/suggestions`)
      .set(authHeader(bob))
      .send({ items: [{ itemType: 'alias', payload: { trigger: 'cc', aliasType: 'shortcut', expandTo: 'x' } }] });
    const itemId = create.body.items[0].id;

    await request(app)
      .post(`/api/shared-environments-suggestions/${create.body.id}/items/${itemId}/take`)
      .set(authHeader(alice));

    const item = await prisma.suggestionItem.findUnique({ where: { id: itemId } });
    expect(item?.status).toBe('pending');
  });
});
