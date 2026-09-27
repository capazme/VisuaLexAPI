import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';

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
    const preference = await prisma.merltUserPreference.findUnique({
      where: { userId: req.user.id },
      select: { contributionEnabled: true },
    });
    if (!preference || !preference.contributionEnabled) {
      res.status(403).json({ detail: 'contribution_consent_required' });
      return;
    }
    next();
  } catch (err) {
    res.status(500).json({
      detail: 'consent_check_failed',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
