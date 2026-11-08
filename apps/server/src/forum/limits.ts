import { RateLimiterRes, type RateLimiterAbstract } from 'rate-limiter-flexible';
import { createLimiter } from '../middleware/rateLimiter';
import { AppError } from '../middleware/errorHandler';

const DAY_SECONDS = 24 * 60 * 60;

/**
 * The Community's per-user daily counters (spec 2026-10-20-forum-community-glosse-design §5.8, G-392): a
 * 24-hour window from the first write, as the MCP's named counters; Redis when enabled, in memory
 * otherwise. The numbers are environment variables with these defaults.
 */
const COUNTERS = {
  glossa: { env: 'FORUM_DAILY_GLOSSE', fallback: 10, said: (n: number) => `Hai pubblicato ${n} glosse nelle ultime 24 ore: riprova più tardi.` },
  reply: { env: 'FORUM_DAILY_REPLIES', fallback: 60, said: (n: number) => `Hai pubblicato ${n} risposte e commenti nelle ultime 24 ore: riprova più tardi.` },
  report: { env: 'FORUM_DAILY_REPORTS', fallback: 20, said: (n: number) => `Hai inviato ${n} segnalazioni nelle ultime 24 ore: riprova più tardi.` },
  edit: { env: 'FORUM_DAILY_EDITS', fallback: 60, said: (n: number) => `Hai fatto ${n} modifiche nelle ultime 24 ore: riprova più tardi.` },
} as const;
export type CommunityCounter = keyof typeof COUNTERS;

function pointsOf(counter: CommunityCounter): number {
  const raw = Number(process.env[COUNTERS[counter].env]);
  return Number.isInteger(raw) && raw > 0 ? raw : COUNTERS[counter].fallback;
}

// One limiter per counter and number: a number changed in the environment takes a fresh window.
const limiters = new Map<string, RateLimiterAbstract>();
function limiterOf(counter: CommunityCounter, points: number) {
  const key = `${counter}:${points}`;
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = createLimiter(`rl:forum-${counter}`, points, DAY_SECONDS);
    limiters.set(key, limiter);
  }
  return limiter;
}

/**
 * Runs a write under its daily counter: one point, given back when the write is refused (a 4xx of its
 * own or any failure), so a refused write costs nothing. Over the count, an Italian 429 that promises
 * no calendar day. A limiter error lets the write through, as everywhere else.
 */
export async function withDailyLimit<T>(counter: CommunityCounter, userId: string, write: () => Promise<T>): Promise<T> {
  const points = pointsOf(counter);
  const limiter = limiterOf(counter, points);
  let consumed = false;
  try {
    await limiter.consume(userId);
    consumed = true;
  } catch (error) {
    if (error instanceof RateLimiterRes) {
      // A refused consume still counts in the limiter: give it back.
      await limiter.reward(userId, 1).catch(() => undefined);
      throw new AppError(429, COUNTERS[counter].said(points));
    }
    console.error('Community limiter error (fail-open):', error instanceof Error ? error.name : typeof error);
  }
  try {
    return await write();
  } catch (error) {
    if (consumed) await limiter.reward(userId, 1).catch(() => undefined);
    throw error;
  }
}
