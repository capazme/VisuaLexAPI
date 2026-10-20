import { afterEach, describe, expect, it, vi } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from './helpers';
import { addDays, romeDay } from '../src/lingo/studyDay';
import { RECURRENCE_RULES } from '../src/tasks/recurrence';
import { completeTask, listTasks, sweepTrashedTasks, TASK_TRASH_RETENTION_MS } from '../src/tasks/tasks';
import { trashDossier, BY_THE_USER } from '../src/trash/trash';

// The planner's tasks (wave 1): routes, views, subtasks, ticks, repetition, trash.

async function post(user: TestUser, body: Record<string, unknown>) {
  return request(app).post('/api/tasks').set(authHeader(user)).send(body);
}

async function created(user: TestUser, body: Record<string, unknown>) {
  const res = await post(user, body);
  expect(res.status).toBe(201);
  return res.body as { id: string; [key: string]: unknown };
}

async function view(user: TestUser, name: string, dossierId?: string) {
  const res = await request(app)
    .get('/api/tasks')
    .query(dossierId ? { view: name, dossierId } : { view: name })
    .set(authHeader(user));
  expect(res.status).toBe(200);
  return res.body as { view: string; today: string; tasks: { id: string; title: string }[]; truncated: boolean };
}

const titles = (body: { tasks: { title: string }[] }) => body.tasks.map((task) => task.title).sort();

