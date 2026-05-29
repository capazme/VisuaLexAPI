import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireAdmin } from '../../middleware/merlt/requireAdmin';
import { createOpsClient, OpsClient } from '../../services/merlt/opsClient';
import { MerltClientError } from '../../services/merlt/merltClient';

/**
 * MERL-T admin/ops routes (loop-closure A5) — manual RLCF training.
 *
 *  - POST /ops/rlcf/training/start   authenticate + requireAdmin → proxy MERL-T
 *
 * Admin gate is enforced server-side (requireAdmin), not just by hiding the UI.
 * No auto-training: a run starts only when an admin explicitly calls this.
 * Per-route middleware, so this router is safe to mount before the catch-all
 * auth routers (same rule as graph/validate).
 */

const router = Router();

let cached: OpsClient | null = null;
function client(): OpsClient {
  if (!cached) cached = createOpsClient();
  return cached;
}
export function _resetOpsClientForTests(): void {
  cached = null;
}

router.post(
  '/ops/rlcf/training/start',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const config =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    try {
      const result = await client().startTraining(config);
      res.status(202).json(result);
    } catch (err) {
      if (err instanceof MerltClientError) {
        res.status(503).json({ detail: 'merlt_unavailable' });
        return;
      }
      throw err;
    }
  }
);

export default router;
