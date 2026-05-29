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
}

const TIMEOUT_MARKER = 'watchdog: callback never arrived, flipped to timeout';

export async function sweepStuckJobs(
  prisma: PrismaClient,
  staleAfterMs: number = 10 * 60 * 1000, // 10 minutes
): Promise<SweepResult> {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const extract = await prisma.merltExtractionJob.updateMany({
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
  return { extractFlipped: extract.count, ingestFlipped: ingest.count };
}

/**
 * Schedule periodic sweeps. Returns the interval handle so the caller can
 * clear it (tests; graceful shutdown). Default cadence 5 minutes.
 */
export function scheduleStuckJobSweeper(
  prisma: PrismaClient,
  options: { intervalMs?: number; staleAfterMs?: number; logger?: (msg: string, data?: unknown) => void } = {},
): NodeJS.Timeout {
  const intervalMs = options.intervalMs ?? 5 * 60 * 1000;
  const staleAfterMs = options.staleAfterMs ?? 10 * 60 * 1000;
  const log = options.logger ?? ((msg: string, data?: unknown) => console.log(`[watchdog] ${msg}`, data ?? ''));
  const run = (): void => {
    sweepStuckJobs(prisma, staleAfterMs)
      .then((r) => {
        if (r.extractFlipped > 0 || r.ingestFlipped > 0) {
          log('flipped stuck jobs', r);
        }
      })
      .catch((err) => log('sweep error', err instanceof Error ? err.message : err));
  };
  // Initial sweep at startup catches zombies left by a previous crash.
  run();
  return setInterval(run, intervalMs);
}