async function dossierWithItem(user: TestUser, name = 'Pratica') {
  const dossier = await prisma.dossier.create({ data: { name, userId: user.id } });
  const item = await prisma.dossierItem.create({ data: { dossierId: dossier.id, itemType: 'note', title: 'Nota', position: 0 } });
  return { dossier, item };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('creating a task', () => {
  it('starts in the inbox with the defaults, after the last one', async () => {
    const user = await createTestUser('tasks-create');
    const first = await created(user, { title: 'Chiamare il cliente', labels: ['cliente', 'cliente', ' udienza '] });
    expect(first).toMatchObject({
      title: 'Chiamare il cliente',
      description: null,
      priority: 4,
      labels: ['cliente', 'udienza'],
      position: 0,
      parent_id: null,
      dossier_id: null,
      dossier_item_id: null,
      planned_date: null,
      due_date: null,
      recurrence: null,
      recurrence_from: 'pianificata',
      origin: 'lavoro',
      completed_at: null,
      deleted_at: null,
    });
    const second = await created(user, { title: 'Secondo' });
    expect(second.position).toBe(1);
  });

  it('stores civil days and times as written', async () => {
    const user = await createTestUser('tasks-dates');
    const task = await created(user, {
      title: 'Deposito memoria',
      priority: 1,
      plannedDate: '2026-10-23',
      plannedTime: '09:30',
      dueDate: '2026-10-26',
      dueTime: '23:59',
    });
    expect(task).toMatchObject({ planned_date: '2026-10-23', planned_time: '09:30', due_date: '2026-10-26', due_time: '23:59', priority: 1 });
    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.plannedDate?.toISOString()).toBe('2026-10-23T00:00:00.000Z');
    expect(row.dueTime?.toISOString()).toBe('1970-01-01T23:59:00.000Z');
  });

  it('files a task under a dossier and one of its entries; a subtask takes its parent’s dossier', async () => {
    const user = await createTestUser('tasks-dossier');
    const { dossier, item } = await dossierWithItem(user);
    const parent = await created(user, { title: 'Atto di citazione', dossierId: dossier.id, dossierItemId: item.id });
    expect(parent).toMatchObject({ dossier_id: dossier.id, dossier_item_id: item.id });
    const child = await created(user, { title: 'Bozza', parentId: parent.id });
    expect(child).toMatchObject({ parent_id: parent.id, dossier_id: dossier.id, position: 0 });

    const elsewhere = await prisma.dossier.create({ data: { name: 'Altro', userId: user.id } });
    expect((await post(user, { title: 'x', parentId: parent.id, dossierId: elsewhere.id })).status).toBe(400);
    expect((await post(user, { title: 'x', parentId: parent.id, dossierId: null })).status).toBe(400);
    // An entry of another dossier, and an entry with no dossier.
    expect((await post(user, { title: 'x', dossierId: elsewhere.id, dossierItemId: item.id })).status).toBe(404);
    expect((await post(user, { title: 'x', dossierItemId: item.id })).status).toBe(400);
  });

  it.each([
    [{ title: '' }, 'an empty title'],
    [{ title: '   ' }, 'a blank title'],
    [{ title: 'x'.repeat(501) }, 'a title too long'],
    [{ title: 'x', priority: 0 }, 'a priority below 1'],
    [{ title: 'x', priority: 5 }, 'a priority above 4'],
    [{ title: 'x', plannedDate: '2026-02-30' }, 'a day the calendar does not have'],
    [{ title: 'x', plannedDate: '20/10/2026' }, 'a day not written YYYY-MM-DD'],
    [{ title: 'x', plannedDate: '2026-10-20', plannedTime: '24:00' }, 'a time out of range'],
    [{ title: 'x', plannedTime: '09:00' }, 'a time without its date'],
    [{ title: 'x', dueTime: '09:00' }, 'a deadline time without its date'],
    [{ title: 'x', recurrence: RECURRENCE_RULES.daily }, 'a repetition without a planned date'],
    [{ title: 'x', plannedDate: '2026-10-20', recurrence: 'FREQ=HOURLY' }, 'a repetition outside the subset'],
    [{ title: 'x', plannedDate: '2026-10-20', dueDate: '2026-10-30', recurrence: RECURRENCE_RULES.weekly }, 'a repeating task with a deadline'],
    [{ title: 'x', origin: 'altro' }, 'an unknown origin'],
    [{ title: 'x', labels: Array.from({ length: 21 }, (_, i) => `l${i}`) }, 'too many labels'],
    [{ title: 'x\u0000' }, 'a NUL byte'],
    [{ title: 'x', assigneeId: 'someone' }, 'an assignee (not writable in wave 1)'],
    [{ title: 'x', completedAt: '2026-10-20T10:00:00Z' }, 'a completion time'],
  ])('refuses %o (%s)', async (body) => {
    const user = await createTestUser(`tasks-refuse-${Math.random().toString(36).slice(2, 8)}`);
    const res = await post(user, body);
    expect(res.status).toBe(400);
    expect(await prisma.task.count({ where: { userId: user.id } })).toBe(0);
  });

  it('never repeats a title in an error message or a log line', async () => {
    const user = await createTestUser('tasks-no-echo');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const name = 'Avv. Mario Rossi contro Bianchi';
    const responses = [
      await post(user, { title: `${name} ${'x'.repeat(500)}` }),
      await post(user, { title: name, plannedDate: name }),
      await post(user, { title: name, plannedDate: '2026-10-20', recurrence: name }),
      await post(user, { title: name, origin: name }),
      await post(user, { title: name, plannedTime: '10:00' }),
      await request(app).get('/api/tasks').query({ view: name }).set(authHeader(user)),
      // Refused by the JSON parser before any route: its error carries the raw body.
      await request(app).post('/api/tasks').set(authHeader(user)).set('Content-Type', 'application/json').send(`{"title":"${name}",}`),
    ];
    for (const res of responses) {
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain('Rossi');
    }
    const logged = [...warn.mock.calls, ...error.mock.calls].flat().map(String).join('\n');
    expect(logged).not.toContain('Rossi');
  });
});

