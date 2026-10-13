import type { Request, Response, NextFunction } from 'express';
import { effectiveConsent } from './effectiveConsent';

/**
 * Blocks contribution routes unless the user's consent level grants
 * contribution (i.e. `full` → contributionEnabled true). Runs AFTER
 * authenticate. Stricter than consentGuard (which only requires *some*
 * consent): the "Apprendi dai miei appunti" flow feeds the shared graph, so it
 * needs explicit full consent (Slice 2c, decision C8).
 */

export async function contributionGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  try {
    const consent = await effectiveConsent(req.user.id);
    if (!consent.contributionEnabled) {
      res.status(403).json({ detail: 'contribution_consent_required' });
      return;
    }
    next();
  } catch (err) {
    // The error's message stays out of the answer: it can carry the query's parameters.
    console.error('[merlt] consent check failed:', err instanceof Error ? err.name : err);
    res.status(500).json({ detail: 'consent_check_failed' });
  }
}
