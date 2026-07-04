import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ensureIngestionJob } from '../../../../src/services/merlt/lazyIngest';
import type { GraphClient, IngestArticleResponse } from '../../../../src/services/merlt/graphClient';
import { prisma, createTestUser, type TestUser } from '../../../helpers';

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
