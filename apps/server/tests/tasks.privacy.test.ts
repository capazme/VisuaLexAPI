import { describe, expect, it } from 'vitest';
import { request, app, prisma, createTestUser, authHeader } from './helpers';
import { delegated } from './delegatedHelper';

/**
 * Tasks may hold clients' names: the same rules as dossiers (answer 13 on the task model). They are
 * in the user's export and nobody else's, they go with the account, they follow their dossier into
 * the trash and back, and no connected application reaches them in wave 1.
 */

describe('tasks and the account', () => {
  it('the export carries the user’s own tasks, days as written, and no other person’s id', async () => {
    const alice = await createTestUser('tasks-export-alice');
    const bob = await createTestUser('tasks-export-bob');
    const dossier = await prisma.dossier.create({ data: { name: 'Pratica', userId: alice.id } });
    const parent = await prisma.task.create({
      data: {
        userId: alice.id,
        dossierId: dossier.id,
        title: 'Memoria 171-ter',
        plannedDate: new Date('2026-10-23T00:00:00.000Z'),
        plannedTime: new Date('1970-01-01T09:30:00.000Z'),
        dueDate: new Date('2026-10-26T00:00:00.000Z'),
        // Not writable through the API in wave 1; set here to prove it never leaves.
        assigneeId: bob.id,
      },
    });
    await prisma.task.create({ data: { userId: alice.id, parentId: parent.id, dossierId: dossier.id, title: 'Bozza', deletedAt: new Date() } });
    await prisma.task.create({ data: { userId: bob.id, title: 'Compito di Bob, cliente Verdi' } });

    const res = await request(app).get('/api/auth/export').set(authHeader(alice));
    expect(res.status).toBe(200);
    const tasks = res.body.data.tasks as Record<string, unknown>[];
    expect(tasks.map((task) => task.title)).toEqual(['Memoria 171-ter', 'Bozza']);
    expect(tasks[0]).toMatchObject({ plannedDate: '2026-10-23', plannedTime: '09:30', dueDate: '2026-10-26', dueTime: null, dossierId: dossier.id });
    expect(tasks[0]).not.toHaveProperty('assigneeId');
    const whole = JSON.stringify(res.body);
    expect(whole).not.toContain(bob.id);
    expect(whole).not.toContain('Verdi');
  });

  it('deleting the account deletes its tasks and frees the ones assigned to it', async () => {
    const alice = await createTestUser('tasks-erase-alice');
    const bob = await createTestUser('tasks-erase-bob');
    await prisma.task.create({ data: { userId: alice.id, title: 'mio' } });
    const assigned = await prisma.task.create({ data: { userId: bob.id, title: 'di Bob', assigneeId: alice.id } });
    const res = await request(app).delete('/api/auth/account').set(authHeader(alice)).send({ password: 'test-password', confirmation: 'ELIMINA ACCOUNT' });
    expect(res.status).toBe(204);
    expect(await prisma.task.count({ where: { userId: alice.id } })).toBe(0);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: assigned.id } })).toMatchObject({ userId: bob.id, assigneeId: null });
  });

  it('a connected application cannot reach the tasks (not in the delegated table)', async () => {
    const alice = await createTestUser('tasks-delegated');
    const bearer = await delegated(alice, 'dossier:read dossier:write');
    expect((await request(app).get('/api/tasks').query({ view: 'today' }).set(bearer)).status).toBe(403);
    expect((await request(app).post('/api/tasks').set(bearer).send({ title: 'x' })).status).toBe(403);
    expect(await prisma.task.count({ where: { userId: alice.id } })).toBe(0);
  });
});

