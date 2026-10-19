import type { Request, Response, NextFunction } from 'express';
import { effectiveConsent } from './effectiveConsent';

/**
 * Blocks RLCF validation routes unless the user's consent grants validation
 * (level `full` → validationEnabled true). Mirrors contributionGuard; runs
 * after authenticate (Slice 2c #8).
 */

export async function validationGuard(
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
    if (!consent.validationEnabled) {
      res.status(403).json({ detail: 'validation_consent_required' });
      return;
    }
    next();
  } catch (err) {
    // The error's message stays out of the answer: it can carry the query's parameters.
    console.error('[merlt] consent check failed:', err instanceof Error ? err.name : err);
    res.status(500).json({ detail: 'consent_check_failed' });
  }
}