describe('the views', () => {
  it('today with the overdue, the next seven days, the inbox and a dossier', async () => {
    const user = await createTestUser('tasks-views');
    const today = romeDay(new Date());
    const { dossier } = await dossierWithItem(user);
    await created(user, { title: 'oggi', plannedDate: today });
    await created(user, { title: 'ieri', plannedDate: addDays(today, -1) });
    await created(user, { title: 'termine scaduto', dueDate: addDays(today, -3) });
    await created(user, { title: 'termine oggi', plannedDate: addDays(today, 5), dueDate: today });
    await created(user, { title: 'tra sei giorni', plannedDate: addDays(today, 6) });
    await created(user, { title: 'tra sette giorni', plannedDate: addDays(today, 7) });
    await created(user, { title: 'termine tra due giorni', dueDate: addDays(today, 2) });
    await created(user, { title: 'senza data' });
    await created(user, { title: 'nel dossier', dossierId: dossier.id, plannedDate: addDays(today, 1) });
    const done = await created(user, { title: 'fatto', plannedDate: today });
    await request(app).post(`/api/tasks/${done.id}/complete`).set(authHeader(user)).expect(200);
    const trashed = await created(user, { title: 'cestinato', plannedDate: today });
    await request(app).delete(`/api/tasks/${trashed.id}`).set(authHeader(user)).expect(200);

    const todayView = await view(user, 'today');
    expect(todayView.today).toBe(today);
    expect(titles(todayView)).toEqual(['ieri', 'oggi', 'termine oggi', 'termine scaduto']);
    expect(titles(await view(user, 'upcoming'))).toEqual(['nel dossier', 'oggi', 'termine oggi', 'termine tra due giorni', 'tra sei giorni']);
    expect(titles(await view(user, 'inbox'))).toEqual(
      ['ieri', 'oggi', 'senza data', 'termine oggi', 'termine scaduto', 'termine tra due giorni', 'tra sei giorni', 'tra sette giorni'],
    );
    expect(titles(await view(user, 'dossier', dossier.id))).toEqual(['nel dossier']);
    expect(titles(await view(user, 'trash'))).toEqual(['cestinato']);
  });

  it('a dossier view needs the dossier; an unknown view is refused', async () => {
    const user = await createTestUser('tasks-views-refused');
    expect((await request(app).get('/api/tasks').query({ view: 'dossier' }).set(authHeader(user))).status).toBe(400);
    expect((await request(app).get('/api/tasks').query({ view: 'all' }).set(authHeader(user))).status).toBe(400);
    expect((await request(app).get('/api/tasks').set(authHeader(user))).status).toBe(400);
  });

  it('«today» is the Rome day, across the midnight and the clock changes', async () => {
    const user = await createTestUser('tasks-rome-day');
    for (const day of ['2026-10-24', '2026-10-25', '2026-10-26', '2027-03-27', '2027-03-28']) {
      await prisma.task.create({ data: { userId: user.id, title: day, plannedDate: new Date(`${day}T00:00:00.000Z`) } });
    }
    const latest = async (at: string, name: 'today' | 'upcoming' = 'today') => {
      const result = await listTasks(user.id, name, undefined, new Date(at));
      return { today: result.today, titles: result.tasks.map((task) => task.title) };
    };
    // 23:59 in Rome (summer time) is still the 24th; 00:30 is the 25th, though UTC still says the 24th.
    expect(await latest('2026-10-24T21:59:00Z')).toEqual({ today: '2026-10-24', titles: ['2026-10-24'] });
    expect(await latest('2026-10-24T22:30:00Z')).toEqual({ today: '2026-10-25', titles: ['2026-10-24', '2026-10-25'] });
    // The night the clocks go back: 00:30 on the 26th in Rome is 23:30 UTC (winter time).
    expect((await latest('2026-10-25T22:30:00Z')).today).toBe('2026-10-25');
    expect((await latest('2026-10-25T23:30:00Z')).today).toBe('2026-10-26');
    // The night they go forward: 00:30 on the 28th in Rome is 23:30 UTC (still winter time).
    expect((await latest('2027-03-27T23:30:00Z')).today).toBe('2027-03-28');
    expect((await latest('2027-03-27T22:59:00Z', 'upcoming')).titles).toEqual(['2027-03-27', '2027-03-28']);
  });
});

