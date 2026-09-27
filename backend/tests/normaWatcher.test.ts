import { describe, expect, it, vi, afterEach } from 'vitest';
import { compareNormaSnapshots, runNormaWatcher, startNormaWatcher } from '../src/utils/normaWatcher';
import { prisma, createTestUser, type TestUser } from './helpers';

describe('compareNormaSnapshots', () => {
  it('is unchanged when article_text is identical', () => {
    const previous = { norma_data: { a: 1 }, article_text: 'Same text' };
    const next = { norma_data: { a: 2 }, article_text: 'Same text' };
    expect(compareNormaSnapshots(previous, next)).toBe('unchanged');
  });

  it('is changed when article_text differs', () => {
    const previous = { norma_data: {}, article_text: 'Old text' };
    const next = { norma_data: {}, article_text: 'New text' };
    expect(compareNormaSnapshots(previous, next)).toBe('changed');
  });

  it('is a baseline transition when the stored snapshot has no article_text', () => {
    const previous = { norma_data: { tipo_atto: 'legge' } };
    const next = { norma_data: { tipo_atto: 'legge' }, article_text: 'First real text' };
    expect(compareNormaSnapshots(previous, next)).toBe('baseline');
  });

  it('is a baseline transition when the stored article_text is an empty string', () => {
    const previous = { norma_data: {}, article_text: '' };
    const next = { norma_data: {}, article_text: 'First real text' };
    expect(compareNormaSnapshots(previous, next)).toBe('baseline');
  });
});

describe('startNormaWatcher', () => {
  const originalEnabled = process.env.NORMA_WATCH_ENABLED;

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.NORMA_WATCH_ENABLED;
    else process.env.NORMA_WATCH_ENABLED = originalEnabled;
  });

  it('returns null and does not schedule anything when disabled', () => {
    process.env.NORMA_WATCH_ENABLED = 'false';
    expect(startNormaWatcher()).toBeNull();
  });

  it('also disables on "0"', () => {
    process.env.NORMA_WATCH_ENABLED = '0';
    expect(startNormaWatcher()).toBeNull();
  });

  it('schedules a timer when enabled (default)', () => {
    delete process.env.NORMA_WATCH_ENABLED;
    const timer = startNormaWatcher();
    expect(timer).not.toBeNull();
    clearInterval(timer as NodeJS.Timeout);
  });
});

