import { posix } from 'node:path';
import { NextFunction, Request, RequestHandler, Response } from 'express';
import { RateLimiterRes } from 'rate-limiter-flexible';
import { authenticate } from './auth';
import { createLimiter, getClientIp, sendTooManyRequests } from './rateLimiter';

/**
 * What one scraping request costs against a user's quota, by route. Anything not listed
 * costs 1. The export starts a Chromium; the stream and the whole-act fetch carry many
 * articles in one request; the detailed health page reaches the three sources for real.
 */
export const DEFAULT_SCRAPE_COSTS: Record<string, number> = {
  '/export_pdf': 20,
  '/stream_article_text': 3,
  '/fetch_all_data': 5,
  '/health/detailed': 5,
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
 * per address, the same authentication as every other route, the user's quota (charged by
 * the route named in X-Forwarded-Uri), then 204. A non-2xx answer goes back to the caller
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

  const allow: RequestHandler = (_req: Request, res: Response) => {
    res.status(204).end();
  };

  return [perAddress, authenticate, perUser, allow];
}