describe('changing a task', () => {
  it('moves a task and its subtasks to another dossier, without their entries', async () => {
    const user = await createTestUser('tasks-move');
    const { dossier, item } = await dossierWithItem(user);
    const other = await prisma.dossier.create({ data: { name: 'Altra pratica', userId: user.id } });
    const parent = await created(user, { title: 'p', dossierId: dossier.id, dossierItemId: item.id });
    const child = await created(user, { title: 'c', parentId: parent.id });
    await prisma.task.update({ where: { id: child.id }, data: { dossierItemId: item.id } });

    const res = await request(app).put(`/api/tasks/${parent.id}`).set(authHeader(user)).send({ dossierId: other.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dossier_id: other.id, dossier_item_id: null });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: child.id } })).toMatchObject({ dossierId: other.id, dossierItemId: null });

    // A subtask's dossier changes only with its parent.
    expect((await request(app).put(`/api/tasks/${child.id}`).set(authHeader(user)).send({ dossierId: dossier.id })).status).toBe(400);
    // Detached from its parent, it may go anywhere.
    const detached = await request(app).put(`/api/tasks/${child.id}`).set(authHeader(user)).send({ parentId: null, dossierId: null });
    expect(detached.body).toMatchObject({ parent_id: null, dossier_id: null });
  });

  it('refuses to keep an entry of the old dossier when the task moves', async () => {
    const user = await createTestUser('tasks-move-entry');
    const { dossier, item } = await dossierWithItem(user);
    const other = await prisma.dossier.create({ data: { name: 'Altra pratica', userId: user.id } });
    const task = await created(user, { title: 't', dossierId: dossier.id, dossierItemId: item.id });
    const host = await created(user, { title: 'h', dossierId: other.id });
    const put = (body: Record<string, unknown>) => request(app).put(`/api/tasks/${task.id}`).set(authHeader(user)).send(body);
    expect((await put({ dossierId: other.id, dossierItemId: item.id })).status).toBe(404);
    expect((await put({ parentId: host.id, dossierItemId: item.id })).status).toBe(404);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ dossierId: dossier.id, dossierItemId: item.id, parentId: null });
  });

  it('refuses a parent in the trash', async () => {
    const user = await createTestUser('tasks-trashed-parent');
    const parent = await created(user, { title: 'p' });
    const task = await created(user, { title: 't' });
    await request(app).delete(`/api/tasks/${parent.id}`).set(authHeader(user)).expect(200);
    expect((await post(user, { title: 'c', parentId: parent.id })).status).toBe(404);
    expect((await request(app).put(`/api/tasks/${task.id}`).set(authHeader(user)).send({ parentId: parent.id })).status).toBe(404);
  });

  it('two re-parentings at once cannot close a loop', async () => {
    const user = await createTestUser('tasks-loop-race');
    for (let round = 0; round < 5; round += 1) {
      const a = await created(user, { title: `a${round}` });
      const b = await created(user, { title: `b${round}` });
      const statuses = (
        await Promise.all([
          request(app).put(`/api/tasks/${a.id}`).set(authHeader(user)).send({ parentId: b.id }),
          request(app).put(`/api/tasks/${b.id}`).set(authHeader(user)).send({ parentId: a.id }),
        ])
      ).map((res) => res.status).sort();
      expect(statuses).toEqual([200, 400]);
      const [rowA, rowB] = await Promise.all([a.id, b.id].map((id) => prisma.task.findUniqueOrThrow({ where: { id } })));
      expect(rowA.parentId === b.id && rowB.parentId === a.id).toBe(false);
    }
  });

  it('refuses a loop of subtasks', async () => {
    const user = await createTestUser('tasks-loop');
    const a = await created(user, { title: 'a' });
    const b = await created(user, { title: 'b', parentId: a.id });
    const c = await created(user, { title: 'c', parentId: b.id });
    expect((await request(app).put(`/api/tasks/${a.id}`).set(authHeader(user)).send({ parentId: c.id })).status).toBe(400);
    expect((await request(app).put(`/api/tasks/${a.id}`).set(authHeader(user)).send({ parentId: a.id })).status).toBe(400);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: a.id } })).parentId).toBeNull();
  });

  it('checks the pairings against the stored fields', async () => {
    const user = await createTestUser('tasks-pairings');
    const task = await created(user, { title: 'x', plannedDate: '2026-10-20', plannedTime: '10:00', recurrence: RECURRENCE_RULES.weekly });
    const put = (body: Record<string, unknown>) => request(app).put(`/api/tasks/${task.id}`).set(authHeader(user)).send(body);
    expect((await put({ plannedDate: null })).status).toBe(400);
    expect((await put({ dueDate: '2026-10-30' })).status).toBe(400);
    expect((await put({ recurrence: null, dueDate: '2026-10-30' })).status).toBe(200);
    expect((await put({ plannedDate: null, plannedTime: null })).body).toMatchObject({ planned_date: null, planned_time: null, recurrence: null });
  });

  it('cannot change a task in the trash', async () => {
    const user = await createTestUser('tasks-trashed-edit');
    const task = await created(user, { title: 'x' });
    await request(app).delete(`/api/tasks/${task.id}`).set(authHeader(user)).expect(200);
    expect((await request(app).put(`/api/tasks/${task.id}`).set(authHeader(user)).send({ title: 'y' })).status).toBe(404);
    expect((await request(app).post(`/api/tasks/${task.id}/complete`).set(authHeader(user))).status).toBe(404);
  });
});

