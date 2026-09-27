import { describe, expect, it, beforeEach } from 'vitest';
import { request, app, createTestUser, authHeader, prisma, type TestUser } from './helpers';

describe('saved norm change notifications', () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createTestUser('norma-watch-user');
  });

  it('creates a watch, ignores equal snapshots, and records body changes', async () => {
    const first = { norma_data: { tipo_atto: 'legge', numero_atto: '1', data: '2020' }, article_text: 'Testo uno' };
    const second = { ...first, article_text: 'Testo due' };

    const initial = await request(app)
      .post('/api/notifications/normas/check')
      .set(authHeader(user))
      .send({ normaKey: 'legge--1--2020--1', normaData: first });
    expect(initial.status).toBe(200);
    expect(initial.body).toEqual({ watched: true, changed: false });

    const unchanged = await request(app)
      .post('/api/notifications/normas/check')
      .set(authHeader(user))
      .send({ normaKey: 'legge--1--2020--1', normaData: first });
    expect(unchanged.body.changed).toBe(false);

    const changed = await request(app)
      .post('/api/notifications/normas/check')
      .set(authHeader(user))
      .send({ normaKey: 'legge--1--2020--1', normaData: second });
    expect(changed.body).toEqual({ watched: true, changed: true });

    const notifications = await request(app)
      .get('/api/notifications/normas')
      .set(authHeader(user));
    expect(notifications.status).toBe(200);
    expect(notifications.body).toHaveLength(1);
    expect(notifications.body[0].normaKey).toBe('legge--1--2020--1');

    await prisma.normaChangeNotification.deleteMany({ where: { userId: user.id } });
    await prisma.normaWatch.deleteMany({ where: { userId: user.id } });
  });

  it('registers nothing on an empty text and leaves a populated watch untouched', async () => {
    const key = 'legge--9--2020--1';
    const populated = { norma_data: { tipo_atto: 'legge' }, article_text: 'Testo pieno' };
    await request(app).post('/api/notifications/normas/check').set(authHeader(user)).send({ normaKey: key, normaData: populated });

    const empty = await request(app)
      .post('/api/notifications/normas/check')
      .set(authHeader(user))
      .send({ normaKey: key, normaData: { norma_data: { tipo_atto: 'legge' }, article_text: '' } });
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ watched: true, changed: false });

    const stored = await prisma.normaWatch.findUnique({ where: { userId_normaKey: { userId: user.id, normaKey: key } } });
    expect((stored?.normaData as { article_text?: string })?.article_text).toBe('Testo pieno');
    expect(await prisma.normaChangeNotification.count({ where: { userId: user.id } })).toBe(0);

    const unknown = await request(app)
      .post('/api/notifications/normas/check')
      .set(authHeader(user))
      .send({ normaKey: 'legge--10--2020--1', normaData: { norma_data: { tipo_atto: 'legge' }, article_text: '' } });
    expect(unknown.body).toEqual({ watched: false, changed: false });
    expect(await prisma.normaWatch.count({ where: { userId: user.id, normaKey: 'legge--10--2020--1' } })).toBe(0);

    await prisma.normaWatch.deleteMany({ where: { userId: user.id } });
  });

  it('rejects a check with no normaKey as a 400', async () => {
    const response = await request(app)
      .post('/api/notifications/normas/check')
      .set(authHeader(user))
      .send({ normaData: { norma_data: {}, article_text: 'x' } });
    expect(response.status).toBe(400);
  });

  it('stores the new snapshot without a notification on a baseline (metadata-only) watch', async () => {
    // Simulates a watch row written before article_text-based diffing existed:
    // no article_text in the stored snapshot at all.
    const watch = await prisma.normaWatch.create({
      data: { userId: user.id, normaKey: 'legge--2--2021--1', normaData: { norma_data: { tipo_atto: 'legge' } } },
    });

    const response = await request(app)
      .post('/api/notifications/normas/check')
      .set(authHeader(user))
      .send({ normaKey: 'legge--2--2021--1', normaData: { norma_data: { tipo_atto: 'legge' }, article_text: 'Testo baseline' } });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ watched: true, changed: false });

    const notifications = await request(app).get('/api/notifications/normas').set(authHeader(user));
    expect(notifications.body.filter((n: { watchId: string }) => n.watchId === watch.id)).toHaveLength(0);

    const stored = await prisma.normaWatch.findUnique({ where: { id: watch.id } });
    expect((stored?.normaData as { article_text?: string })?.article_text).toBe('Testo baseline');

    await prisma.normaWatch.deleteMany({ where: { userId: user.id } });
  });
});
