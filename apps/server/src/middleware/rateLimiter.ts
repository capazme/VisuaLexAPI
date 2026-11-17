import { Request, Response, NextFunction } from 'express';
import {
  RateLimiterRedis,
  RateLimiterMemory,
  RateLimiterAbstract,
  RateLimiterRes,
} from 'rate-limiter-flexible';
import { getRedisClient } from '../utils/redis';
import { verifyToken, verifyTokenType } from '../utils/jwt';

// --- Tier configuration ---
const ANONYMOUS_POINTS = 100; // requests per window
const AUTHENTICATED_POINTS = 300;
const WRITE_POINTS = 200;
// The session check (GET /api/auth/me, G-484) has its own counter, outside the general one: the web asks
// it at every load, and a page that makes many calls used to spend the quota it needed (#459).
export const SESSION_CHECK_POINTS = 600;
const WINDOW_SECONDS = 60; // 1 minute

/**
 * A limiter on Redis when it is enabled, in this process's memory otherwise. On Redis, an error of the store
 * (Redis down or not ready) hands the count to a limiter in memory with the same limits (the
 * insurance limiter), so a limit still holds, per process, instead of letting every request through.
 */
export function createLimiter(keyPrefix: string, points: number, windowSeconds = WINDOW_SECONDS): RateLimiterAbstract {
  const memory = new RateLimiterMemory({
    keyPrefix,
    points,
    duration: windowSeconds,
  });
  const redis = getRedisClient();
  if (redis) {
    return new RateLimiterRedis({
      storeClient: redis,
      keyPrefix,
      points,
      duration: windowSeconds,
      rejectIfRedisNotReady: true,
      insuranceLimiter: memory,
    });
  }
  return memory;
}

const anonLimiter = createLimiter('rl:anon', ANONYMOUS_POINTS);
const authLimiter = createLimiter('rl:auth', AUTHENTICATED_POINTS);
const writeLimiter = createLimiter('rl:write', WRITE_POINTS);
const sessionCheckLimiter = createLimiter('rl:session-check', SESSION_CHECK_POINTS);

// Surface the chosen backend at startup so dev/prod mismatches are not silent.
const backend = anonLimiter instanceof RateLimiterRedis ? 'redis' : 'memory';
if (backend === 'memory') {
  console.warn(
    '[rateLimiter] using in-memory backend — counters are per-instance and reset on restart. ' +
    'Set REDIS_ENABLED=true and REDIS_URL in .env to enable shared Redis-backed rate limiting.'
  );
} else {
  console.info('[rateLimiter] using redis-backed backend');
}

/**
 * The user a request counts for, without failing: the one `delegatedAuth` or `webSession` set, else the one a
 * valid Bearer access token names; null otherwise.
 */
function identifyUser(req: Request): string | null {
  // An exchanged token (the MCP server calls for every user from one address,
  // so counting it by address would throttle them all together) or the web's
  // session cookie (an office behind one address would share the anonymous
  // tier): `delegatedAuth` or `webSession` already set the user.
  if (req.user) return req.user.id;
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const payload = verifyToken(header.substring(7));
  if (!payload || !verifyTokenType(payload, 'access')) return null;
  return payload.userId;
}

export function getClientIp(req: Request): string {
  // Relies on Express trust proxy setting for safe IP extraction.
  // Never read X-Forwarded-For directly — it's spoofable.
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

function setRateLimitHeaders(res: Response, limiterRes: RateLimiterRes, maxPoints: number): void {
  const resetTimestamp = Math.floor(Date.now() / 1000) + Math.ceil(limiterRes.msBeforeNext / 1000);
  res.set('RateLimit-Limit', String(maxPoints));
  res.set('RateLimit-Remaining', String(Math.max(0, limiterRes.remainingPoints)));
  res.set('RateLimit-Reset', String(resetTimestamp));
}

export function sendTooManyRequests(res: Response, limiterRes: RateLimiterRes): void {
  const retryAfter = Math.ceil(limiterRes.msBeforeNext / 1000);
  res.set('Retry-After', String(retryAfter));
  res.status(429).json({ detail: 'Too many requests, please try again later' });
}

/**
 * Global rate limiter middleware.
 * Anonymous: 100 req/min by IP. Authenticated: 300 req/min by userId.
 */
export const globalRateLimiter = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const userId = identifyUser(req);
  const limiter = userId ? authLimiter : anonLimiter;
  const key = userId || getClientIp(req);
  const maxPoints = userId ? AUTHENTICATED_POINTS : ANONYMOUS_POINTS;

  try {
    const result = await limiter.consume(key);
    setRateLimitHeaders(res, result, maxPoints);
    next();
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      sendTooManyRequests(res, err);
      return;
    }
    // Neither Redis nor the memory behind it answered (the insurance limiter of createLimiter):
    // fail-open, as a last resort, to avoid blocking all traffic.
    console.error('Rate limiter internal error (fail-open):', err);
    next();
  }
};

/**
 * The session check's own limit (G-484): `SESSION_CHECK_POINTS` a minute per user, or per address without a
 * valid token. Mounted in `app.ts` on GET /api/auth/me before the general limiter, which that route skips.
 */
export const sessionCheckRateLimiter = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const key = identifyUser(req) || getClientIp(req);
  try {
    const result = await sessionCheckLimiter.consume(key);
    setRateLimitHeaders(res, result, SESSION_CHECK_POINTS);
    next();
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      sendTooManyRequests(res, err);
      return;
    }
    console.error('Session check rate limiter internal error (fail-open):', err);
    next();
  }
};

/**
 * Write endpoint rate limiter middleware.
 * Applied on top of globalRateLimiter for POST/PUT/PATCH/DELETE: `WRITE_POINTS` (200) req/min.
 */
export const writeRateLimiter = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const userId = identifyUser(req);
  const key = userId || getClientIp(req);

  try {
    const result = await writeLimiter.consume(key);
    setRateLimitHeaders(res, result, WRITE_POINTS);
    next();
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      sendTooManyRequests(res, err);
      return;
    }
    console.error('Write rate limiter internal error (fail-open):', err);
    next();
  }
};
