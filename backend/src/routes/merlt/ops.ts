import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireAdmin } from '../../middleware/merlt/requireAdmin';
import { createOpsClient, OpsClient } from '../../services/merlt/opsClient';
import { MerltClientError, MerltBadRequestError } from '../../services/merlt/merltClient';

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

// Runtime inference-config tuning (admin panel). Reading the config exposes
// engine internals, so both GET and PUT are admin-gated. PUT takes effect on the
// next query with no restart for runtime-tunable levers (gating threshold,
// max_tokens, max_experts, disagreement gate); `requires_restart` params store
// the intent and MERL-T echoes the flag.
router.get(
  '/ops/config',
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      res.status(200).json(await client().getConfig());
    } catch (err) {
      if (err instanceof MerltClientError) {
        res.status(503).json({ detail: 'merlt_unavailable' });
        return;
      }
      throw err;
    }
  }
);

router.put(
  '/ops/config/:key',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const key = req.params.key;
    const value = (req.body as { value?: unknown } | undefined)?.value;
    if (typeof value !== 'number' && typeof value !== 'boolean' && typeof value !== 'string') {
      res.status(400).json({ detail: 'value must be a number, boolean, or string' });
      return;
    }
    try {
      res.status(200).json(await client().setConfig(key, value));
    } catch (err) {
      if (err instanceof MerltBadRequestError) {
        res
          .status(err.status ?? 400)
          .json(typeof err.body === 'object' && err.body ? err.body : { detail: 'invalid_config' });
        return;
      }
      if (err instanceof MerltClientError) {
        res.status(503).json({ detail: 'merlt_unavailable' });
        return;
      }
      throw err;
    }
  }
);

// Rebuild the Expert System from the current config (the "Riavvia motore"
// button) — applies construction-time flags without a container restart. Admin
// only; MERL-T builds the new orchestrator then atomically swaps it in.
router.post(
  '/ops/engine/reinitialize',
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      res.status(200).json(await client().reinitEngine());
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
