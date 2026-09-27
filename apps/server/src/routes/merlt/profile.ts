import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import { createMerltClient, MerltClientError } from '../../services/merlt/merltClient';
import { getOrSyncAuthority } from '../../services/merlt/authorityCache';

const router = Router();

router.use(authenticate);

/**
 * GET /api/merlt/profile
 *
 * Returns the cached authority profile for the current user, optionally
 * refreshing from MERL-T if stale. Used by the frontend to render
 * "your authority" UI and by the event mapper to attach user_authority
 * to every tracking event.
 */
router.get('/profile', async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }

  const client = createMerltClient();
  try {
    const profile = await getOrSyncAuthority(req.user.id, client);
    if (!profile) {
      // Cache miss + MERL-T unreachable: BFF responds 503 so the frontend
      // can decide to show a degraded "authority unknown" state.
      res.status(503).json({ detail: 'merlt_unavailable' });
      return;
    }

    res.json({
      userId: profile.userId,
      authorityScore: profile.authorityScore,
      baselineQual: profile.baselineQual,
      trackRecord: profile.trackRecord,
      performance: profile.performance,
      totalContributions: profile.totalContributions,
      syncedAt: profile.syncedAt.toISOString(),
    });
  } catch (err) {
    if (err instanceof MerltClientError) {
      res.status(err.status && err.status < 500 ? err.status : 503).json({
        detail: 'merlt_error',
        message: err.message,
      });
      return;
    }
    throw err;
  }
});

export default router;
