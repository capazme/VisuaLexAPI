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
const WRITE_POINTS = 20;
const WINDOW_SECONDS = 60; // 1 minute

function createLimiter(keyPrefix: string, points: number): RateLimiterAbstract {
  const redis = getRedisClient();
  if (redis) {
    return new RateLimiterRedis({
      storeClient: redis,
      keyPrefix,
      points,
      duration: WINDOW_SECONDS,
    });
  }
  return new RateLimiterMemory({
    keyPrefix,
    points,
    duration: WINDOW_SECONDS,
  });
}

const anonLimiter = createLimiter('rl:anon', ANONYMOUS_POINTS);
const authLimiter = createLimiter('rl:auth', AUTHENTICATED_POINTS);
const writeLimiter = createLimiter('rl:write', WRITE_POINTS);

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
 * Try to identify the user from the Authorization header without failing.
 * Returns userId if valid access token, null otherwise.
 */
function identifyUser(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const payload = verifyToken(header.substring(7));
  if (!payload || !verifyTokenType(payload, 'access')) return null;
  return payload.userId;
}

function getClientIp(req: Request): string {
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

function sendTooManyRequests(res: Response, limiterRes: RateLimiterRes): void {
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
    // Limiter internal error — fail-open to avoid blocking all traffic
    console.error('Rate limiter internal error (fail-open):', err);
    next();
  }
};

/**
 * Write endpoint rate limiter middleware.
 * Applied on top of globalRateLimiter for POST/PUT/PATCH/DELETE: 20 req/min.
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