describe('tasks and the dossier', () => {
  it('follow their dossier into the trash and come back with it, entries and subtasks included', async () => {
    const alice = await createTestUser('tasks-dossier-trash');
    const dossier = await prisma.dossier.create({ data: { name: 'Pratica Rossi', userId: alice.id } });
    const item = await prisma.dossierItem.create({ data: { dossierId: dossier.id, itemType: 'note', title: 'Nota', position: 0 } });
    const parent = await prisma.task.create({
      data: {
        userId: alice.id,
        dossierId: dossier.id,
        dossierItemId: item.id,
        title: 'Atto',
        labels: ['udienza'],
        plannedDate: new Date('2026-10-23T00:00:00.000Z'),
        plannedTime: new Date('1970-01-01T09:30:00.000Z'),
        recurrence: 'FREQ=WEEKLY',
        recurrenceFrom: 'completamento',
      },
    });
    const child = await prisma.task.create({ data: { userId: alice.id, dossierId: dossier.id, parentId: parent.id, title: 'Bozza', completedAt: new Date('2026-10-19T10:00:00.000Z') } });
    const inbox = await prisma.task.create({ data: { userId: alice.id, title: 'senza dossier' } });
    const before = await prisma.task.findMany({ where: { dossierId: dossier.id }, orderBy: { createdAt: 'asc' } });

    const deleted = await request(app).delete(`/api/dossiers/${dossier.id}`).set(authHeader(alice));
    expect(deleted.status).toBe(200);
    expect(await prisma.task.count({ where: { dossierId: dossier.id } })).toBe(0);
    expect(await prisma.task.findUnique({ where: { id: inbox.id } })).not.toBeNull();
    const listed = (await request(app).get('/api/trash').set(authHeader(alice))).body;
    expect(listed[0]).toMatchObject({ kind: 'DOSSIER', itemCount: 1, taskCount: 2 });

    const restored = await request(app).post(`/api/trash/${deleted.body.trashId}/restore`).set(authHeader(alice)).send({});
    expect(restored.status).toBe(200);
    const after = await prisma.task.findMany({ where: { dossierId: dossier.id }, orderBy: { createdAt: 'asc' } });
    // Every column back as it was, but the time of the last change.
    const strip = (rows: typeof before) => rows.map(({ updatedAt: _updatedAt, ...row }) => row);
    expect(strip(after)).toEqual(strip(before));
    expect(after.find((task) => task.id === child.id)?.parentId).toBe(parent.id);
  });

  it('a connected application deletes a whole dossier only with the number of tasks it told the user', async () => {
    const alice = await createTestUser('tasks-delegated-dossier-trash');
    const dossier = await prisma.dossier.create({ data: { name: 'Pratica Bianchi', userId: alice.id } });
    const item = await prisma.dossierItem.create({ data: { dossierId: dossier.id, itemType: 'note', title: 'Nota', position: 0 } });
    const parent = await prisma.task.create({ data: { userId: alice.id, dossierId: dossier.id, title: 'Ricorso Bianchi' } });
    await prisma.task.create({ data: { userId: alice.id, dossierId: dossier.id, parentId: parent.id, title: 'Procura Bianchi' } });
    await prisma.task.create({ data: { userId: alice.id, dossierId: dossier.id, title: 'Deposito', completedAt: new Date() } });
    await prisma.task.create({ data: { userId: alice.id, title: 'senza dossier' } });

    // What the confirmation dialog reads: the count, never a title.
    const reader = await delegated(alice, 'dossier:read');
    const listed = await request(app).get('/api/dossiers').set(reader);
    expect(listed.status).toBe(200);
    expect(listed.body.find((d: { id: string }) => d.id === dossier.id)).toMatchObject({ task_count: 3 });
    expect(JSON.stringify(listed.body)).not.toContain('Ricorso');

    const deleter = await delegated(alice, 'content:delete');
    const trash = (body: Record<string, unknown>) => request(app).post(`/api/dossiers/${dossier.id}/trash`).set(deleter).send(body);
    expect((await trash({ itemIds: [item.id] })).status).toBe(400);
    // A task added (or gone) after the dialog: nothing moves.
    const stale = await trash({ itemIds: [item.id], taskCount: 2 });
    expect(stale.status).toBe(409);
    expect(await prisma.task.count({ where: { dossierId: dossier.id } })).toBe(3);
    expect(await prisma.trashEntry.count({ where: { userId: alice.id } })).toBe(0);

    const moved = await trash({ itemIds: [item.id], taskCount: 3 });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ itemCount: 1, taskCount: 3 });
    expect(await prisma.task.count({ where: { userId: alice.id } })).toBe(1);
    const entries = (await request(app).get('/api/trash').set(authHeader(alice))).body;
    expect(entries[0]).toMatchObject({ kind: 'DOSSIER', itemCount: 1, taskCount: 3, byApplication: true });
  });

  it('restoring a dossier leaves alone a task of its payload that is live again elsewhere', async () => {
    const alice = await createTestUser('tasks-dossier-race');
    const dossier = await prisma.dossier.create({ data: { name: 'Pratica', userId: alice.id } });
    const other = await prisma.dossier.create({ data: { name: 'Altra', userId: alice.id } });
    const left = await prisma.task.create({ data: { userId: alice.id, dossierId: dossier.id, title: 'uscito' } });
    const child = await prisma.task.create({ data: { userId: alice.id, dossierId: dossier.id, parentId: left.id, title: 'figlio' } });
    const stays = await prisma.task.create({ data: { userId: alice.id, dossierId: dossier.id, title: 'rimasto' } });
    const deleted = await request(app).delete(`/api/dossiers/${dossier.id}`).set(authHeader(alice));
    // What a move racing the deletion leaves: the row live in another dossier and in the payload too.
    await prisma.task.create({ data: { id: left.id, userId: alice.id, dossierId: other.id, title: 'uscito' } });

    const restored = await request(app).post(`/api/trash/${deleted.body.trashId}/restore`).set(authHeader(alice)).send({});
    expect(restored.status).toBe(200);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: left.id } })).dossierId).toBe(other.id);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: stays.id } })).toMatchObject({ dossierId: dossier.id });
    // Its subtask comes back in the dossier, on its own.
    expect(await prisma.task.findUniqueOrThrow({ where: { id: child.id } })).toMatchObject({ dossierId: dossier.id, parentId: null });
  });

  it('a dossier without tasks is listed as before', async () => {
    const alice = await createTestUser('tasks-dossier-none');
    const dossier = await prisma.dossier.create({ data: { name: 'Vuota', userId: alice.id } });
    await request(app).delete(`/api/dossiers/${dossier.id}`).set(authHeader(alice)).expect(200);
    const listed = (await request(app).get('/api/trash').set(authHeader(alice))).body;
    expect(listed[0]).not.toHaveProperty('taskCount');
  });

  it('a task loses its entry when the entry goes to the trash or to another dossier', async () => {
    const alice = await createTestUser('tasks-entry-gone');
    const dossier = await prisma.dossier.create({ data: { name: 'Pratica', userId: alice.id } });
    const other = await prisma.dossier.create({ data: { name: 'Altra', userId: alice.id } });
    const trashed = await prisma.dossierItem.create({ data: { dossierId: dossier.id, itemType: 'note', title: 'a', position: 0 } });
    const moved = await prisma.dossierItem.create({ data: { dossierId: dossier.id, itemType: 'note', title: 'b', position: 1 } });
    const onTrashed = await prisma.task.create({ data: { userId: alice.id, dossierId: dossier.id, dossierItemId: trashed.id, title: 'x' } });
    const onMoved = await prisma.task.create({ data: { userId: alice.id, dossierId: dossier.id, dossierItemId: moved.id, title: 'y' } });

    await request(app).delete(`/api/dossiers/${dossier.id}/items/${trashed.id}`).set(authHeader(alice)).expect(200);
    await request(app).post(`/api/dossiers/${dossier.id}/items/${moved.id}/move`).set(authHeader(alice)).send({ targetDossierId: other.id }).expect(200);

    expect(await prisma.task.findUniqueOrThrow({ where: { id: onTrashed.id } })).toMatchObject({ dossierId: dossier.id, dossierItemId: null });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: onMoved.id } })).toMatchObject({ dossierId: dossier.id, dossierItemId: null });
  });
});
