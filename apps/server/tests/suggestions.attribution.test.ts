import { describe, it, expect, beforeEach } from 'vitest';
import { request, app, createTestUser, authHeader, createSharedEnv, prisma, type TestUser } from './helpers';

describe('attribution', () => {
  let alice: TestUser; // owner
  let bob: TestUser;   // suggester
  let envId: string;

  beforeEach(async () => {
    alice = await createTestUser('alice');
    bob = await createTestUser('bob');
    envId = (await createSharedEnv(alice)).id;
  });

  it('take annotation populates sourceSuggestionId + originalAuthorId', async () => {
    const create = await request(app)
      .post(`/api/shared-environments/${envId}/suggestions`)
      .set(authHeader(bob))
      .send({ items: [{ itemType: 'annotation', payload: { articleId: 'art-2043', text: 'nota' } }] });
    const sugId = create.body.id;
    const itemId = create.body.items[0].id;

    const take = await request(app)
      .post(`/api/shared-environments-suggestions/${sugId}/items/${itemId}/take`)
      .set(authHeader(alice));
    expect(take.status).toBe(200);

    const [ann] = await prisma.annotation.findMany({ where: { userId: alice.id } });
    expect(ann.sourceSuggestionId).toBe(sugId);
    expect(ann.originalAuthorId).toBe(bob.id);
  });

  it('deleting the suggester account sets originalAuthorId to null but the row stays', async () => {
    const create = await request(app)
      .post(`/api/shared-environments/${envId}/suggestions`)
      .set(authHeader(bob))
      .send({ items: [{ itemType: 'quickNorm', payload: { label: 'L', searchParams: {} } }] });
    await request(app)
      .post(`/api/shared-environments-suggestions/${create.body.id}/items/${create.body.items[0].id}/take`)
      .set(authHeader(alice));

    await prisma.user.delete({ where: { id: bob.id } });

    const qn = await prisma.quickNorm.findFirst({ where: { userId: alice.id } });
    expect(qn).toBeTruthy();
    expect(qn?.originalAuthorId).toBeNull();
    expect(qn?.sourceSuggestionId).toBeNull(); // cascade chain also sets this null
  });
});
