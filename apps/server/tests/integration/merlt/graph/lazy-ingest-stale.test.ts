import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ensureIngestionJob } from '../../../../src/services/merlt/lazyIngest';
import type { GraphClient, IngestArticleResponse } from '../../../../src/services/merlt/graphClient';
import { prisma, createTestUser, request, app, type TestUser } from '../../../helpers';

/**
 * Wave 1 cluster D — ingestion deadlock fix.
 *
 * A pending/running MerltIngestionJob whose worker callback never arrives used
 * to block re-ingestion of that URN forever: the idempotency findFirst always
 * returned the zombie row. ensureIngestionJob now treats in-flight rows older
 * than MERLT_INGEST_STALE_MS (default 10 min) as stale: it flips them to
 * `timeout` and creates + enqueues a fresh job.
 */

const URN = 'urn:nir:stato:codice.civile:1942;262~art2043';

interface EnqueueCall {
  urn: string;
  bffJobId: string;
}

function fakeGraphClient(): { client: GraphClient; calls: EnqueueCall[] } {
  const calls: EnqueueCall[] = [];
  const client = {
    ingestArticle: async (urn: string, bffJobId: string): Promise<IngestArticleResponse> => {
      calls.push({ urn, bffJobId });
      return { task_id: `rq-task-${calls.length}`, status: 'queued', urn };
    },
  } as unknown as GraphClient;
  return { client, calls };
}

let user: TestUser;

beforeEach(async () => {
  user = await createTestUser('stale-ingest');
});

afterEach(() => {
  delete process.env.MERLT_INGEST_STALE_MS;
  delete process.env.MERLT_INTERNAL_SECRET;
});

