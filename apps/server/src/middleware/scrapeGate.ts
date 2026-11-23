import { posix } from 'node:path';
import { NextFunction, Request, RequestHandler, Response } from 'express';
import { RateLimiterRes } from 'rate-limiter-flexible';
import { authenticate } from './auth';
import { provesWebOrigin, refuseCrossSite } from './csrfGuard';
import { webSession } from './webSession';
import { createLimiter, getClientIp, sendTooManyRequests } from './rateLimiter';

/**
 * What one scraping request costs against a user's quota, by route. Anything not listed
 * costs 1. The export starts a Chromium; the stream and the whole-act fetch carry many
 * articles in one request; the detailed health page reaches the three sources for real;
 * a decision lookup can query both Cassazione archives or download a Corte
 * costituzionale bundle; a batch of norm readings reads up to 200 strings, for which one
 * reading costs 1 (design 2026-10-29-document-analysis §4.4); a batch of link addresses
 * reaches Normattiva (a date lookup and an index per new act, both cached) for up to 200
 * norms of 30 acts (design 2026-10-31-document-hyperlinks §3.1).
 */
export const DEFAULT_SCRAPE_COSTS: Record<string, number> = {
  '/export_pdf': 20,
  '/stream_article_text': 3,
  '/fetch_all_data': 5,
  '/health/detailed': 5,
  '/fetch_decision': 2,
  '/parse_query_batch': 3,
  '/fetch_norm_links': 5,
};

/**
 * The cost of the request the ingress is asking about, from the URI it forwards. Caddy matches
 * the decoded, cleaned path but forwards the URI as the client wrote it, and the scrapers'
 * router decodes the path and accepts a doubled slash, so the price is looked up under a
 * normalised reading of the path: `/export%5Fpdf`, `//export_pdf` and `/x/../export_pdf` cost
 * what `/export_pdf` costs.
 */
export function scrapeCost(
  uri: string | undefined,
  costs: Record<string, number> = DEFAULT_SCRAPE_COSTS,
): number {
  let path = (uri ?? '').split('?')[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    // A malformed escape: the scrapers will not route it either. Price it as it stands.
  }
  // posix.normalize merges runs of slashes and resolves `.` and `..`; '' becomes '.', in no table.
  return costs[posix.normalize(path)] ?? 1;
}

export interface ScrapeGateOptions {
  /** Points a user may spend per window. */
  userPoints: number;
  windowSeconds: number;
  /** Requests per window from one address, whatever they carry: the cap on a flood without a token. */
  ipPoints: number;
  costs?: Record<string, number>;
}

/**
 * The handlers behind GET /api/auth/verify, the question the ingress (Caddy forward_auth)
 * puts to the server before it passes a scraping request to the scrapers. In order: a cap
 * per address, the same authentication as every other route (a Bearer token or the web's
 * session cookie, which `webSession` resolved first), the CSRF check of a cookie-authenticated
 * write, the user's quota (charged by the route named in X-Forwarded-Uri), then 204. A non-2xx answer goes back to the caller
 * as it is, so the 401 and the 429 with its Retry-After reach the browser.
 */
export function createScrapeGate(options: ScrapeGateOptions): RequestHandler[] {
  const ipLimiter = createLimiter('rl:scrape-ip', options.ipPoints, options.windowSeconds);
  const userLimiter = createLimiter('rl:scrape-user', options.userPoints, options.windowSeconds);

  const perAddress: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await ipLimiter.consume(getClientIp(req));
      next();
    } catch (err) {
      if (err instanceof RateLimiterRes) {
        sendTooManyRequests(res, err);
        return;
      }
      console.error('[scrapeGate] address limiter error (fail-open):', err);
      next();
    }
  };

  const perUser: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ detail: 'Authentication failed' });
      return;
    }
    const uri = req.header('x-forwarded-uri');
    try {
      await userLimiter.consume(user.id, scrapeCost(uri, options.costs));
      next();
    } catch (err) {
      if (err instanceof RateLimiterRes) {
        console.warn(`[scrapeGate] user ${user.id} is over the scraping quota (${uri ?? 'unknown route'})`);
        sendTooManyRequests(res, err);
        return;
      }
      console.error('[scrapeGate] user limiter error (fail-open):', err);
      next();
    }
  };

  // The scraping routes' own CSRF check (A.1): `forward_auth` always asks with GET, so the method of the request it
  // asks about comes in X-Forwarded-Method. A request authenticated by the web's cookie that changes something
  // (a POST to /export_pdf, say) must carry the web's header, as every write under /api must (middleware/csrfGuard.ts);
  // otherwise another site could spend the user's quota.
  const sameOrigin: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    const method = (req.header('x-forwarded-method') ?? 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || !req.webSessionId || provesWebOrigin(req)) {
      next();
      return;
    }
    refuseCrossSite(res);
  };

  const allow: RequestHandler = (_req: Request, res: Response) => {
    res.status(204).end();
  };

  // `webSession` again: in the app it has already run (and passes at once, the user set); the gate does not rely on it.
  return [perAddress, webSession, authenticate, sameOrigin, perUser, allow];
}
