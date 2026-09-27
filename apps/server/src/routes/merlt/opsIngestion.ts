import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireAdmin } from '../../middleware/merlt/requireAdmin';
import {
  createOpsIngestionClient,
  OpsIngestionClient,
} from '../../services/merlt/opsIngestionClient';
import { MerltClientError, MerltBadRequestError } from '../../services/merlt/merltClient';
import {
  runIngestionBodySchema,
  promoteBatchBodySchema,
  rejectBatchBodySchema,
} from '../../schemas/merlt/opsIngestion';

/**
 * MERL-T admin/ops routes for the governed MECHANICAL ingestion pipeline —
 * deterministic, zero-LLM corpus→graph batches (VisuaLex article tree /
 * italia-corpus), staged and admin-reviewed before promotion into the graph.
 *
 *  - POST /ops/ingestion/run                          authenticate + requireAdmin
 *  - GET  /ops/ingestion/batches                       authenticate + requireAdmin
 *  - GET  /ops/ingestion/batches/:batchId               authenticate + requireAdmin
 *  - POST /ops/ingestion/batches/:batchId/promote        authenticate + requireAdmin
 *  - POST /ops/ingestion/batches/:batchId/reject          authenticate + requireAdmin
 *
 * Admin gate is enforced server-side (requireAdmin), not just by hiding the
 * UI. `created_by` / `reviewed_by` are always injected from req.user, never
 * trusted from the client body (see schemas/merlt/opsIngestion.ts).
 *
 * Per-route middleware (no pathless router.use), so this router is safe to
 * mount before the catch-all auth routers — same rule as ops.ts / graph.ts.
 *
 * Do not confuse with routes/merlt/ingestion.ts — that is the INTERPRETIVE
 * community ingestion pipeline (consent-gated, non-admin). Unrelated surface.
 */

const router = Router();

let cached: OpsIngestionClient | null = null;
function client(): OpsIngestionClient {
  if (!cached) cached = createOpsIngestionClient();
  return cached;
}
export function _resetOpsIngestionClientForTests(): void {
  cached = null;
}

function resolveActor(req: Request): string {
  return req.user?.username || String(req.user?.id);
}

function handleMerltError(err: unknown, res: Response): void {
  // Only 404 (batch_not_found) and 409 (all forms, incl. the structured
  // urn_conflicts_block_promotion) are part of the client contract and must
  // reach the admin verbatim. Any OTHER upstream 4xx (401/403/422 from a
  // missing/wrong MERLT_API_KEY, or a stray 400) means the BFF↔MERL-T
  // credential/proxy is misconfigured — not that THIS request was bad — so it
  // collapses to 503, exactly like a timeout/5xx. This keeps the frontend's
  // axios 401-interceptor from firing a spurious re-auth on an admin who is
  // in fact authenticated, and avoids leaking MERL-T's internal error body.
  if (err instanceof MerltBadRequestError && (err.status === 404 || err.status === 409)) {
    res
      .status(err.status)
      .json(typeof err.body === 'object' && err.body ? err.body : { detail: 'merlt_error' });
    return;
  }
  if (err instanceof MerltClientError) {
    res.status(503).json({ detail: 'merlt_unavailable' });
    return;
  }
  throw err;
}

function parseIntOrUndefined(raw: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? undefined : n;
}

router.post(
  '/ops/ingestion/run',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = runIngestionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: 'invalid_request', errors: parsed.error.flatten() });
      return;
    }
    try {
      const result = await client().run({
        source: parsed.data.source,
        source_ref: parsed.data.source_ref,
        scope_label: parsed.data.scope_label,
        created_by: resolveActor(req),
      });
      res.status(202).json(result);
    } catch (err) {
      handleMerltError(err, res);
    }
  }
);

router.get(
  '/ops/ingestion/batches',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = parseIntOrUndefined(req.query.limit);
    const offset = parseIntOrUndefined(req.query.offset);
    try {
      const result = await client().listBatches({ status, limit, offset });
      res.status(200).json(result);
    } catch (err) {
      handleMerltError(err, res);
    }
  }
);

router.get(
  '/ops/ingestion/batches/:batchId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const nodeLimit = parseIntOrUndefined(req.query.node_limit);
    const edgeLimit = parseIntOrUndefined(req.query.edge_limit);
    try {
      const result = await client().getBatch(req.params.batchId, {
        node_limit: nodeLimit,
        edge_limit: edgeLimit,
      });
      res.status(200).json(result);
    } catch (err) {
      handleMerltError(err, res);
    }
  }
);

router.post(
  '/ops/ingestion/batches/:batchId/promote',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = promoteBatchBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ detail: 'invalid_request', errors: parsed.error.flatten() });
      return;
    }
    try {
      const result = await client().promoteBatch(req.params.batchId, {
        force: parsed.data.force,
        reason: parsed.data.reason,
        reviewed_by: resolveActor(req),
      });
      res.status(200).json(result);
    } catch (err) {
      handleMerltError(err, res);
    }
  }
);

router.post(
  '/ops/ingestion/batches/:batchId/reject',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = rejectBatchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: 'invalid_request', errors: parsed.error.flatten() });
      return;
    }
    try {
      const result = await client().rejectBatch(req.params.batchId, {
        reason: parsed.data.reason,
        reviewed_by: resolveActor(req),
      });
      res.status(200).json(result);
    } catch (err) {
      handleMerltError(err, res);
    }
  }
);

export default router;
