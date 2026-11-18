import type { NextFunction, Request, Response } from 'express';
import { readSessionCookie, resolveWebSession } from '../auth/webSession';

/**
 * Who a request comes from, when it carries the web's session cookie (A.1): sets `req.user` and `req.webSessionId`.
 * Mounted early in `app.ts`, before the ingress's login check (`/api/auth/verify`) and the limiters, which read
 * `req.user`. It never answers by itself: a missing or dead session leaves `req.user` unset, and `authenticate`
 * says 401; a database that cannot answer sets `req.sessionUnavailable`, and `authenticate` says 503.
 *
 * Until the web has moved to the cookie (step 2), a Bearer token takes precedence: a request carrying one is left to
 * `delegatedAuth` (an exchanged token) or to `authenticate` (a user's JWT), whatever cookie comes with it.
 */
export async function webSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (req.user || req.headers.authorization?.startsWith('Bearer ')) {
    next();
    return;
  }
  const secret = readSessionCookie(req);
  if (!secret) {
    next();
    return;
  }
  try {
    const session = await resolveWebSession(secret);
    if (session) {
      req.user = session.user;
      req.webSessionId = session.sessionId;
    }
  } catch (error) {
    console.error('webSession: could not read the session:', error instanceof Error ? error.message : error);
    req.sessionUnavailable = true;
  }
  next();
}
