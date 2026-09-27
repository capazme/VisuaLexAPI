import { describe, it, expect } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from './helpers';

/**
 * Regression tests for the dossier-item IDOR.
 *
 * The handlers verify that the dossier in the URL belongs to the caller, which
 * does NOT prove the item belongs to that dossier. Before the fix, an
 * authenticated user could pair their own dossier id with a victim's item id
 * and mutate or delete a row they do not own.
 */

async function dossierWithItem(owner: TestUser, title: string) {
  const dossier = await prisma.dossier.create({
    data: { name: `${title} dossier`, userId: owner.id },
  });
  const item = await prisma.dossierItem.create({
    data: { dossierId: dossier.id, itemType: 'norm', title, position: 0 },
  });
  return { dossier, item };
}

describe('dossier item IDOR', () => {
  it('does not let an attacker rename a victim item through their own dossier', async () => {
    const victim = await createTestUser('victim');
    const attacker = await createTestUser('attacker');
    const { item: victimItem } = await dossierWithItem(victim, 'victim-item');
    const { dossier: attackerDossier } = await dossierWithItem(attacker, 'attacker-item');

    const res = await request(app)
      .put(`/api/dossiers/${attackerDossier.id}/items/${victimItem.id}`)
      .set(authHeader(attacker))
      .send({ title: 'pwned' });

    expect(res.status).toBe(404);

    const after = await prisma.dossierItem.findUnique({ where: { id: victimItem.id } });
    expect(after?.title).toBe('victim-item');
  });

  it('does not let an attacker delete a victim item through their own dossier', async () => {
    const victim = await createTestUser('victim2');
    const attacker = await createTestUser('attacker2');
    const { item: victimItem } = await dossierWithItem(victim, 'victim-item-2');
    const { dossier: attackerDossier } = await dossierWithItem(attacker, 'attacker-item-2');

    const res = await request(app)
      .delete(`/api/dossiers/${attackerDossier.id}/items/${victimItem.id}`)
      .set(authHeader(attacker));

    expect(res.status).toBe(404);
    expect(await prisma.dossierItem.findUnique({ where: { id: victimItem.id } })).not.toBeNull();
  });

  it('does not let an attacker reorder a victim item through their own dossier', async () => {
    const victim = await createTestUser('victim3');
    const attacker = await createTestUser('attacker3');
    const { item: victimItem } = await dossierWithItem(victim, 'victim-item-3');
    const { dossier: attackerDossier, item: attackerItem } = await dossierWithItem(attacker, 'attacker-item-3');

    const res = await request(app)
      .post(`/api/dossiers/${attackerDossier.id}/reorder`)
      .set(authHeader(attacker))
      .send({ itemIds: [victimItem.id, attackerItem.id] });

    expect(res.status).toBe(404);

    const after = await prisma.dossierItem.findUnique({ where: { id: victimItem.id } });
    expect(after?.position).toBe(0);
  });

  it('does not let another user read or create snapshots on a dossier they do not own', async () => {
    const owner = await createTestUser('snapshot-owner');
    const attacker = await createTestUser('snapshot-attacker');
    const { dossier } = await dossierWithItem(owner, 'snapshot-item');

    const list = await request(app)
      .get(`/api/dossiers/${dossier.id}/snapshots`)
      .set(authHeader(attacker));
    expect(list.status).toBe(404);

    const create = await request(app)
      .post(`/api/dossiers/${dossier.id}/snapshots`)
      .set(authHeader(attacker))
      .send({});
    expect(create.status).toBe(404);

    expect(await prisma.dossierSnapshot.count({ where: { dossierId: dossier.id } })).toBe(0);
  });

  it('answers 400, not 500, to a snapshot label of the wrong type', async () => {
    const owner = await createTestUser('snapshot-label-owner');
    const { dossier } = await dossierWithItem(owner, 'snapshot-label-item');

    const bad = await request(app)
      .post(`/api/dossiers/${dossier.id}/snapshots`)
      .set(authHeader(owner))
      .send({ label: 42 });
    expect(bad.status).toBe(400);

    const good = await request(app)
      .post(`/api/dossiers/${dossier.id}/snapshots`)
      .set(authHeader(owner))
      .send({ label: '  Verifica  ' });
    expect(good.status).toBe(201);
    expect(good.body.label).toBe('Verifica');
  });

  it('still lets the owner update, reorder and delete their own items', async () => {
    const owner = await createTestUser('owner');
    const { dossier, item } = await dossierWithItem(owner, 'mine');

    const updated = await request(app)
      .put(`/api/dossiers/${dossier.id}/items/${item.id}`)
      .set(authHeader(owner))
      .send({ title: 'renamed' });
    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe('renamed');

    const reordered = await request(app)
      .post(`/api/dossiers/${dossier.id}/reorder`)
      .set(authHeader(owner))
      .send({ itemIds: [item.id] });
    expect(reordered.status).toBe(200);

    const removed = await request(app)
      .delete(`/api/dossiers/${dossier.id}/items/${item.id}`)
      .set(authHeader(owner));
    expect(removed.status).toBe(204);
    expect(await prisma.dossierItem.findUnique({ where: { id: item.id } })).toBeNull();
  });
});
