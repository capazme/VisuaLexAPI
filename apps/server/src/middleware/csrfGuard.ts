import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { readSessionCookie } from '../auth/webSession';

/**
 * Requests another site starts (CSRF), now that the browser attaches the session itself (A.1, spec section
 * «Cross-site requests»). The cookie is `SameSite=Strict`, the first defence; this is the second.
 *
 * A request that changes something (POST, PUT, PATCH, DELETE under /api) and carries the session cookie, or says it
 * comes from the web app, must prove it:
 * - the header `X-VisuaLex-Client: web`, which a form on another site cannot set, and which a cross-origin `fetch`
 *   can only send after CORS has allowed its origin;
 * - when an `Origin` header is present, an origin in ALLOWED_ORIGINS or the request's own host (the app opened by
 *   another name of the same host).
 *
 * Not held to it: a connected application's exchanged token (`req.delegation`), the MERL-T callbacks under
 * /api/merlt/internal/ (their shared secret), and, until the web has moved (step 3 of the spec), a request with a
 * Bearer token, whose header no other site can set either, or with neither the cookie nor the header, and the current
 * web's sign-in, registration and refresh without the header, cookie or not. Sign-in sets the cookie only for a
 * request that carries the header, so another site's form gets nothing it can use.
 *
 * A refusal is 403 with `code: "csrf_refused"`, which the web must show as an error, never as a sign-out.
 */
export const WEB_CLIENT_HEADER = 'x-visualex-client';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Until step 3: the current web's sign-in, registration and refresh, which send neither the header nor a Bearer
// token. Without the header they read no cookie and set none (they answer tokens in the body, which another site
// cannot read), so a cookie left in the browser by a try of the moved web must not block them.
const TOKEN_ROUTES = new Set(['/auth/login', '/auth/register', '/auth/refresh']);

function originAllowed(req: Request): boolean {
  const origin = req.get('origin');
  if (!origin) return true;
  if (config.cors.origins.includes(origin)) return true;
  try {
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}

/** The request says it comes from the web app, and its origin, if it names one, agrees. */
export function provesWebOrigin(req: Request): boolean {
  return req.get(WEB_CLIENT_HEADER) === 'web' && originAllowed(req);
}

export function refuseCrossSite(res: Response): void {
  res.status(403).json({ detail: "Richiesta rifiutata: non risulta inviata dall'app.", code: 'csrf_refused' });
}

/** Mounted on /api in `app.ts`, after `delegatedAuth` and `webSession`. */
export function csrfGuard(req: Request, res: Response, next: NextFunction): void {
  if (!UNSAFE_METHODS.has(req.method)) return next();
  if (req.delegation) return next();
  if (req.path.startsWith('/merlt/internal/')) return next();
  if (req.headers.authorization?.startsWith('Bearer ')) return next();
  const carriesSession = readSessionCookie(req) !== null;
  const claimsWeb = req.get(WEB_CLIENT_HEADER) !== undefined;
  if (!claimsWeb && TOKEN_ROUTES.has(req.path)) return next();
  if (!carriesSession && !claimsWeb) return next();
  if (provesWebOrigin(req)) return next();
  refuseCrossSite(res);
}