describe('ticking', () => {
  it('closes a task with its open subtasks, and reopening brings back what closed with it', async () => {
    const user = await createTestUser('tasks-complete');
    const parent = await created(user, { title: 'p' });
    const early = await created(user, { title: 'già fatto', parentId: parent.id });
    const open = await created(user, { title: 'aperto', parentId: parent.id });
    await request(app).post(`/api/tasks/${early.id}/complete`).set(authHeader(user)).expect(200);

    const done = await request(app).post(`/api/tasks/${parent.id}/complete`).set(authHeader(user));
    expect(done.status).toBe(200);
    expect(done.body.recurred).toBeNull();
    expect(done.body.task.completed_at).not.toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: open.id } })).completedAt).not.toBeNull();
    // A second tick changes nothing.
    const again = await request(app).post(`/api/tasks/${parent.id}/complete`).set(authHeader(user));
    expect(again.body.task.completed_at).toBe(done.body.task.completed_at);

    const reopened = await request(app).post(`/api/tasks/${parent.id}/reopen`).set(authHeader(user));
    expect(reopened.status).toBe(200);
    expect(reopened.body.task.completed_at).toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: open.id } })).completedAt).toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: early.id } })).completedAt).not.toBeNull();
  });

  it('moves a repeating task to its next date, and a stale tick does not move it twice', async () => {
    const user = await createTestUser('tasks-recur');
    const today = romeDay(new Date());
    const task = await created(user, { title: 'Controllo PEC', plannedDate: today, plannedTime: '08:30', recurrence: RECURRENCE_RULES.weekly });
    const res = await request(app).post(`/api/tasks/${task.id}/complete`).set(authHeader(user)).send({ plannedDate: today });
    expect(res.status).toBe(200);
    expect(res.body.recurred).toEqual({ previous_planned_date: today, planned_date: addDays(today, 7) });
    expect(res.body.task).toMatchObject({ planned_date: addDays(today, 7), planned_time: '08:30', completed_at: null });

    const stale = await request(app).post(`/api/tasks/${task.id}/complete`).set(authHeader(user)).send({ plannedDate: today });
    expect(stale.status).toBe(409);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).plannedDate?.toISOString().slice(0, 10)).toBe(addDays(today, 7));
  });

  it('a repeating task is ticked only with the occurrence seen; any other without it', async () => {
    const user = await createTestUser('tasks-recur-seen');
    const today = romeDay(new Date());
    const repeating = await created(user, { title: 'r', plannedDate: today, recurrence: RECURRENCE_RULES.daily });
    const plain = await created(user, { title: 'p', plannedDate: today });
    const missing = await request(app).post(`/api/tasks/${repeating.id}/complete`).set(authHeader(user)).send({});
    expect(missing.status).toBe(400);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: repeating.id } })).plannedDate?.toISOString().slice(0, 10)).toBe(today);
    expect((await request(app).post(`/api/tasks/${plain.id}/complete`).set(authHeader(user))).status).toBe(200);
  });

  it('two ticks of a repeating task at once move it once', async () => {
    const user = await createTestUser('tasks-recur-double');
    const today = romeDay(new Date());
    const task = await created(user, { title: 'r', plannedDate: today, recurrence: RECURRENCE_RULES.weekly });
    const tick = () => request(app).post(`/api/tasks/${task.id}/complete`).set(authHeader(user)).send({ plannedDate: today });
    const statuses = (await Promise.all([tick(), tick()])).map((res) => res.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).plannedDate?.toISOString().slice(0, 10)).toBe(addDays(today, 7));
  });

  /** Ticks the task on its own planned date, `count` times, through the service with that day as «today». */
  async function tickOnTime(userId: string, id: string, count: number): Promise<string[]> {
    const dates: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const planned = (await prisma.task.findUniqueOrThrow({ where: { id } })).plannedDate!.toISOString().slice(0, 10);
      const { recurred } = await completeTask(userId, id, planned, new Date(`${planned}T10:00:00Z`));
      dates.push(recurred!.plannedDate);
    }
    return dates;
  }

  it('a monthly 31st is shortened only in the months without it, across ticks and edits', async () => {
    const user = await createTestUser('tasks-recur-month-end');
    const task = await created(user, { title: 'Fattura', plannedDate: '2027-01-31', recurrence: RECURRENCE_RULES.monthly });
    expect(await tickOnTime(user.id, task.id, 2)).toEqual(['2027-02-28', '2027-03-31']);
    expect(await tickOnTime(user.id, task.id, 1)).toEqual(['2027-04-30']);
    // The web sends the task back whole, its shortened date unchanged: the 31st stays.
    const put = (body: Record<string, unknown>) => request(app).put(`/api/tasks/${task.id}`).set(authHeader(user)).send(body);
    expect((await put({ title: 'Fattura mensile', plannedDate: '2027-04-30', recurrence: RECURRENCE_RULES.monthly, recurrenceFrom: 'pianificata' })).status).toBe(200);
    expect(await tickOnTime(user.id, task.id, 3)).toEqual(['2027-05-31', '2027-06-30', '2027-07-31']);
    // A date the user picks is the new day kept.
    expect((await put({ plannedDate: '2027-08-30' })).status).toBe(200);
    expect(await tickOnTime(user.id, task.id, 2)).toEqual(['2027-09-30', '2027-10-30']);
  });

  it('a yearly 29 February is the 28th in common years and the 29th again in a leap year', async () => {
    const user = await createTestUser('tasks-recur-leap');
    const task = await created(user, { title: 'Rinnovo', plannedDate: '2028-02-29', recurrence: RECURRENCE_RULES.yearly });
    expect(await tickOnTime(user.id, task.id, 5)).toEqual(['2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29', '2033-02-28']);
  });

  it('«Annulla» after a tick keeps the day: a monthly 31st put back on 28 February goes on to 31 March', async () => {
    const user = await createTestUser('tasks-recur-undo-month');
    const task = await created(user, { title: 'Fattura', plannedDate: '2027-01-31', recurrence: RECURRENCE_RULES.monthly });
    // «Annulla» puts the planned date back with a PUT, as the web's undo toast does.
    const undo = (plannedDate: string) => request(app).put(`/api/tasks/${task.id}`).set(authHeader(user)).send({ plannedDate });
    expect(await tickOnTime(user.id, task.id, 1)).toEqual(['2027-02-28']);
    for (let i = 0; i < 2; i += 1) {
      expect(await tickOnTime(user.id, task.id, 1)).toEqual(['2027-03-31']);
      expect((await undo('2027-02-28')).status).toBe(200);
    }
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).recurrenceDay).toBe(31);
    expect(await tickOnTime(user.id, task.id, 3)).toEqual(['2027-03-31', '2027-04-30', '2027-05-31']);
    // Ticked on the 31st and undone back to it: the same.
    expect((await undo('2027-05-31')).status).toBe(200);
    expect(await tickOnTime(user.id, task.id, 1)).toEqual(['2027-06-30']);
  });

  it('«Annulla» after a tick keeps the day: a yearly 29 February put back on a 28th is the 29th again in a leap year', async () => {
    const user = await createTestUser('tasks-recur-undo-leap');
    const task = await created(user, { title: 'Rinnovo', plannedDate: '2028-02-29', recurrence: RECURRENCE_RULES.yearly });
    const undo = (plannedDate: string) => request(app).put(`/api/tasks/${task.id}`).set(authHeader(user)).send({ plannedDate });
    expect(await tickOnTime(user.id, task.id, 2)).toEqual(['2029-02-28', '2030-02-28']);
    expect((await undo('2029-02-28')).status).toBe(200);
    expect(await tickOnTime(user.id, task.id, 4)).toEqual(['2030-02-28', '2031-02-28', '2032-02-29', '2033-02-28']);
    // From a leap year back to the 29th, then on.
    expect((await undo('2032-02-29')).status).toBe(200);
    expect(await tickOnTime(user.id, task.id, 1)).toEqual(['2033-02-28']);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).recurrenceDay).toBe(29);
  });

  it('a new day the user picks, the rule or its origin changed, is the day kept from then on', async () => {
    const user = await createTestUser('tasks-recur-new-day');
    const task = await created(user, { title: 'Fattura', plannedDate: '2027-01-31', recurrence: RECURRENCE_RULES.monthly });
    const put = (body: Record<string, unknown>) => request(app).put(`/api/tasks/${task.id}`).set(authHeader(user)).send(body);
    const day = async () => (await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).recurrenceDay;
    // The 28th in a February of 29 days is not where the 31st lands: a new day.
    expect((await put({ plannedDate: '2028-02-28' })).status).toBe(200);
    expect(await day()).toBe(28);
    expect((await put({ plannedDate: '2028-03-31' })).status).toBe(200);
    expect(await day()).toBe(31);
    // On the 30th of a month of 30 days the 31st lands there too: kept, unless the rule or its origin changes.
    expect((await put({ plannedDate: '2028-04-30' })).status).toBe(200);
    expect(await day()).toBe(31);
    expect((await put({ recurrenceFrom: 'completamento' })).status).toBe(200);
    expect(await day()).toBe(30);
    expect((await put({ plannedDate: '2028-05-31', recurrenceFrom: 'pianificata' })).status).toBe(200);
    expect((await put({ plannedDate: '2028-06-30', recurrence: RECURRENCE_RULES.yearly })).status).toBe(200);
    expect(await day()).toBe(30);
  });

  it('counts the next date from the Rome day of the tick', async () => {
    const user = await createTestUser('tasks-recur-rome');
    const task = await prisma.task.create({
      data: { userId: user.id, title: 'x', plannedDate: new Date('2026-10-24T00:00:00.000Z'), recurrence: RECURRENCE_RULES.daily, recurrenceFrom: 'completamento' },
    });
    // 00:30 on the 25th in Rome, still the 24th in UTC.
    const { recurred } = await completeTask(user.id, task.id, '2026-10-24', new Date('2026-10-24T22:30:00Z'));
    expect(recurred).toEqual({ previousPlannedDate: '2026-10-24', plannedDate: '2026-10-26' });
  });
});

