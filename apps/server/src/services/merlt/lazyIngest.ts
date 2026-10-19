import type { Prisma, PrismaClient } from '@prisma/client';
import { normalizeGraphUrn, type GraphClient } from './graphClient';

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
  // One key per article. VisuaLex urns carry version markers (`!vig=`,
  // `@originale`) that never reach MERL-T, which dedupes on the normalized
  // urn and answers `already_queued` WITHOUT recording a second bff_job_id:
  // a row keyed on a raw variant would never receive its callback and would
  // sit pending until the watchdog. The same key also lets the job-callback
  // fan out to every row of this article (see routes/merlt/graph.ts).
  const key = normalizeGraphUrn(urn);
  const inFlight: Prisma.MerltIngestionJobWhereInput = {
    articleUrn: key,
    status: { in: ['pending', 'running'] },
  };

  // The OLDEST in-flight row is the one MERL-T is actually running; mirror
  // rows (below) are younger and must not hide a stale primary.
  const primary = await prisma.merltIngestionJob.findFirst({
    where: inFlight,
    orderBy: { createdAt: 'asc' },
  });
  if (primary) {
    const isStale = primary.createdAt.getTime() < Date.now() - ingestStaleAfterMs();
    if (!isStale) {
      const own =
        primary.userId === userId
          ? primary
          : await prisma.merltIngestionJob.findFirst({ where: { ...inFlight, userId } });
      if (own) {
        return { jobId: own.id, status: own.status, created: false };
      }
      // Another reader already started this ingestion. The status route is
      // owner-scoped (no IDOR), so handing this user the foreign id would
      // make their poll 404 and the rail give up. Give them a row of their
      // own that tracks the running job; the worker callback fans out to it.
      const mirror = await prisma.merltIngestionJob.create({
        data: {
          articleUrn: key,
          userId,
          status: primary.status,
          taskId: primary.taskId,
          startedAt: primary.startedAt,
        },
      });
      return { jobId: mirror.id, status: mirror.status, created: false };
    }
    // Deadlock-breaker: flip the zombie rows (primary and its mirrors) to
    // timeout so a fresh job can be created below. Status-guarded updateMany
    // so a late worker callback that already completed a row is never clobbered.
    await prisma.merltIngestionJob.updateMany({
      where: inFlight,
      data: {
        status: 'timeout',
        errorMessage: STALE_MARKER,
        completedAt: new Date(),
      },
    });
  }

  const job = await prisma.merltIngestionJob.create({
    data: { articleUrn: key, userId, status: 'pending' },
  });

  try {
    const enqueued = await graphClient.ingestArticle(key, job.id);
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