describe('ensureIngestionJob stale-TTL deadlock breaker', () => {
  it('returns a FRESH in-flight job without re-enqueueing (idempotency unchanged)', async () => {
    const existing = await prisma.merltIngestionJob.create({
      data: { articleUrn: URN, userId: user.id, status: 'pending' },
    });
    const { client, calls } = fakeGraphClient();

    const result = await ensureIngestionJob(prisma, client, URN, user.id);

    expect(result.created).toBe(false);
    expect(result.jobId).toBe(existing.id);
    expect(calls).toHaveLength(0);
  });

  it('flips a STALE pending job to timeout and creates + enqueues a new one', async () => {
    const staleCreated = new Date(Date.now() - 20 * 60 * 1000); // 20 min > 10 min TTL
    const zombie = await prisma.merltIngestionJob.create({
      data: { articleUrn: URN, userId: user.id, status: 'pending', createdAt: staleCreated },
    });
    const { client, calls } = fakeGraphClient();

    const result = await ensureIngestionJob(prisma, client, URN, user.id);

    expect(result.created).toBe(true);
    expect(result.jobId).not.toBe(zombie.id);

    const flipped = await prisma.merltIngestionJob.findUnique({ where: { id: zombie.id } });
    expect(flipped?.status).toBe('timeout');
    expect(flipped?.errorMessage).toContain('stale');
    expect(flipped?.completedAt).not.toBeNull();

    // The fresh job got enqueued toward MERL-T with ITS id as bff_job_id
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ urn: URN, bffJobId: result.jobId });

    const fresh = await prisma.merltIngestionJob.findUnique({ where: { id: result.jobId } });
    expect(fresh?.status).toBe('pending');
    expect(fresh?.taskId).toBe('rq-task-1');
  });

  it('flips a STALE running job too (lost completed callback)', async () => {
    const staleCreated = new Date(Date.now() - 20 * 60 * 1000);
    const zombie = await prisma.merltIngestionJob.create({
      data: {
        articleUrn: URN,
        userId: user.id,
        status: 'running',
        createdAt: staleCreated,
        startedAt: staleCreated,
      },
    });
    const { client } = fakeGraphClient();

    const result = await ensureIngestionJob(prisma, client, URN, user.id);

    expect(result.created).toBe(true);
    const flipped = await prisma.merltIngestionJob.findUnique({ where: { id: zombie.id } });
    expect(flipped?.status).toBe('timeout');
  });

  it('honours the MERLT_INGEST_STALE_MS env override', async () => {
    process.env.MERLT_INGEST_STALE_MS = '1000'; // 1s TTL
    const recentButStale = new Date(Date.now() - 5000); // 5s ago
    const zombie = await prisma.merltIngestionJob.create({
      data: { articleUrn: URN, userId: user.id, status: 'pending', createdAt: recentButStale },
    });
    const { client } = fakeGraphClient();

    const result = await ensureIngestionJob(prisma, client, URN, user.id);

    expect(result.created).toBe(true);
    const flipped = await prisma.merltIngestionJob.findUnique({ where: { id: zombie.id } });
    expect(flipped?.status).toBe('timeout');
  });

  it('ignores an invalid MERLT_INGEST_STALE_MS and falls back to the 10 min default', async () => {
    process.env.MERLT_INGEST_STALE_MS = 'not-a-number';
    const existing = await prisma.merltIngestionJob.create({
      data: { articleUrn: URN, userId: user.id, status: 'pending' }, // fresh
    });
    const { client, calls } = fakeGraphClient();

    const result = await ensureIngestionJob(prisma, client, URN, user.id);

    expect(result.created).toBe(false);
    expect(result.jobId).toBe(existing.id);
    expect(calls).toHaveLength(0);
  });

  it('a completed job never blocks a new one (unchanged behaviour)', async () => {
    await prisma.merltIngestionJob.create({
      data: { articleUrn: URN, userId: user.id, status: 'completed' },
    });
    const { client, calls } = fakeGraphClient();

    const result = await ensureIngestionJob(prisma, client, URN, user.id);

    expect(result.created).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

/**
 * Per-article key + per-user rows.
 *
 * MERL-T runs ONE job per normalized urn and calls back ONE bff_job_id. The
 * BFF therefore (a) keys rows on the normalized urn so `!vig=` variants never
 * create a second, callback-less row, (b) gives a second reader a MIRROR row
 * of their own (the status route is owner-scoped, a foreign id would 404 their
 * poll) and (c) fans the worker callback out to every in-flight row of the
 * article.
 */
describe('ensureIngestionJob per-article key and per-user rows', () => {
  it('coalesces urn version variants onto one normalized key and one enqueue', async () => {
    const { client, calls } = fakeGraphClient();

    const first = await ensureIngestionJob(prisma, client, `${URN}!vig=`, user.id);
    const second = await ensureIngestionJob(prisma, client, `${URN}@originale`, user.id);
    const third = await ensureIngestionJob(prisma, client, `${URN}!vig=2024-01-15`, user.id);

    expect(first.created).toBe(true);
    expect(second.jobId).toBe(first.jobId);
    expect(third.jobId).toBe(first.jobId);
    expect(calls).toHaveLength(1);
    expect(calls[0].urn).toBe(URN);
    const rows = await prisma.merltIngestionJob.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].articleUrn).toBe(URN);
  });

  it('gives a second reader a mirror row instead of the foreign job id', async () => {
    const bob = await createTestUser('stale-ingest-bob');
    const { client, calls } = fakeGraphClient();

    const alice = await ensureIngestionJob(prisma, client, URN, user.id);
    const mirror = await ensureIngestionJob(prisma, client, URN, bob.id);

    expect(mirror.created).toBe(false);
    expect(mirror.jobId).not.toBe(alice.jobId);
    expect(calls).toHaveLength(1); // no second enqueue
    const row = await prisma.merltIngestionJob.findUnique({ where: { id: mirror.jobId } });
    expect(row?.userId).toBe(bob.id);
    expect(row?.status).toBe('pending');
    expect(row?.taskId).toBe('rq-task-1');

    // Bob asks again: his own row, still no enqueue.
    const again = await ensureIngestionJob(prisma, client, URN, bob.id);
    expect(again.jobId).toBe(mirror.jobId);
    expect(calls).toHaveLength(1);
  });

  it('the worker callback on the primary completes the mirror rows too', async () => {
    process.env.MERLT_INTERNAL_SECRET = 'test-internal-secret';
    const bob = await createTestUser('stale-ingest-bob2');
    const { client } = fakeGraphClient();
    const alice = await ensureIngestionJob(prisma, client, URN, user.id);
    const mirror = await ensureIngestionJob(prisma, client, URN, bob.id);
    // A row of a DIFFERENT article must not be touched.
    const other = await prisma.merltIngestionJob.create({
      data: { articleUrn: `${URN}bis`, userId: bob.id, status: 'pending' },
    });

    const running = await request(app)
      .post('/api/merlt/internal/job-callback')
      .set('X-Internal-Secret', 'test-internal-secret')
      .send({ bffJobId: alice.jobId, status: 'running' });
    expect(running.status).toBe(200);
    expect((await prisma.merltIngestionJob.findUnique({ where: { id: mirror.jobId } }))?.status).toBe(
      'running'
    );

    const done = await request(app)
      .post('/api/merlt/internal/job-callback')
      .set('X-Internal-Secret', 'test-internal-secret')
      .send({ bffJobId: alice.jobId, status: 'completed', nodesCreated: 7, edgesCreated: 4 });
    expect(done.status).toBe(200);

    const mirrorRow = await prisma.merltIngestionJob.findUnique({ where: { id: mirror.jobId } });
    expect(mirrorRow?.status).toBe('completed');
    expect(mirrorRow?.nodesCreated).toBe(7);
    expect(mirrorRow?.completedAt).not.toBeNull();
    expect((await prisma.merltIngestionJob.findUnique({ where: { id: other.id } }))?.status).toBe(
      'pending'
    );
  });

  it('a stale primary flips its (younger) mirror rows too before re-enqueueing', async () => {
    const bob = await createTestUser('stale-ingest-bob3');
    const staleCreated = new Date(Date.now() - 20 * 60 * 1000);
    const zombie = await prisma.merltIngestionJob.create({
      data: { articleUrn: URN, userId: user.id, status: 'running', createdAt: staleCreated },
    });
    const mirror = await prisma.merltIngestionJob.create({
      data: { articleUrn: URN, userId: bob.id, status: 'running' },
    });
    const { client, calls } = fakeGraphClient();

    const result = await ensureIngestionJob(prisma, client, URN, bob.id);

    expect(result.created).toBe(true);
    expect(calls).toHaveLength(1);
    expect((await prisma.merltIngestionJob.findUnique({ where: { id: zombie.id } }))?.status).toBe(
      'timeout'
    );
    expect((await prisma.merltIngestionJob.findUnique({ where: { id: mirror.id } }))?.status).toBe(
      'timeout'
    );
  });
});
