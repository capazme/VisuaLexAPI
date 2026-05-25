import type { PrismaClient } from '@prisma/client';
import type { GraphClient } from './graphClient';

/**
 * Idempotently ensure an ingestion job exists for an article URN (Slice 2a).
 *
 * Shared by the explicit POST /graph/ingest route and the opportunistic lazy
 * trigger on `article:viewed` (MERLT-2a.5). Behaviour:
 *
 *  1. If a job for this URN is already pending/running, return it (created=false).
 *  2. Otherwise create a pending job, then best-effort ask MERL-T to enqueue,
 *     threading the BFF job id as bff_job_id so the worker can call back.
 *
 * The MERL-T enqueue is best-effort: a failure is logged but never thrown, so
 * the BFF job record survives even if MERL-T is momentarily down (the worker
 * may still pick it up, or a later view re-enqueues).
 *
 * The findFirst+create is NOT transactionally guarded — two simultaneous calls
 * could both create a row. That race is benign: RQ dedupes downstream via a
 * deterministic job_id = sha256(urn), so only one ingestion actually runs.
 */
export interface EnsureIngestionResult {
  jobId: string;
  status: string;
  created: boolean;
}

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
    return { jobId: existing.id, status: existing.status, created: false };
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
