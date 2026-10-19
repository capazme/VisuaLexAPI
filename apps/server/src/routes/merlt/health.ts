import { Router } from 'express';
import type { Request, Response } from 'express';
import { createMerltClient, MerltClientError } from '../../services/merlt/merltClient';

const router = Router();

/**
 * GET /api/merlt/health
 *
 * Reachability check for the MERL-T sidecar. Returns:
 *   200 { bff: 'ok', merlt: 'reachable', upstream: {...} }
 *   503 { bff: 'ok', merlt: 'unreachable', error: '...' }
 *
 * Used by the frontend to gate UI on MERL-T availability and by uptime
 * monitors. No auth required (operationally useful even pre-login).
 */
router.get('/health', async (_req: Request, res: Response): Promise<void> => {
  const client = createMerltClient();
  try {
    const upstream = await client.healthCheck();
    res.status(200).json({ bff: 'ok', merlt: 'reachable', upstream });
  } catch (err) {
    const message =
      err instanceof MerltClientError ? err.message : err instanceof Error ? err.message : String(err);
    res.status(503).json({ bff: 'ok', merlt: 'unreachable', error: message });
  }
});

export default router;