describe('runNormaWatcher', () => {
  let user: TestUser;
  const originalLegalApiUrl = process.env.LEGAL_API_URL;

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (originalLegalApiUrl === undefined) delete process.env.LEGAL_API_URL;
    else process.env.LEGAL_API_URL = originalLegalApiUrl;
    if (user) {
      await prisma.normaChangeNotification.deleteMany({ where: { userId: user.id } });
      await prisma.normaWatch.deleteMany({ where: { userId: user.id } });
    }
  });

  async function seedWatch(normaKey: string, storedSnapshot: unknown) {
    // A fresh user per call: setup.ts truncates `users` (CASCADE) before every
    // test, so reusing a `user` created in an earlier test would point
    // `seedWatch` at a userId that no longer exists.
    user = await createTestUser(`watcher-${normaKey}`);
    return prisma.normaWatch.create({
      data: { userId: user.id, normaKey, normaData: storedSnapshot as object },
    });
  }

  it('requests <base>/fetch_article_text and creates one notification when the text changed', async () => {
    process.env.LEGAL_API_URL = 'http://legal-api.test';
    const watch = await seedWatch('legge--1--2020--1', {
      norma_data: { tipo_atto: 'legge', numero_atto: '1', data: '2020' },
      article_text: 'Old text',
    });

    // Note: runNormaWatcher wraps each watch's check in its own try/catch (so
    // one broken watch does not stop the batch) — an assertion thrown from
    // inside the mock would be swallowed as a warning rather than failing the
    // test. Record the call and assert on it afterwards instead.
    const calledUrls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calledUrls.push(url);
      return {
        ok: true,
        json: async () => [{ norma_data: { tipo_atto: 'legge' }, article_text: 'New text' }],
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await runNormaWatcher();

    expect(calledUrls).toEqual(['http://legal-api.test/fetch_article_text']);
    const updated = await prisma.normaWatch.findUnique({ where: { id: watch.id } });
    expect((updated?.normaData as { article_text?: string })?.article_text).toBe('New text');

    const notifications = await prisma.normaChangeNotification.findMany({ where: { watchId: watch.id } });
    expect(notifications).toHaveLength(1);
  });

  it('strips a trailing slash on the base URL instead of producing a double slash', async () => {
    process.env.LEGAL_API_URL = 'http://legal-api.test/';
    await seedWatch('legge--2--2020--1', {
      norma_data: { tipo_atto: 'legge' },
      article_text: 'Old text',
    });

    const calledUrls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calledUrls.push(url);
      return { ok: true, json: async () => [{ norma_data: {}, article_text: 'Old text' }] };
    });
    vi.stubGlobal('fetch', fetchMock);

    await runNormaWatcher();
    expect(calledUrls).toEqual(['http://legal-api.test/fetch_article_text']);
  });

  it('creates no notification when the text is unchanged', async () => {
    process.env.LEGAL_API_URL = 'http://legal-api.test';
    const watch = await seedWatch('legge--3--2020--1', {
      norma_data: { tipo_atto: 'legge' },
      article_text: 'Same text',
    });

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => [{ norma_data: { tipo_atto: 'legge' }, article_text: 'Same text' }],
    })));

    await runNormaWatcher();

    const notifications = await prisma.normaChangeNotification.findMany({ where: { watchId: watch.id } });
    expect(notifications).toHaveLength(0);
    const updated = await prisma.normaWatch.findUnique({ where: { id: watch.id } });
    expect(updated?.lastSeenAt.getTime()).toBeGreaterThan(watch.lastSeenAt.getTime() - 1);
  });

  it('writes nothing when the response has no object norma_data', async () => {
    process.env.LEGAL_API_URL = 'http://legal-api.test';
    const watch = await seedWatch('legge--4--2020--1', {
      norma_data: { tipo_atto: 'legge' },
      article_text: 'Old text',
    });

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => [{ article_text: 'New text' }], // norma_data missing
    })));

    await runNormaWatcher();

    const notifications = await prisma.normaChangeNotification.findMany({ where: { watchId: watch.id } });
    expect(notifications).toHaveLength(0);
    const updated = await prisma.normaWatch.findUnique({ where: { id: watch.id } });
    expect((updated?.normaData as { article_text?: string })?.article_text).toBe('Old text');
    // A no-op still moves the watch to the back of the queue.
    expect(updated?.lastSeenAt.getTime()).toBeGreaterThanOrEqual(watch.lastSeenAt.getTime());
  });

  it('advances lastSeenAt on a failed fetch, so a dead watch cannot starve the batch', async () => {
    process.env.LEGAL_API_URL = 'http://legal-api.test';
    const watch = await seedWatch('legge--6--2020--1', {
      norma_data: { tipo_atto: 'legge' },
      article_text: 'Old text',
    });
    await prisma.normaWatch.update({ where: { id: watch.id }, data: { lastSeenAt: new Date(Date.now() - 60_000) } });

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));

    await runNormaWatcher();

    const updated = await prisma.normaWatch.findUnique({ where: { id: watch.id } });
    expect(updated?.lastSeenAt.getTime()).toBeGreaterThan(Date.now() - 10_000);
    expect((updated?.normaData as { article_text?: string })?.article_text).toBe('Old text');
    expect(await prisma.normaChangeNotification.count({ where: { watchId: watch.id } })).toBe(0);
  });

  it('writes nothing when article_text is missing or empty', async () => {
    process.env.LEGAL_API_URL = 'http://legal-api.test';
    const watch = await seedWatch('legge--5--2020--1', {
      norma_data: { tipo_atto: 'legge' },
      article_text: 'Old text',
    });

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => [{ norma_data: { tipo_atto: 'legge' }, article_text: '' }],
    })));

    await runNormaWatcher();

    const updated = await prisma.normaWatch.findUnique({ where: { id: watch.id } });
    expect((updated?.normaData as { article_text?: string })?.article_text).toBe('Old text');
  });
});
