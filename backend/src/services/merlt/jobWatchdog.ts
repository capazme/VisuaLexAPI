import type { PrismaClient } from '@prisma/client';

/**
 * Server-side safety net for the MERL-T worker → BFF callbacks.
 *
 * The happy path is: worker finishes a job and POSTs the result to the BFF
 * `/internal/*-callback` (now with retry + backoff). If that ever fails for
 * good (worker crash, BFF down for >12s, network partition), the BFF job row
 * gets stuck in `pending` forever. The watchdog sweeps periodically and
 * transitions any pending/running row older than the threshold to `timeout`,
 * so the polling UI unblocks and the same article/document can be retried.
 */

export interface SweepResult {
  extractFlipped: number;
  ingestFlipped: number;
  qaFlipped: number;
  qaJobsPurged: number;
}

const TIMEOUT_MARKER = 'watchdog: callback never arrived, flipped to timeout';

const DEFAULT_QA_STALE_AFTER_MS = 20 * 60 * 1000; // 20 minutes
const DEFAULT_QA_RETENTION_DAYS = 30;
// Note extraction runs up to MERLT_EXTRACT_JOB_TIMEOUT (1800s on the RQ side)
// plus queue wait and callback retries: sweeping it on the 10-minute ingestion
// net flipped every real extraction to `timeout` while the worker was still
// working, and the late `completed` callback then fought the UI.
export const DEFAULT_EXTRACT_STALE_AFTER_MS = 45 * 60 * 1000; // 45 minutes
export const DEFAULT_INGEST_STALE_AFTER_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Sweep stuck extraction/ingestion jobs on `createdAt` (unchanged, tighter
 * 10-min net) and QA jobs on `updatedAt` (liveness — see `qaStaleAfterMs`
 * doc below). Also purges old terminal QA jobs (`result` can carry tens/
 * hundreds of KB of pipeline_trace per row — retention keeps the table
 * bounded).
 */
export async function sweepStuckJobs(
  prisma: PrismaClient,
  staleAfterMs: number = DEFAULT_INGEST_STALE_AFTER_MS,
  qaStaleAfterMs: number = DEFAULT_QA_STALE_AFTER_MS,
  qaRetentionDays: number = DEFAULT_QA_RETENTION_DAYS,
  // Defaults to the ingestion threshold so existing positional callers keep
  // one net; the scheduler passes the (much longer) extraction net explicitly.
  extractStaleAfterMs: number = staleAfterMs,
): Promise<SweepResult> {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const extractCutoff = new Date(Date.now() - extractStaleAfterMs);
  const extract = await prisma.merltExtractionJob.updateMany({
    where: {
      status: { in: ['pending', 'running'] },
      createdAt: { lt: extractCutoff },
    },
    data: {
      status: 'timeout',
      errorMessage: TIMEOUT_MARKER,
      completedAt: new Date(),
    },
  });
  const ingest = await prisma.merltIngestionJob.updateMany({
    where: {
      status: { in: ['pending', 'running'] },
      createdAt: { lt: cutoff },
    },
    data: {
      status: 'timeout',
      errorMessage: TIMEOUT_MARKER,
      completedAt: new Date(),
    },
  });
  // Async progressive Q&A jobs (qa-async-progressive-contract.md): a lost
  // terminal callback would otherwise hang the FE poll loop forever. Swept
  // on a SEPARATE, higher threshold against `updatedAt` (last activity),
  // NOT `createdAt` — a heavy ReAct deliberation legitimately runs up to
  // ~11min, and each per-expert `running` callback bumps `updatedAt`, so a
  // job still emitting partials keeps resetting its clock. Only genuine
  // silence (crashed MERL-T / lost callbacks) trips the sweep.
  const qaCutoff = new Date(Date.now() - qaStaleAfterMs);
  const qa = await prisma.merltQaJob.updateMany({
    where: {
      status: { in: ['pending', 'running'] },
      updatedAt: { lt: qaCutoff },
    },
    data: {
      status: 'timeout',
      errorMessage: TIMEOUT_MARKER,
      completedAt: new Date(),
    },
  });
  // Retention: terminal QA jobs older than qaRetentionDays are purged —
  // `result` stores the full ExpertQueryResponse (incl. pipeline_trace),
  // unbounded growth otherwise.
  const retentionCutoff = new Date(Date.now() - qaRetentionDays * 24 * 60 * 60 * 1000);
  const purged = await prisma.merltQaJob.deleteMany({
    where: {
      status: { in: ['completed', 'failed', 'timeout'] },
      createdAt: { lt: retentionCutoff },
    },
  });
  return {
    extractFlipped: extract.count,
    ingestFlipped: ingest.count,
    qaFlipped: qa.count,
    qaJobsPurged: purged.count,
  };
}

/**
 * Schedule periodic sweeps. Returns the interval handle so the caller can
 * clear it (tests; graceful shutdown). Default cadence 5 minutes.
 */
export function scheduleStuckJobSweeper(
  prisma: PrismaClient,
  options: {
    intervalMs?: number;
    staleAfterMs?: number;
    extractStaleAfterMs?: number;
    qaStaleAfterMs?: number;
    qaRetentionDays?: number;
    logger?: (msg: string, data?: unknown) => void;
  } = {},
): NodeJS.Timeout {
  const intervalMs = options.intervalMs ?? 5 * 60 * 1000;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_INGEST_STALE_AFTER_MS;
  const extractStaleAfterMs = options.extractStaleAfterMs ?? DEFAULT_EXTRACT_STALE_AFTER_MS;
  const qaStaleAfterMs = options.qaStaleAfterMs ?? DEFAULT_QA_STALE_AFTER_MS;
  const qaRetentionDays = options.qaRetentionDays ?? DEFAULT_QA_RETENTION_DAYS;
  const log = options.logger ?? ((msg: string, data?: unknown) => console.log(`[watchdog] ${msg}`, data ?? ''));
  const run = (): void => {
    sweepStuckJobs(prisma, staleAfterMs, qaStaleAfterMs, qaRetentionDays, extractStaleAfterMs)
      .then((r) => {
        if (r.extractFlipped > 0 || r.ingestFlipped > 0 || r.qaFlipped > 0 || r.qaJobsPurged > 0) {
          log('flipped stuck jobs', r);
        }
      })
      .catch((err) => log('sweep error', err instanceof Error ? err.message : err));
  };
  // Initial sweep at startup catches zombies left by a previous crash.
  run();
  return setInterval(run, intervalMs);
}
