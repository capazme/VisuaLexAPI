import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';

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
    const preference = await prisma.merltUserPreference.findUnique({
      where: { userId: req.user.id },
      select: { validationEnabled: true },
    });
    if (!preference || !preference.validationEnabled) {
      res.status(403).json({ detail: 'validation_consent_required' });
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
