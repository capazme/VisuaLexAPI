import { describe, expect, it } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from './helpers';

/**
 * Another user's task, dossier, entry or parent is «not found» on every task route: never read,
 * never changed, never used as a parent or a list. Each case checks the victim's row afterwards.
 */

async function victimSetup() {
  const victim = await createTestUser(`victim-${Math.random().toString(36).slice(2, 8)}`);
  const attacker = await createTestUser(`attacker-${Math.random().toString(36).slice(2, 8)}`);
  const dossier = await prisma.dossier.create({ data: { name: 'Pratica Rossi', userId: victim.id } });
  const item = await prisma.dossierItem.create({ data: { dossierId: dossier.id, itemType: 'note', title: 'Nota', position: 0 } });
  const task = await prisma.task.create({
    data: { userId: victim.id, dossierId: dossier.id, dossierItemId: item.id, title: 'Chiamare il sig. Rossi', plannedDate: new Date('2026-10-20T00:00:00.000Z') },
  });
  const own = await prisma.dossier.create({ data: { name: 'Mia', userId: attacker.id } });
  const ownTask = await prisma.task.create({ data: { userId: attacker.id, title: 'mio' } });
  return { victim, attacker, dossier, item, task, own, ownTask };
}

async function unchanged(taskId: string, before: object) {
  expect(await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).toEqual(before);
}

const as = (user: TestUser) => authHeader(user);

describe('task IDOR', () => {
  it('cannot read another user’s task, alone or through their dossier', async () => {
    const { attacker, dossier, task } = await victimSetup();
    const read = await request(app).get(`/api/tasks/${task.id}`).set(as(attacker));
    expect(read.status).toBe(404);
    expect(JSON.stringify(read.body)).not.toContain('Rossi');
    const list = await request(app).get('/api/tasks').query({ view: 'dossier', dossierId: dossier.id }).set(as(attacker));
    expect(list.status).toBe(404);
    for (const name of ['today', 'upcoming', 'inbox', 'trash']) {
      const res = await request(app).get('/api/tasks').query({ view: name }).set(as(attacker));
      expect(res.body.tasks.map((t: { id: string }) => t.id)).not.toContain(task.id);
    }
  });

  it('cannot change, tick, reopen, reorder or trash another user’s task', async () => {
    const { attacker, task, ownTask } = await victimSetup();
    const before = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    const calls = [
      request(app).put(`/api/tasks/${task.id}`).set(as(attacker)).send({ title: 'pwned' }),
      request(app).post(`/api/tasks/${task.id}/complete`).set(as(attacker)),
      request(app).post(`/api/tasks/${task.id}/reopen`).set(as(attacker)),
      request(app).delete(`/api/tasks/${task.id}`).set(as(attacker)),
      request(app).post('/api/tasks/reorder').set(as(attacker)).send({ taskIds: [ownTask.id, task.id] }),
    ];
    for (const call of calls) expect((await call).status).toBe(404);
    await unchanged(task.id, before);
    // The reorder refused all: the attacker's own task did not move either.
    expect((await prisma.task.findUniqueOrThrow({ where: { id: ownTask.id } })).position).toBe(0);
  });

  it('cannot restore another user’s task from the trash', async () => {
    const { victim, attacker, task } = await victimSetup();
    await request(app).delete(`/api/tasks/${task.id}`).set(as(victim)).expect(200);
    const before = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect((await request(app).post(`/api/tasks/${task.id}/restore`).set(as(attacker))).status).toBe(404);
    await unchanged(task.id, before);
  });

  it('cannot file a task under another user’s dossier, entry or parent', async () => {
    const { attacker, dossier, item, task, own } = await victimSetup();
    const attempts = [
      { title: 'x', dossierId: dossier.id },
      { title: 'x', dossierId: own.id, dossierItemId: item.id },
      { title: 'x', parentId: task.id },
    ];
    for (const body of attempts) {
      expect((await request(app).post('/api/tasks').set(as(attacker)).send(body)).status).toBe(404);
    }
    expect(await prisma.task.count({ where: { userId: attacker.id } })).toBe(1);
    expect(await prisma.task.count({ where: { dossierId: dossier.id } })).toBe(1);
  });

  it('cannot move an own task under another user’s dossier, entry or parent', async () => {
    const { attacker, dossier, item, task, own, ownTask } = await victimSetup();
    const before = await prisma.task.findUniqueOrThrow({ where: { id: ownTask.id } });
    const attempts = [{ dossierId: dossier.id }, { dossierId: own.id, dossierItemId: item.id }, { parentId: task.id }];
    for (const body of attempts) {
      expect((await request(app).put(`/api/tasks/${ownTask.id}`).set(as(attacker)).send(body)).status).toBe(404);
    }
    await unchanged(ownTask.id, before);
    expect(await prisma.task.count({ where: { parentId: task.id } })).toBe(0);
  });
});
