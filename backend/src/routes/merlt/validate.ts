import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import { validationGuard } from '../../services/merlt/validationGuard';
import {
  validateEntityRequestSchema,
  validateRelationRequestSchema,
} from '../../schemas/merlt/contrib';
import { createContribClient, ContribClient } from '../../services/merlt/contribClient';
import { MerltClientError } from '../../services/merlt/merltClient';

/**
 * MERL-T RLCF validation routes (Slice 2c #8) — vote on the community's pending
 * proposals. Per-route middleware; gated by full (validation) consent.
 *
 *  - GET  /validate/pending          authenticate + validationGuard
 *  - POST /validate/entity           authenticate + validationGuard
 *  - POST /validate/relation         authenticate + validationGuard
 */

const router = Router();

let cached: ContribClient | null = null;
function client(): ContribClient {
  if (!cached) cached = createContribClient();
  return cached;
}
export function _resetValidateClientForTests(): void {
  cached = null;
}

function clampInt(raw: unknown, def: number, min: number, max: number): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

router.get('/validate/pending', authenticate, validationGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const limit = clampInt(req.query.limit, 50, 1, 200);
  try {
    res.status(200).json(await client().getPending(limit, req.user.id));
  } catch (err) {
    if (err instanceof MerltClientError) {
      res.status(503).json({ detail: 'merlt_unavailable' });
      return;
    }
    throw err;
  }
});

router.post('/validate/entity', authenticate, validationGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const parsed = validateEntityRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }
  try {
    const result = await client().validateEntity({
      entity_id: parsed.data.entityId,
      vote: parsed.data.vote,
      user_id: req.user.id,
      reason: parsed.data.reason,
    });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof MerltClientError) {
      res.status(503).json({ detail: 'merlt_unavailable' });
      return;
    }
    throw err;
  }
});

router.post('/validate/relation', authenticate, validationGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const parsed = validateRelationRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }
  try {
    const result = await client().validateRelation({
      relation_id: parsed.data.relationId,
      vote: parsed.data.vote,
      user_id: req.user.id,
      reason: parsed.data.reason,
    });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof MerltClientError) {
      res.status(503).json({ detail: 'merlt_unavailable' });
      return;
    }
    throw err;
  }
});

export default router;
