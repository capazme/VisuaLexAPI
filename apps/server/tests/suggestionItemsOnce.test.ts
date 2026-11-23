import { beforeEach, describe, expect, it } from 'vitest';
import { app, authHeader, createSharedEnv, createTestUser, prisma, request, type TestUser } from './helpers';

/**
 * A suggestion item is reviewed once (item 15 of the security inventory). Two quick clicks on «prendi», or a «prendi»
 * and a «rifiuta» at the same moment, used to both pass the «still pending» check: the owner got the note twice, or a
 * taken item ended up marked as declined. Each review now claims the item in one conditional write.
 */
describe('a suggestion item reviewed at the same moment twice', () => {
  let owner: TestUser;
  let suggester: TestUser;
  let suggestionId: string;
  let itemId: string;
  let aliasItemId: string;

  beforeEach(async () => {
    owner = await createTestUser('once-owner');
    suggester = await createTestUser('once-suggester');
    const envId = (await createSharedEnv(owner)).id;
    const created = await request(app).post(`/api/shared-environments/${envId}/suggestions`).set(authHeader(suggester))
      .send({ items: [
        // A note: nothing unique in it, so only the claim stops a second copy.
        { itemType: 'annotation', payload: { normaKey: 'codice_civile', articleId: '1453', text: 'Nota proposta' } },
        { itemType: 'alias', payload: { trigger: 'cc', aliasType: 'shortcut', expandTo: 'codice civile' } },
      ] });
    expect(created.status).toBe(201);
    suggestionId = created.body.id;
    itemId = created.body.items[0].id;
    aliasItemId = created.body.items[1].id;
  });

  const take = () => request(app).post(`/api/shared-environments-suggestions/${suggestionId}/items/${itemId}/take`).set(authHeader(owner));
  const decline = () => request(app).post(`/api/shared-environments-suggestions/${suggestionId}/items/${itemId}/decline`)
    .set(authHeader(owner)).send({ reviewNote: 'No' });
  const revoke = () => request(app).delete(`/api/shared-environments-suggestions/${suggestionId}/items/${itemId}`).set(authHeader(suggester));

  const notes = () => prisma.annotation.count({ where: { userId: owner.id } });

  it('three «prendi» at once: one is taken, the others are told it was already reviewed, and one note exists', async () => {
    const answers = await Promise.all([take(), take(), take()]);
    expect(answers.map((a) => a.status).sort()).toEqual([200, 409, 409]);
    expect(await notes()).toBe(1);
    expect((await prisma.suggestionItem.findUniqueOrThrow({ where: { id: itemId } })).status).toBe('taken');
  });

  it('«prendi» and «rifiuta» at once: exactly one wins, and the item says which', async () => {
    const [took, declined] = await Promise.all([take(), decline()]);
    expect([took.status, declined.status].sort()).toEqual([200, 409]);
    const item = await prisma.suggestionItem.findUniqueOrThrow({ where: { id: itemId } });
    if (took.status === 200) {
      expect(item.status).toBe('taken');
      expect(await notes()).toBe(1);
    } else {
      expect(item.status).toBe('declined');
      expect(await notes()).toBe(0);
    }
  });

  it('«prendi» and a revoke at once: never a note from an item that no longer exists', async () => {
    const [took, revoked] = await Promise.all([take(), revoke()]);
    const item = await prisma.suggestionItem.findUnique({ where: { id: itemId } });
    if (took.status === 200) {
      expect(revoked.status).toBe(403);
      expect(item?.status).toBe('taken');
      expect(await notes()).toBe(1);
    } else {
      expect(revoked.status).toBe(204);
      expect(item).toBeNull();
      expect(await notes()).toBe(0);
    }
  });

  it('a take that fails (a trigger already in use) leaves the item pending, as before', async () => {
    await prisma.customAlias.create({ data: { userId: owner.id, trigger: 'cc', aliasType: 'shortcut', expandTo: 'altro' } });
    const takeAlias = await request(app).post(`/api/shared-environments-suggestions/${suggestionId}/items/${aliasItemId}/take`).set(authHeader(owner));
    expect(takeAlias.status).toBe(409);
    expect(takeAlias.body.error).toBe('alias_trigger_conflict');
    expect((await prisma.suggestionItem.findUniqueOrThrow({ where: { id: aliasItemId } })).status).toBe('pending');
  });
});
