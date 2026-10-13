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
 * rows, deletes each once MERL-T answers that every store is done, and otherwise retries it
 * later, waiting longer each time (`backoffMs`). Nothing here throws to its caller: the
 * worker and the inline attempts run beside a request that must not fail because MERL-T is.
 */

export type ErasureReason = 'account_deleted' | 'user_request' | 'consent_revoked';

type Db = Prisma.TransactionClient | typeof prisma;

const DEFAULT_TIMEOUT_MS = 60_000;
const FIRST_RETRY_MS = 5 * 60 * 1000;
const MAX_RETRY_MS = 24 * 60 * 60 * 1000;

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

async function callMerlt(method: 'GET' | 'DELETE', userId: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(`${merltBase()}/api/v1/user-data/${encodeURIComponent(userId)}`, {
      method,
      headers: headers(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Ask MERL-T to erase. 'done', or a short reason that names no one (never MERL-T's body). */
async function eraseInMerlt(userId: string, ms: number): Promise<'done' | string> {
  try {
    const res = await callMerlt('DELETE', userId, ms);
    if (res.status === 200) return 'done';
    return `http_${res.status}`;
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
  let res: Response;
  try {
    res = await callMerlt('GET', userId, timeoutMs());
  } catch (err) {
    throw new MerltUnavailableError(err instanceof Error ? err.name : 'error');
  }
  if (res.status !== 200) throw new MerltUnavailableError(`http_${res.status}`);
  return res.json();
}

/** Record that the person's MERL-T data must go. Part of the caller's transaction. */
export async function requestMerltErasure(db: Db, userId: string, reason: ErasureReason): Promise<void> {
  await db.merltErasureRequest.create({ data: { userId, reason } });
}

/**
 * The person's MERL-T rows kept on this server: what they asked the assistant (`merlt_qa_jobs`),
 * the graph jobs and extraction jobs they started, MERL-T's authority cached for them. Not the
 * consent and its audit: those record the person's choice, and an account deletion takes them.
 */
export async function eraseLocalMerltData(db: Db, userId: string): Promise<void> {
  await db.merltQaJob.deleteMany({ where: { userId } });
  await db.merltIngestionJob.deleteMany({ where: { userId } });
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
  if (outcome === 'done') {
    // Every request for this person written before the attempt is satisfied by it.
    await prisma.merltErasureRequest.deleteMany({ where: { userId, requestedAt: { lte: startedAt } } });
    return true;
  }
  const pending = await prisma.merltErasureRequest.findMany({
    where: { userId },
    select: { id: true, attempts: true },
  });
  for (const row of pending) {
    await prisma.merltErasureRequest.update({
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
        if (await attempt(userId, timeoutMs())) done += 1;
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
