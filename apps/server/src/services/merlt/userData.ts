import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

/**
 * A person's MERL-T data, beyond this server: the copy MERL-T keeps, its export and its
 * erasure (MERL-T's `GET`/`DELETE /api/v1/user-data/{id}`, admin key, which take every store
 * MERL-T has: events, questions, feedback, profile, uploaded documents, graph contributors).
 *
 * An erasure is a row in `merlt_erasure_requests` first, written in the same transaction as
 * whatever asked for it (an account deletion, the person's own request, a revocation), so it
 * survives MERL-T being down and the server restarting. `processMerltErasures` sends the due
 * rows and retries a failed one later, waiting longer each time (`backoffMs`). Once MERL-T
 * answers that every store is done, a row that owes a second confirmation waits for it
 * (`confirmAgainAt`, an hour after the request: a deliberation or an extraction in flight at the
 * first pass can still write under the person's id), and goes after that one. An account deleted
 * and a revocation always owe it (nothing new can arrive after them); the person's own request,
 * with the consent still running, only when work was in flight, since the second pass also takes
 * what was collected in between. Nothing here
 * throws to its caller: the worker and the inline attempts run beside a request that must not
 * fail because MERL-T is.
 */

export type ErasureReason = 'account_deleted' | 'user_request' | 'consent_revoked';

type Db = Prisma.TransactionClient | typeof prisma;

const DEFAULT_TIMEOUT_MS = 60_000;
const FIRST_RETRY_MS = 5 * 60 * 1000;
const MAX_RETRY_MS = 24 * 60 * 60 * 1000;
/** Past the longest work MERL-T runs for a person (an extraction's job timeout is 30 minutes). */
export const CONFIRM_AGAIN_AFTER_MS = 60 * 60 * 1000;

function merltBase(): string {
  return process.env.MERLT_API_URL || 'http://localhost:8000';
}

function headers(): Record<string, string> {
  const key = process.env.MERLT_API_KEY;
  return key ? { 'X-API-Key': key } : {};
}

