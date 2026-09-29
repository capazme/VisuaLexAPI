import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from './helpers';

/**
 * Regression tests for moving an item to another dossier.
 *
 * The move used to be a client-side `addItem` on the target plus `deleteItem`
 * on the source. That re-created the row: a new id, a new created_at, and a
 * window between the two calls where the item lived in both dossiers (delete
 * failed) or had vanished from both (add failed, since the optimistic store
 * move was never reverted). The endpoint moves the row in place, so the id,
 * the created_at and the content — including the `_dossierMeta` envelope that
 * carries the "important" star — survive.
 */

const norma = { tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '2043' };

async function dossierWithItems(owner: TestUser, name: string, contents: unknown[]) {
  const dossier = await prisma.dossier.create({ data: { name, userId: owner.id } });
  const items = [];
  for (const [index, content] of contents.entries()) {
    items.push(
      await prisma.dossierItem.create({
        data: {
          dossierId: dossier.id,
          itemType: 'norm',
          title: `${name}-item-${index}`,
          content: content as Prisma.InputJsonValue,
          position: index,
        },
      }),
    );
  }
  return { dossier, items };
}

describe('POST /dossiers/:id/items/:itemId/move', () => {
  it('moves the row itself, appending after the last item of the target', async () => {
    const owner = await createTestUser('move-owner');
    const { dossier: source, items: sourceItems } = await dossierWithItems(owner, 'src', [norma, norma, norma]);
    const { dossier: target, items: [lastTargetItem] } = await dossierWithItems(owner, 'dst', [norma]);
    await prisma.dossierItem.update({ where: { id: lastTargetItem.id }, data: { position: 5 } });

    const moved = sourceItems[1];
    const res = await request(app)
      .post(`/api/dossiers/${source.id}/items/${moved.id}/move`)
      .set(authHeader(owner))
      .send({ targetDossierId: target.id });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: moved.id,
      item_type: 'norm',
      title: moved.title,
      position: 6,
      created_at: moved.createdAt.toISOString(),
    });

    const after = await prisma.dossierItem.findUnique({ where: { id: moved.id } });
    expect(after?.dossierId).toBe(target.id);
    // The row was not re-created: same id, same added-at date.
    expect(after?.createdAt).toEqual(moved.createdAt);
    expect(await prisma.dossierItem.count({ where: { dossierId: source.id } })).toBe(2);
    expect(await prisma.dossierItem.count({ where: { dossierId: target.id } })).toBe(2);
  });

  it('keeps the content envelope, so a starred item arrives starred', async () => {
    const owner = await createTestUser('move-star-owner');
    const starred = { ...norma, _dossierMeta: { important: true } };
    const { dossier: source, items: [item] } = await dossierWithItems(owner, 'star-src', [starred]);
    const { dossier: target } = await dossierWithItems(owner, 'star-dst', []);

    const res = await request(app)
      .post(`/api/dossiers/${source.id}/items/${item.id}/move`)
      .set(authHeader(owner))
      .send({ targetDossierId: target.id });

    expect(res.status).toBe(200);
    expect(res.body.content).toEqual(starred);
    const after = await prisma.dossierItem.findUnique({ where: { id: item.id } });
    expect(after?.content).toEqual(starred);
  });

  it('appends at position 0 when the target is empty', async () => {
    const owner = await createTestUser('move-empty-owner');
    const { dossier: source, items: [item] } = await dossierWithItems(owner, 'empty-src', [norma]);
    const { dossier: target } = await dossierWithItems(owner, 'empty-dst', []);

    const res = await request(app)
      .post(`/api/dossiers/${source.id}/items/${item.id}/move`)
      .set(authHeader(owner))
      .send({ targetDossierId: target.id });

    expect(res.status).toBe(200);
    expect(res.body.position).toBe(0);
  });

  it('refuses to move an item into a dossier the caller does not own', async () => {
    const owner = await createTestUser('move-victim-dossier-owner');
    const attacker = await createTestUser('move-attacker');
    const { items: [victimItem] } = await dossierWithItems(owner, 'defended', [norma]);
    const { dossier: attackerSource } = await dossierWithItems(attacker, 'attacker-src', []);
    const { dossier: attackerTarget } = await dossierWithItems(attacker, 'attacker-dst', []);

    const res = await request(app)
      .post(`/api/dossiers/${attackerTarget.id}/items/${victimItem.id}/move`)
      .set(authHeader(attacker))
      .send({ targetDossierId: attackerSource.id });

    expect(res.status).toBe(404);
    const after = await prisma.dossierItem.findUnique({ where: { id: victimItem.id } });
    expect(after?.dossierId).not.toBe(attackerSource.id);
  });

  it('refuses to move an item into a dossier owned by someone else', async () => {
    const victim = await createTestUser('move-victim-target');
    const attacker = await createTestUser('move-attacker-source');
    const { dossier: victimDossier } = await dossierWithItems(victim, 'victim-target', []);
    const { dossier: attackerDossier, items: [attackerItem] } = await dossierWithItems(attacker, 'attacker-item', [norma]);

    const res = await request(app)
      .post(`/api/dossiers/${attackerDossier.id}/items/${attackerItem.id}/move`)
      .set(authHeader(attacker))
      .send({ targetDossierId: victimDossier.id });

    expect(res.status).toBe(404);
    const after = await prisma.dossierItem.findUnique({ where: { id: attackerItem.id } });
    expect(after?.dossierId).toBe(attackerDossier.id);
  });

  it('refuses to move an item that does not belong to the dossier in the URL', async () => {
    const owner = await createTestUser('move-wrong-dossier-owner');
    const { dossier: other, items: [otherItem] } = await dossierWithItems(owner, 'other', [norma]);
    const { dossier: source } = await dossierWithItems(owner, 'source', []);
    const { dossier: target } = await dossierWithItems(owner, 'target', []);

    const res = await request(app)
      .post(`/api/dossiers/${source.id}/items/${otherItem.id}/move`)
      .set(authHeader(owner))
      .send({ targetDossierId: target.id });

    expect(res.status).toBe(404);
    const after = await prisma.dossierItem.findUnique({ where: { id: otherItem.id } });
    expect(after?.dossierId).toBe(other.id);
  });

  it('answers 400 to a missing target and to a move onto the same dossier', async () => {
    const owner = await createTestUser('move-bad-request-owner');
    const { dossier: source, items: [item] } = await dossierWithItems(owner, 'bad-request', [norma]);

    const missing = await request(app)
      .post(`/api/dossiers/${source.id}/items/${item.id}/move`)
      .set(authHeader(owner))
      .send({});
    expect(missing.status).toBe(400);

    const sameDossier = await request(app)
      .post(`/api/dossiers/${source.id}/items/${item.id}/move`)
      .set(authHeader(owner))
      .send({ targetDossierId: source.id });
    expect(sameDossier.status).toBe(400);

    const after = await prisma.dossierItem.findUnique({ where: { id: item.id } });
    expect(after?.dossierId).toBe(source.id);
    expect(after?.position).toBe(0);
  });

  it('requires authentication', async () => {
    const owner = await createTestUser('move-anon-owner');
    const { dossier: source, items: [item] } = await dossierWithItems(owner, 'anon', [norma]);
    const { dossier: target } = await dossierWithItems(owner, 'anon-target', []);

    const res = await request(app)
      .post(`/api/dossiers/${source.id}/items/${item.id}/move`)
      .send({ targetDossierId: target.id });

    expect(res.status).toBe(401);
  });
});
