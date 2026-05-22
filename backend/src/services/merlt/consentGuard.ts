import type { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

/**
 * Express middleware that blocks event-capture requests when the user has
 * not granted (or has revoked) consent for MERL-T tracking.
 *
 * Usage: mounted ONLY on /api/merlt/events/* — never on /api/merlt/consent
 * itself (would create a chicken-and-egg loop).
 *
 * Semantics:
 *  - consentLevel === 'none' → 403 { detail: 'consent_required' }
 *  - consentLevel === 'basic' | 'full' → next()
 *  - No record at all (first-time user) → treated as 'none' → 403
 *
 * The Slice 1 design pins the toggle granularity (contribution / validation
 * / graph) to the consent level itself via preferencesForLevel(). The
 * three-flag check is enforced at the route layer for event-type-specific
 * needs (e.g. forum signals require contribution); the bare consentGuard
 * here only ensures *some* level of consent exists.
 */

const prisma = new PrismaClient();

export async function consentGuard(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }

  try {
    const preference = await prisma.merltUserPreference.findUnique({
      where: { userId: req.user.id },
      select: { consentLevel: true },
    });

    if (!preference || preference.consentLevel === 'none') {
      res.status(403).json({ detail: 'consent_required' });
      return;
    }

    next();
  } catch (err) {
    // DB error → fail closed (no tracking) but with 500 so it's visible in
    // logs rather than swallowed as a silent 403.
    res.status(500).json({
      detail: 'consent_check_failed',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
