import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import { contributionGuard } from '../../services/merlt/contributionGuard';
import {
  ingestionRequestBodySchema,
  validationVoteBodySchema,
} from '../../schemas/merlt/ingestion';
import {
  createIngestionClient,
  IngestionClient,
} from '../../services/merlt/ingestionClient';
import { createMerltClient, MerltClientError, MerltBadRequestError } from '../../services/merlt/merltClient';
import { getOrSyncAuthority } from '../../services/merlt/authorityCache';

/**
 * MERL-T ingestion layer BFF routes (Phase 2) — wires VisuaLex user knowledge
 * (annotations, dossier groupings, manual submissions, search-miss follow-ups)
 * into MERL-T's ExternalIngestionPipeline, so it can reach the central graph.
 *
 * Mounted at /api/merlt (see routes/merlt/index.ts). All routes apply
 * `authenticate` per-route (no pathless router.use) — registered BEFORE the
 * catch-all auth routers in index.ts, per the standing gotcha #1.
 *
 *  - POST /ingestion/preview   authenticate + contributionGuard (full consent)
 *  - POST /ingestion/process   authenticate + contributionGuard (full consent)
 *  - GET  /ingestion/pending   authenticate only (read)
 *  - POST /ingestion/validate  authenticate + contributionGuard (full consent)
 *
 * `user_authority` / `voter_authority` are NEVER read from the client body —
 * the route resolves them server-side via authorityCache (falls back to a
 * neutral 0.5 when MERL-T is unreachable and there is no cached score), same
 * pattern as profile.ts. Trusting a client-supplied authority would let a
 * request auto-approve itself (pipeline auto-approves at authority >= 0.7).
 */

const router = Router();

const DEFAULT_AUTHORITY = 0.5;

let cachedIngestionClient: IngestionClient | null = null;
function ingestionClient(): IngestionClient {
  if (!cachedIngestionClient) cachedIngestionClient = createIngestionClient();
  return cachedIngestionClient;
}
/** Test hook: clear the cached client (e.g. when MERLT_API_URL changes). */
export function _resetIngestionClientForTests(): void {
  cachedIngestionClient = null;
}

function clampInt(raw: unknown, def: number, min: number, max: number): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/**
 * Resolve the current user's authority score for the pipeline's
 * `user_authority` field. Falls back to a neutral default when MERL-T is
 * unreachable and no cached score exists yet — never trust the client.
 */
async function resolveUserAuthority(userId: string): Promise<number> {
  try {
    const cached = await getOrSyncAuthority(userId, createMerltClient());
    return cached?.authorityScore ?? DEFAULT_AUTHORITY;
  } catch {
    return DEFAULT_AUTHORITY;
  }
}

function handleMerltError(err: unknown, res: Response): void {
  if (err instanceof MerltBadRequestError) {
    res
      .status(err.status ?? 400)
      .json(typeof err.body === 'object' && err.body ? err.body : { detail: 'merlt_bad_request' });
    return;
  }
  if (err instanceof MerltClientError) {
    res.status(503).json({ detail: 'merlt_unavailable' });
    return;
  }
  throw err;
}

/**
 * POST /api/merlt/ingestion/preview
 * Dry-run: returns what WOULD be created, without mutating the graph.
 */
router.post('/ingestion/preview', authenticate, contributionGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const parsed = ingestionRequestBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }
  const userAuthority = await resolveUserAuthority(req.user.id);
  try {
    const result = await ingestionClient().previewIngestion({
      source: parsed.data.source,
      user_id: req.user.id,
      user_authority: userAuthority,
      tipo_atto: parsed.data.tipo_atto,
      articolo: parsed.data.articolo,
      trigger: parsed.data.trigger,
      suggested_relations: parsed.data.suggested_relations,
      metadata: parsed.data.metadata,
    });
    res.status(200).json(result);
  } catch (err) {
    handleMerltError(err, res);
  }
});

/**
 * POST /api/merlt/ingestion/process
 * The real write: MERL-T auto-approves or queues for community validation
 * depending on the user's authority + trigger.
 */
router.post('/ingestion/process', authenticate, contributionGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const parsed = ingestionRequestBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }
  const userAuthority = await resolveUserAuthority(req.user.id);
  try {
    const result = await ingestionClient().processIngestion({
      source: parsed.data.source,
      user_id: req.user.id,
      user_authority: userAuthority,
      tipo_atto: parsed.data.tipo_atto,
      articolo: parsed.data.articolo,
      trigger: parsed.data.trigger,
      suggested_relations: parsed.data.suggested_relations,
      metadata: parsed.data.metadata,
    });
    res.status(200).json(result);
  } catch (err) {
    handleMerltError(err, res);
  }
});

/**
 * GET /api/merlt/ingestion/pending?limit=
 * Read-only list of pending validations — authenticate only, like the graph
 * read paths (not a contribution, just a lookup).
 */
router.get('/ingestion/pending', authenticate, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const limit = clampInt(req.query.limit, 20, 1, 100);
  try {
    const result = await ingestionClient().listPending(limit);
    res.status(200).json(result);
  } catch (err) {
    handleMerltError(err, res);
  }
});

/**
 * POST /api/merlt/ingestion/validate
 * Community vote on a pending ingestion. `voter_id`/`voter_authority` are
 * injected server-side, same rule as /preview and /process.
 */
router.post('/ingestion/validate', authenticate, contributionGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const parsed = validationVoteBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }
  const voterAuthority = await resolveUserAuthority(req.user.id);
  try {
    const result = await ingestionClient().validatePending({
      pending_id: parsed.data.pending_id,
      voter_id: req.user.id,
      voter_authority: voterAuthority,
      vote: parsed.data.vote,
      reason: parsed.data.reason,
    });
    res.status(200).json(result);
  } catch (err) {
    handleMerltError(err, res);
  }
});

export default router;