describe('a dossier going to the trash while one of its tasks changes', () => {
  it('waits for the change and keeps it in the payload', async () => {
    const user = await createTestUser('tasks-trash-race');
    const { dossier } = await dossierWithItem(user);
    const task = await created(user, { title: 'prima', dossierId: dossier.id });
    let trashing: Promise<{ trashId: string }> | undefined;
    // An edit in flight on another connection: the row locked and changed, not yet committed.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${task.id} FOR UPDATE`;
      await tx.task.update({ where: { id: task.id }, data: { title: 'dopo' } });
      trashing = trashDossier(user.id, dossier.id, null, BY_THE_USER);
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    const { trashId } = await trashing!;
    const entry = await prisma.trashEntry.findUniqueOrThrow({ where: { id: trashId } });
    const stored = (entry.payload as { tasks: { id: string; title: string }[] }).tasks;
    expect(stored).toEqual([expect.objectContaining({ id: task.id, title: 'dopo' })]);
  });
});

describe('order and trash', () => {
  it('reorders the user’s tasks', async () => {
    const user = await createTestUser('tasks-reorder');
    const a = await created(user, { title: 'a' });
    const b = await created(user, { title: 'b' });
    const c = await created(user, { title: 'c' });
    const res = await request(app).post('/api/tasks/reorder').set(authHeader(user)).send({ taskIds: [c.id, a.id, b.id] });
    expect(res.status).toBe(200);
    expect((await view(user, 'inbox')).tasks.map((task) => task.title)).toEqual(['c', 'a', 'b']);
  });

  it('reorders one list at a time', async () => {
    const user = await createTestUser('tasks-reorder-lists');
    const { dossier } = await dossierWithItem(user);
    const inbox = await created(user, { title: 'i' });
    const filed = await created(user, { title: 'd', dossierId: dossier.id });
    const child = await created(user, { title: 'c', parentId: inbox.id });
    const reorder = (taskIds: string[]) => request(app).post('/api/tasks/reorder').set(authHeader(user)).send({ taskIds });
    expect((await reorder([inbox.id, filed.id])).status).toBe(400);
    expect((await reorder([inbox.id, child.id])).status).toBe(400);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: filed.id } })).position).toBe(0);
  });

  it('reorders a thousand tasks in one call', async () => {
    const user = await createTestUser('tasks-reorder-many');
    const ids = Array.from({ length: 1000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    await prisma.task.createMany({ data: ids.map((id, i) => ({ id, userId: user.id, title: `t${i}`, position: i })) });
    const reversed = [...ids].reverse();
    const res = await request(app).post('/api/tasks/reorder').set(authHeader(user)).send({ taskIds: reversed });
    expect(res.status).toBe(200);
    const rows = await prisma.task.findMany({ where: { userId: user.id }, orderBy: { position: 'asc' }, select: { id: true, position: true } });
    expect(rows.map((row) => row.id)).toEqual(reversed);
    expect(rows.map((row) => row.position)).toEqual(ids.map((_, i) => i));
  });

  it('a task that changes list, or comes back from the trash, goes after the last one', async () => {
    const user = await createTestUser('tasks-positions');
    const { dossier } = await dossierWithItem(user);
    await created(user, { title: 'd0', dossierId: dossier.id });
    await created(user, { title: 'd1', dossierId: dossier.id });
    const moving = await created(user, { title: 'm' });
    const moved = await request(app).put(`/api/tasks/${moving.id}`).set(authHeader(user)).send({ dossierId: dossier.id });
    expect(moved.body).toMatchObject({ dossier_id: dossier.id, position: 2 });

    const parent = await created(user, { title: 'p' });
    await created(user, { title: 'p0', parentId: parent.id });
    const adopted = await request(app).put(`/api/tasks/${moving.id}`).set(authHeader(user)).send({ parentId: parent.id });
    expect(adopted.body).toMatchObject({ parent_id: parent.id, dossier_id: null, position: 1 });

    const first = await created(user, { title: 'first' });
    expect(first.position).toBe(1);
    await request(app).delete(`/api/tasks/${first.id}`).set(authHeader(user)).expect(200);
    const taken = await created(user, { title: 'taken' });
    expect(taken.position).toBe(1);
    const restored = await request(app).post(`/api/tasks/${first.id}/restore`).set(authHeader(user));
    expect(restored.body.position).toBe(2);
  });

  it('trashes a task with its subtasks and restores them together', async () => {
    const user = await createTestUser('tasks-trash');
    const parent = await created(user, { title: 'p' });
    const child = await created(user, { title: 'c', parentId: parent.id });
    const res = await request(app).delete(`/api/tasks/${parent.id}`).set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: parent.id, task_count: 2 });
    expect((await view(user, 'inbox')).tasks).toEqual([]);
    expect(titles(await view(user, 'trash'))).toEqual(['c', 'p']);

    const restored = await request(app).post(`/api/tasks/${parent.id}/restore`).set(authHeader(user));
    expect(restored.status).toBe(200);
    expect(restored.body.deleted_at).toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: child.id } })).deletedAt).toBeNull();
    expect((await request(app).post(`/api/tasks/${parent.id}/restore`).set(authHeader(user))).status).toBe(404);
  });

  it('restores a subtask on its own when its parent is still in the trash', async () => {
    const user = await createTestUser('tasks-trash-child');
    const parent = await created(user, { title: 'p' });
    const child = await created(user, { title: 'c', parentId: parent.id });
    await request(app).delete(`/api/tasks/${parent.id}`).set(authHeader(user)).expect(200);
    const restored = await request(app).post(`/api/tasks/${child.id}/restore`).set(authHeader(user));
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ parent_id: null, deleted_at: null });
  });

  it('sweeps what has been in the trash for more than 30 days', async () => {
    const user = await createTestUser('tasks-sweep');
    const old = await created(user, { title: 'vecchio' });
    const recent = await created(user, { title: 'recente' });
    const now = Date.now();
    await prisma.task.update({ where: { id: old.id }, data: { deletedAt: new Date(now - TASK_TRASH_RETENTION_MS - 60_000) } });
    await prisma.task.update({ where: { id: recent.id }, data: { deletedAt: new Date(now - 60_000) } });
    expect((await request(app).post(`/api/tasks/${old.id}/restore`).set(authHeader(user))).status).toBe(404);
    expect(titles(await view(user, 'trash'))).toEqual(['recente']);
    await sweepTrashedTasks(new Date(now));
    expect(await prisma.task.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.task.findUnique({ where: { id: recent.id } })).not.toBeNull();
  });

  it('the sweep keeps a live subtask of a parent it removes, on its own', async () => {
    const user = await createTestUser('tasks-sweep-child');
    const parent = await created(user, { title: 'p' });
    const child = await created(user, { title: 'c', parentId: parent.id });
    const now = Date.now();
    await prisma.task.update({ where: { id: parent.id }, data: { deletedAt: new Date(now - TASK_TRASH_RETENTION_MS - 60_000) } });
    await sweepTrashedTasks(new Date(now));
    expect(await prisma.task.findUnique({ where: { id: parent.id } })).toBeNull();
    expect(await prisma.task.findUniqueOrThrow({ where: { id: child.id } })).toMatchObject({ parentId: null, deletedAt: null });
  });
});
