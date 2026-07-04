import type { PrismaClient } from '@prisma/client';
import type { GraphClient } from './graphClient';

/**
 * Idempotently ensure an ingestion job exists for an article URN (Slice 2a).
 *
 * Shared by the explicit POST /graph/ingest route and the opportunistic lazy
 * trigger on `article:viewed` (MERLT-2a.5). Behaviour:
 *
 *  1. If a FRESH job for this URN is already pending/running, return it
 *     (created=false).
 *  2. If the in-flight job is STALE (older than MERLT_INGEST_STALE_MS,
 *     default 10 min — worker died / callback lost), flip it to `timeout`
 *     and fall through: without this, the idempotency check would block any
 *     re-ingestion of the URN forever (the "menzioni" deadlock).
 *  3. Otherwise create a pending job, then best-effort ask MERL-T to enqueue,
 *     threading the BFF job id as bff_job_id so the worker can call back.
 *
 * The MERL-T enqueue is best-effort: a failure is logged but never thrown, so
 * the BFF job record survives even if MERL-T is momentarily down (the worker
 * may still pick it up, or a later view re-enqueues).
 *
 * The findFirst+create is NOT transactionally guarded — two simultaneous calls
 * could both create a row. That race is benign: RQ dedupes downstream via a
 * deterministic job_id = sha256(urn), so only one ingestion actually runs.
 *
 * The periodic jobWatchdog sweeper covers the same stale rows in bulk; the
 * inline check here closes the window between sweeps (up to interval+TTL)
 * where a user retry would otherwise still hit the stale row.
 */
export interface EnsureIngestionResult {
  jobId: string;
  status: string;
  created: boolean;
}

const DEFAULT_STALE_AFTER_MS = 10 * 60 * 1000; // 10 minutes

/** TTL after which a pending/running job with no callback is considered dead. */
function ingestStaleAfterMs(): number {
  const raw = Number.parseInt(process.env.MERLT_INGEST_STALE_MS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STALE_AFTER_MS;
}

const STALE_MARKER = 'lazy-ingest: stale in-flight job superseded by re-enqueue';

export async function ensureIngestionJob(
  prisma: PrismaClient,
  graphClient: GraphClient,
  urn: string,
  userId: string
): Promise<EnsureIngestionResult> {
  const existing = await prisma.merltIngestionJob.findFirst({
    where: { articleUrn: urn, status: { in: ['pending', 'running'] } },
  });
  if (existing) {
    const isStale = existing.createdAt.getTime() < Date.now() - ingestStaleAfterMs();
    if (!isStale) {
      return { jobId: existing.id, status: existing.status, created: false };
    }
    // Deadlock-breaker: flip the zombie row to timeout so a fresh job can be
    // created below. Status-guarded updateMany so a late worker callback that
    // already completed the row in the meantime is never clobbered.
    await prisma.merltIngestionJob.updateMany({
      where: { id: existing.id, status: { in: ['pending', 'running'] } },
      data: {
        status: 'timeout',
        errorMessage: STALE_MARKER,
        completedAt: new Date(),
      },
    });
  }

  const job = await prisma.merltIngestionJob.create({
    data: { articleUrn: urn, userId, status: 'pending' },
  });

  try {
    const enqueued = await graphClient.ingestArticle(urn, job.id);
    if (enqueued?.task_id) {
      await prisma.merltIngestionJob.update({
        where: { id: job.id },
        data: { taskId: enqueued.task_id },
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `merlt lazy ingest: failed to enqueue MERL-T job for urn=${urn} jobId=${job.id}:`,
      err instanceof Error ? err.message : String(err)
    );
  }

  return { jobId: job.id, status: 'pending', created: true };
}
