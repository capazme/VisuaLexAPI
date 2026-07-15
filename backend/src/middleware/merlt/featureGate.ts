import type { Request, Response, NextFunction } from 'express';
import { config } from '../../config';

type MerltSubFlag = keyof typeof config.merlt.flags;

/**
 * Wave 1 cleanup: config.merlt.enabled / flags.* were defined and read from
 * env but had ZERO call-sites — MERLT_ENABLED=false didn't disable anything.
 * These two gates wire them up for real.
 *
 * `merltKillSwitch` — global gate for the whole /api/merlt namespace, mounted
 * in app.ts alongside merltRoutes. Since /api/merlt is a single self-contained
 * mount point (nothing legitimately falls through it into unrelated /api/*
 * routes), it 404s unconditionally when disabled — no path filtering needed.
 *
 * `featureGate(flag, prefixes)` — per-sub-feature gate for a router GROUP
 * inside routes/merlt/index.ts. Unlike the kill switch, this one MUST filter
 * by path: every merlt sub-router is mounted pathlessly ('/') on the shared
 * merltRoutes router, and some of them (consent/profile/events) apply their
 * own blanket `router.use(authenticate)` relying on registration order + a
 * "no route matched here, fall through to the next router" chain (gotcha #1
 * in CLAUDE.md). An unconditional 404 inserted in front of, say, graphRouter
 * would terminate the request for ANY path reaching that point in the chain
 * (e.g. a /consent request that hasn't matched yet), breaking fall-through
 * for every router registered after it. Scoping the gate to the path
 * prefixes the group actually owns keeps it a no-op for everything else.
 */
export function merltKillSwitch(_req: Request, res: Response, next: NextFunction): void {
  if (!config.merlt.enabled) {
    res.status(404).json({ detail: 'merlt_disabled' });
    return;
  }
  next();
}

export function featureGate(flag: MerltSubFlag, prefixes: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ownsPath = prefixes.some(
      (prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`)
    );
    if (!ownsPath) {
      next();
      return;
    }
    if (!config.merlt.flags[flag]) {
      res.status(404).json({ detail: 'merlt_disabled' });
      return;
    }
    next();
  };
}