function timeoutMs(): number {
  const raw = Number(process.env.MERLT_USER_DATA_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/** How long to wait before the next attempt, after `attempts` failed ones. */
export function backoffMs(attempts: number): number {
  return Math.min(FIRST_RETRY_MS * 2 ** Math.max(attempts - 1, 0), MAX_RETRY_MS);
}

/** One call to MERL-T, the body read within the same time limit as the headers. */
async function callMerlt(method: 'GET' | 'DELETE', userId: string, ms: number): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(`${merltBase()}/api/v1/user-data/${encodeURIComponent(userId)}`, {
      method,
      headers: headers(),
      signal: controller.signal,
    });
    const body: unknown = res.status === 200 ? await res.json() : null;
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/** Ask MERL-T to erase. 'done', or a short reason that names no one (never MERL-T's body). */
async function eraseInMerlt(userId: string, ms: number): Promise<'done' | string> {
  try {
    const { status } = await callMerlt('DELETE', userId, ms);
    if (status === 200) return 'done';
    return `http_${status}`;
  } catch (err) {
    return err instanceof Error ? err.name : 'error';
  }
}

export class MerltUnavailableError extends Error {
  constructor(public readonly reason: string) {
    super(`MERL-T user data unavailable: ${reason}`);
    this.name = 'MerltUnavailableError';
  }
}

/** The copy MERL-T keeps of the person's data. Throws `MerltUnavailableError` when it cannot. */
export async function exportFromMerlt(userId: string): Promise<unknown> {
  let answer: { status: number; body: unknown };
  try {
    answer = await callMerlt('GET', userId, timeoutMs());
  } catch (err) {
    throw new MerltUnavailableError(err instanceof Error ? err.name : 'error');
  }
  if (answer.status !== 200) throw new MerltUnavailableError(`http_${answer.status}`);
  return answer.body;
}

/** Record that the person's MERL-T data must go. Part of the caller's transaction. */
const IN_FLIGHT = { in: ['pending', 'running'] as ('pending' | 'running')[] };

/** Whether MERL-T may still be working for the person: a question, an extraction or a graph job. */
async function workInFlight(db: Db, userId: string): Promise<boolean> {
  const [qa, extraction, ingestion] = await Promise.all([
    db.merltQaJob.count({ where: { userId, status: IN_FLIGHT } }),
    db.merltExtractionJob.count({ where: { userId, status: IN_FLIGHT } }),
    db.merltIngestionJob.count({ where: { userId, status: IN_FLIGHT } }),
  ]);
  return qa + extraction + ingestion > 0;
}

/**
 * Record that the person's MERL-T data must go. Part of the caller's transaction, and before the
 * caller deletes the local jobs: whether work is in flight is read from them.
 */
export async function requestMerltErasure(db: Db, userId: string, reason: ErasureReason): Promise<void> {
  const confirmAgain = reason !== 'user_request' || (await workInFlight(db, userId));
  await db.merltErasureRequest.create({
    data: { userId, reason, confirmAgainAt: confirmAgain ? new Date(Date.now() + CONFIRM_AGAIN_AFTER_MS) : null },
  });
}

/**
 * The person's MERL-T rows kept on this server: what they asked the assistant (`merlt_qa_jobs`),
 * the extraction jobs they started, the graph jobs they started once finished, MERL-T's
 * authority cached for them. A graph job still running stays: other readers of the same article
 * follow it (`routes/merlt/graph.ts` mirrors its status to theirs), and the second confirmation
 * takes it once it is done. Not the consent and its audit: those record the person's choice, and
 * an account deletion takes them.
 */
export async function eraseLocalMerltData(db: Db, userId: string): Promise<void> {
  await db.merltQaJob.deleteMany({ where: { userId } });
  await db.merltIngestionJob.deleteMany({ where: { userId, status: { in: ['completed', 'failed', 'timeout'] } } });
  await db.merltExtractionJob.deleteMany({ where: { userId } });
  await db.merltUserAuthorityCache.deleteMany({ where: { userId } });
}

/** Whether the person ever gave MERL-T a consent: without one, MERL-T never received their data. */
export async function everConsented(db: Db, userId: string): Promise<boolean> {
  const [preference, audit] = await Promise.all([
    db.merltUserPreference.findUnique({ where: { userId }, select: { id: true } }),
    db.merltConsentAudit.findFirst({ where: { userId, nextLevel: { not: 'none' } }, select: { id: true } }),
  ]);
  return preference !== null || audit !== null;
}

async function attempt(userId: string, ms: number): Promise<boolean> {
  const startedAt = new Date();
  const outcome = await eraseInMerlt(userId, ms);
  const rows = await prisma.merltErasureRequest.findMany({
    where: { userId, requestedAt: { lte: startedAt } },
    select: { id: true, attempts: true, confirmAgainAt: true, requestedAt: true },
  });
  if (outcome !== 'done') {
    // The status only: an id never goes to the logs. A 401 or a 404 is a configuration to fix.
    console.warn(`[merlt] erasure not confirmed by MERL-T (${outcome}); retried later`);
    for (const row of rows) {
      // updateMany: another attempt may have deleted the row meanwhile.
      await prisma.merltErasureRequest.updateMany({
        where: { id: row.id },
        data: {
          attempts: row.attempts + 1,
          lastError: outcome.slice(0, 100),
          nextAttemptAt: new Date(Date.now() + backoffMs(row.attempts + 1)),
        },
      });
    }
    return false;
  }
  // Confirmed. A request still owing its second confirmation waits for it; the others go.
  for (const row of rows) {
    if (row.confirmAgainAt && row.confirmAgainAt.getTime() > startedAt.getTime()) {
      await prisma.merltErasureRequest.updateMany({
        where: { id: row.id },
        data: { confirmAgainAt: null, nextAttemptAt: row.confirmAgainAt, attempts: 0, lastError: null },
      });
    } else {
      await prisma.merltErasureRequest.deleteMany({ where: { id: row.id } });
      // The person's graph jobs still running at the request are done by now; later ones stay.
      await prisma.merltIngestionJob.deleteMany({
        where: { userId, createdAt: { lte: row.requestedAt }, status: { in: ['completed', 'failed', 'timeout'] } },
      });
    }
  }
  return true;
}

/**
 * Try the person's pending erasure now, within `ms` (a short wait beside a request). True when
 * MERL-T confirmed it; false leaves it to the worker. Never throws.
 */
export async function attemptMerltErasureNow(userId: string, ms = 5_000): Promise<boolean> {
  try {
    return await attempt(userId, ms);
  } catch (err) {
    console.error('[merlt] erasure attempt failed:', err instanceof Error ? err.name : err);
    return false;
  }
}

let running: Promise<number> | null = null;

/**
 * Send the due requests, oldest first, one person at a time. Returns how many people's data
 * MERL-T confirmed erased. One pass at a time: a second call while one runs gets the same
 * promise. Never rejects.
 */
export function processMerltErasures(limit = 20): Promise<number> {
  if (running) return running;
  running = (async () => {
    let done = 0;
    try {
      const due = await prisma.merltErasureRequest.findMany({
        where: { nextAttemptAt: { lte: new Date() } },
        orderBy: { requestedAt: 'asc' },
        select: { userId: true },
        take: limit,
      });
      const people = [...new Set(due.map((row) => row.userId))];
      for (const userId of people) {
        // One person's failure never costs the others their turn.
        try {
          if (await attempt(userId, timeoutMs())) done += 1;
        } catch (err) {
          console.error('[merlt] erasure attempt failed:', err instanceof Error ? err.name : err);
        }
      }
    } catch (err) {
      console.error('[merlt] erasure pass failed:', err instanceof Error ? err.name : err);
    }
    return done;
  })().finally(() => {
    running = null;
  });
  return running;
}

const WORKER_INTERVAL_MS = 5 * 60 * 1000;

/**
 * The worker `index.ts` starts: a pass a minute after boot, then every five minutes. The timer
 * does not keep the process alive. Runs whether or not MERL-T is switched on here: requests
 * wait for it, and a pass with nothing due costs one query.
 */
export function startMerltErasureWorker(): NodeJS.Timeout {
  const first = setTimeout(() => void processMerltErasures(), 60_000);
  first.unref();
  const timer = setInterval(() => void processMerltErasures(), WORKER_INTERVAL_MS);
  timer.unref();
  return timer;
}
