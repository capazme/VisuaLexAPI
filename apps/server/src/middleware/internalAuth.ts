import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';

/**
 * Shared-secret middleware for the MERL-T worker → BFF callback.
 *
 * The RQ worker that finishes an ingestion job calls
 * POST /api/merlt/internal/job-callback with the header `X-Internal-Secret`.
 * It must match env MERLT_INTERNAL_SECRET (the SAME variable name the worker
 * reads). This is intentionally NOT a JWT path — the worker has no user
 * session, only the shared secret.
 *
 *  - env unset       → 500 internal_auth_not_configured (fail closed, visible)
 *  - header mismatch → 401 invalid_internal_secret
 */
export function internalAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers['x-internal-secret'];
  const secret = process.env.MERLT_INTERNAL_SECRET;
  if (!secret) {
    res.status(500).json({ detail: 'internal_auth_not_configured' });
    return;
  }
  if (typeof header !== 'string') {
    res.status(401).json({ detail: 'invalid_internal_secret' });
    return;
  }
  // Timing-safe comparison: avoid leaking secret length/content via response time.
  // The length pre-check short-circuits before timingSafeEqual (which throws on
  // unequal buffer lengths) without giving an attacker a usable timing signal.
  const a = Buffer.from(header, 'utf8');
  const b = Buffer.from(secret, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ detail: 'invalid_internal_secret' });
    return;
  }
  next();
}
